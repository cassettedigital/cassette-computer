// MusicBrainz Recording ID resolver.
//
// Layer 1 of the Cassette Ownership Model: the sidecar walks the music
// directory, looks at every FLAC and MP3, and for any file without a
// MusicBrainz Recording ID it issues a fuzzy lookup against the public
// MusicBrainz API. Confirmed matches are written back to the file (see
// tag-writer.go) so Navidrome surfaces the MBID via Subsonic search3.
//
// Outcomes are cached in sidecar.json keyed by absolute file path. The
// cache is the only protection against re-hitting MusicBrainz on every
// sync cycle, so it is treated as authoritative for "have we already
// looked at this file" — a file whose last attempt was unresolved is
// not retried until a Layer 1.5 follow-up adds a re-check schedule.
//
// Hard limits per pass:
//   - 1 request per second to musicbrainz.org (token bucket)
//   - resolverMaxQueriesPerPass MB queries total (bounds wall time)
//   - acceptance: top hit has score >= 90 and duration within ±2 seconds
//
// Out of scope for Layer 1: M4A / AAC tag write-back, ISRC-first
// lookup, and per-track UI on cassette.digital.

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	mbAPIBase              = "https://musicbrainz.org/ws/2"
	mbUserAgent            = "CassettePlayerSidecar/1.0 ( fork@cassette.digital )"
	mbRequestInterval      = time.Second // 1 req/sec polite ceiling
	mbAcceptanceScore      = 90
	mbDurationToleranceSec = 2
	resolverHTTPTimeout    = 15 * time.Second

	// Layer 1.5 budgets. The first sync runs with a much larger budget
	// because the user is at their machine and expects setup work to
	// happen. Steady-state passes stay small — they're unattended,
	// triggered by the hourly library-sync gate.
	resolverMaxQueriesPerPass       = 200
	resolverMaxQueriesFirstPass     = 2000
	resolverFirstPassStateThreshold = 50
	resolverContextTimeoutSteady    = 15 * time.Minute
	resolverContextTimeoutFirstPass = 45 * time.Minute

	// Retry cadence. A genuine no-match might exist on MusicBrainz next
	// month — recheck every 30 days. Tag-write failures retry immediately
	// because the MB query has already been paid for.
	resolverNoMatchRetryAfter   = 30 * 24 * time.Hour
	resolverLegacyMigrationWait = 7 * 24 * time.Hour
)

// MBIDResolutionReason classifies the outcome of a per-file resolution
// attempt. Transient failures (503/429/network) are intentionally NOT
// represented here — they are not cached at all, so the next pass
// retries them fresh.
type MBIDResolutionReason string

const (
	ReasonResolved         MBIDResolutionReason = "resolved"
	ReasonNoMatch          MBIDResolutionReason = "no_match"
	ReasonInsufficientTags MBIDResolutionReason = "insufficient_tags"
	ReasonTagWriteFailed   MBIDResolutionReason = "tag_write_failed"
)

// MBIDFileState is the per-file outcome of an MBID resolution attempt.
//
// JSON tags use camelCase to match the rest of sidecar.json. The legacy
// `lastAttemptAt` tag is preserved as an alias on AttemptedAt so a state
// file written by Layer 1 still unmarshals; migrateLegacyCacheEntries
// handles the in-memory shape after that.
type MBIDFileState struct {
	Resolved       bool                 `json:"resolved"`
	MBID           string               `json:"mbid,omitempty"`
	LocalID        string               `json:"localId,omitempty"`
	Reason         MBIDResolutionReason `json:"reason,omitempty"`
	AttemptedAt    time.Time            `json:"attemptedAt"`
	RetryAfter     time.Time            `json:"retryAfter,omitempty"`
	FileModifiedAt time.Time            `json:"fileModifiedAt,omitempty"`

	// LastAttemptAt is the Layer 1 field name. We keep it as an inbound
	// JSON alias for migration; nothing should read it after loadState
	// has run.
	LastAttemptAt time.Time `json:"lastAttemptAt,omitempty"`
}

// MBIDResolutionStats is the aggregate view recomputed at the end of
// every resolver pass. It is persisted to sidecar.json (so it survives
// restart) and surfaced via the local status page and heartbeat payload.
type MBIDResolutionStats struct {
	TotalFilesSeen   int       `json:"totalFilesSeen"`
	ResolvedWithMBID int       `json:"resolvedWithMbid"`
	NoMatchCached    int       `json:"noMatchCached"`
	InsufficientTags int       `json:"insufficientTags"`
	PendingRetry     int       `json:"pendingRetry"`
	LastPassAt       time.Time `json:"lastPassAt,omitempty"`
	LastPassQueries  int       `json:"lastPassQueries"`
	LastPassDuration string    `json:"lastPassDuration,omitempty"`
}

// migrateLegacyCacheEntries upgrades Layer 1 MBIDFileState entries to
// the Layer 1.5 schema in-place. Returns true if any entry was changed
// so the caller can persist the migrated state.
//
// Heuristic (preserves Layer 1 information instead of treating every
// row as no-match):
//   - Resolved == true                  → Reason = ReasonResolved
//   - Resolved == false && MBID != ""   → Reason = ReasonTagWriteFailed (immediate retry; MB query already paid)
//   - Resolved == false && MBID == ""   → Reason = ReasonNoMatch (RetryAfter = now + 7d per spec migration grace)
//
// FileModifiedAt is left zero on migration; the walker treats a zero
// baseline as "no mtime check needed" so the next pass behaves the same
// as if the file had just been seen for the first time.
func migrateLegacyCacheEntries(state *SidecarState, now time.Time) bool {
	if state == nil || state.MBIDResolutionState == nil {
		return false
	}
	graceRetryAt := now.Add(resolverLegacyMigrationWait)
	changed := false
	for _, entry := range state.MBIDResolutionState {
		if entry == nil {
			continue
		}
		// Fold the legacy `lastAttemptAt` field into AttemptedAt and clear it.
		if entry.AttemptedAt.IsZero() && !entry.LastAttemptAt.IsZero() {
			entry.AttemptedAt = entry.LastAttemptAt
			changed = true
		}
		if !entry.LastAttemptAt.IsZero() {
			entry.LastAttemptAt = time.Time{}
			changed = true
		}
		if entry.Reason != "" {
			continue
		}
		switch {
		case entry.Resolved:
			entry.Reason = ReasonResolved
		case entry.MBID != "":
			entry.Reason = ReasonTagWriteFailed
		default:
			entry.Reason = ReasonNoMatch
			entry.RetryAfter = graceRetryAt
		}
		changed = true
	}
	return changed
}

// mbLimiter is a tiny one-token-at-a-time limiter. A single resolver
// goroutine consumes from it, so a mutex-protected timestamp is enough;
// we do not need golang.org/x/time/rate's full machinery.
type mbLimiter struct {
	interval time.Duration
	mu       sync.Mutex
	last     time.Time
}

func (l *mbLimiter) Wait(ctx context.Context) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if !l.last.IsZero() {
		sleep := l.interval - time.Since(l.last)
		if sleep > 0 {
			t := time.NewTimer(sleep)
			defer t.Stop()
			select {
			case <-t.C:
			case <-ctx.Done():
				return ctx.Err()
			}
		}
	}
	l.last = time.Now()
	return nil
}

// resolverMu prevents two resolver passes from running at the same time
// (e.g. a heartbeat-triggered pass overlapping with one kicked off at
// pairing). Concurrent passes would just waste MB requests.
var resolverMu sync.Mutex

// passBudgetFor returns (queryBudget, contextTimeout) for the given
// state. Used by both the resolver itself and the caller in
// library-sync.go so the context deadline matches the query budget.
//
// When MBIDResolutionState is below resolverFirstPassStateThreshold we
// treat this as the first sync — user just paired, expects setup work
// to happen, and the larger budget fits inside the 45-minute timeout.
func passBudgetFor(state *SidecarState) (queryBudget int, contextTimeout time.Duration) {
	if state == nil || len(state.MBIDResolutionState) < resolverFirstPassStateThreshold {
		return resolverMaxQueriesFirstPass, resolverContextTimeoutFirstPass
	}
	return resolverMaxQueriesPerPass, resolverContextTimeoutSteady
}

// shouldSkipCachedEntry decides whether a cached MBIDFileState lets us
// skip MB work for this pass. Pulled out as a pure function for unit
// testing — the walker just consumes the bool.
//
// mtime mismatch always invalidates the cache: the file has been re-tagged
// externally (e.g. by Picard), so artist/title/MBID may all have changed.
func shouldSkipCachedEntry(entry *MBIDFileState, currentMtime time.Time, now time.Time) bool {
	if entry == nil {
		return false
	}
	if !entry.FileModifiedAt.IsZero() && !currentMtime.IsZero() && !currentMtime.Equal(entry.FileModifiedAt) {
		return false
	}
	switch entry.Reason {
	case ReasonResolved, ReasonInsufficientTags:
		return true
	case ReasonNoMatch:
		return now.Before(entry.RetryAfter)
	case ReasonTagWriteFailed:
		return false
	}
	// Unknown reason (shouldn't happen post-migration) — be conservative
	// and retry.
	return false
}

// setMBIDFileState records one file's resolver outcome under stateMu (BUG-788).
func setMBIDFileState(state *SidecarState, path string, v *MBIDFileState) {
	stateMu.Lock()
	state.MBIDResolutionState[path] = v
	stateMu.Unlock()
}

// resolveMBIDsOnce runs a single bounded resolver pass over sidecarMusicDir.
//
// Returns:
//   - tagWrites: number of files whose tags were updated this pass
//   - dirty:     whether SidecarState was mutated (caller should save)
//   - err:       fatal walking error, if any. Per-file errors are logged
//                and counted, not returned.
func resolveMBIDsOnce(ctx context.Context, state *SidecarState) (tagWrites int, dirty bool, err error) {
	resolverMu.Lock()
	defer resolverMu.Unlock()

	if state.MBIDResolutionState == nil {
		stateMu.Lock()
		state.MBIDResolutionState = make(map[string]*MBIDFileState)
		stateMu.Unlock()
		dirty = true
	}

	info, statErr := os.Stat(sidecarMusicDir)
	if statErr != nil {
		log.Printf("MBID resolver: music dir %q not accessible (%v); skipping pass.",
			sidecarMusicDir, statErr)
		return 0, dirty, nil
	}
	if !info.IsDir() {
		log.Printf("MBID resolver: music dir %q is not a directory; skipping pass.", sidecarMusicDir)
		return 0, dirty, nil
	}

	limiter := &mbLimiter{interval: mbRequestInterval}
	client := &http.Client{Timeout: resolverHTTPTimeout}

	queryBudget, _ := passBudgetFor(state)
	initialBudget := queryBudget
	skipped, unsupported, mbHits, mbMisses, mbTransient := 0, 0, 0, 0, 0
	coverWrites, heldMatches := 0, 0
	coveredDirs := make(map[string]bool)
	materializedArtistDirs := make(map[string]bool)

	walkStart := time.Now()
	walkErr := filepath.WalkDir(sidecarMusicDir, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			log.Printf("MBID resolver: walk error at %q: %v", path, walkErr)
			return nil
		}
		if d.IsDir() {
			return nil
		}
		if !isLibraryAudio(path) {
			return nil
		}
		// Read-only files (M4A) are identified but never written to or beside, so
		// they skip both folder backfills and the tag write below.
		writable := isSupportedAudio(path)

		// Fast Album Art backfill: ensure this album folder has a cover
		// image, materialized from the embedded art of one of its tracks.
		// Done once per directory per pass, and BEFORE the MBID cache-skip
		// gate below so it runs even when every track is already resolved.
		// Local + free — it never touches the MusicBrainz query budget.
		// Idempotent: no-ops when a cover already exists. Only folders that
		// arrived after the hub started watching (BUG-786), and never the
		// library root itself.
		if dir := filepath.Dir(path); writable && !coveredDirs[dir] {
			coveredDirs[dir] = true
			if filepath.Clean(dir) != filepath.Clean(sidecarMusicDir) && folderArtAllowed(dir) {
				if wrote, mErr := materializeCoverForAlbumDir(dir); mErr != nil {
					log.Printf("cover-art: backfill failed for %q: %v", dir, mErr)
				} else if wrote {
					coverWrites++
					log.Printf("cover-art: materialized folder cover for %q", dir)
				}
			}
		}

		// Artist-photo backfill (the artist parallel of Fast Album Art):
		// materialize the artist folder's photo once per artist per pass. The
		// artist folder is the album dir's parent, or the album folder itself for
		// a flat album (artistDirForPath, BUG-787); source is our catalog artist
		// image (read-only lookup, negative-cached per artist dir). Same
		// free/idempotent/forward-only contract as the cover backfill above.
		if artistDir, dErr := artistDirForPath(path); writable && dErr == nil && !materializedArtistDirs[artistDir] {
			materializedArtistDirs[artistDir] = true
			if folderArtAllowed(artistDir) {
				if wrote, aErr := materializeArtistPhotoForDir(artistDir); aErr != nil {
					log.Printf("artist-photo: backfill failed for %q: %v", artistDir, aErr)
				} else if wrote {
					log.Printf("artist-photo: materialized artist photo for %q", artistDir)
				}
			}
		}

		// Pull mtime once per file — the walker uses it for the cache
		// skip gate and the cache writes embed it for the next pass. A link
		// keeps its own date when the song it points at is re-tagged, so a
		// linked song is dated by the song itself (its match is held, BUG-861).
		var currentMtime time.Time
		if d.Type()&fs.ModeSymlink != 0 {
			if fi, infoErr := os.Stat(path); infoErr == nil {
				currentMtime = fi.ModTime()
			}
		} else if fi, infoErr := d.Info(); infoErr == nil {
			currentMtime = fi.ModTime()
		}

		if existing, ok := state.MBIDResolutionState[path]; ok && existing != nil {
			if shouldSkipCachedEntry(existing, currentMtime, time.Now()) {
				skipped++
				return nil
			}
			// Fall through and re-attempt this file.
		}

		if ctx.Err() != nil {
			return ctx.Err()
		}

		tags, readErr := readTags(path)
		if errors.Is(readErr, errUnsupportedFormat) {
			unsupported++
			return nil
		}
		if readErr != nil {
			log.Printf("MBID resolver: read tags %q: %v", path, readErr)
			return nil
		}

		localID := CassetteLocalIDFromSeconds(tags.Artist, tags.Title, tags.DurationSeconds)
		attempt := time.Now()

		// File already carries an MBID — cache as resolved and move on.
		if tags.MBID != "" {
			setMBIDFileState(state, path, &MBIDFileState{
				Resolved:       true,
				MBID:           tags.MBID,
				LocalID:        localID,
				Reason:         ReasonResolved,
				AttemptedAt:    attempt,
				FileModifiedAt: currentMtime,
			})
			dirty = true
			mbHits++
			return nil
		}

		// Out of fuzzy-lookup budget — leave the file unrecorded so a
		// future pass can pick it up. We intentionally do NOT cache here.
		if queryBudget <= 0 {
			return nil
		}
		if tags.Artist == "" || tags.Title == "" {
			// Permanent until the file itself is re-tagged (which the
			// mtime gate will catch next pass).
			setMBIDFileState(state, path, &MBIDFileState{
				Resolved:       false,
				LocalID:        localID,
				Reason:         ReasonInsufficientTags,
				AttemptedAt:    attempt,
				FileModifiedAt: currentMtime,
			})
			dirty = true
			mbMisses++
			return nil
		}

		if waitErr := limiter.Wait(ctx); waitErr != nil {
			return waitErr
		}
		queryBudget--

		mbid, queryErr := queryMusicBrainz(ctx, client, tags)
		if queryErr != nil {
			var transient *mbTransientError
			if errors.As(queryErr, &transient) || errors.Is(queryErr, context.DeadlineExceeded) {
				// Do not cache transient failures. The next pass tries
				// again from scratch.
				log.Printf("MBID resolver: transient MB error for %q: %v", path, queryErr)
				mbTransient++
				return nil
			}
			// Decode / malformed-response / other unexpected errors:
			// also treat as transient. We'd rather waste an MB query on
			// a future pass than permanently mark a track unresolvable
			// because of a one-off decoder bug.
			log.Printf("MBID resolver: MB query non-transient error for %q (treating as transient): %v", path, queryErr)
			mbTransient++
			return nil
		}

		if mbid == "" {
			mbMisses++
			setMBIDFileState(state, path, &MBIDFileState{
				Resolved:       false,
				LocalID:        localID,
				Reason:         ReasonNoMatch,
				AttemptedAt:    attempt,
				RetryAfter:     attempt.Add(resolverNoMatchRetryAfter),
				FileModifiedAt: currentMtime,
			})
			dirty = true
			return nil
		}

		// A file the hub may not write holds its match instead: an M4A, a link to
		// a song kept elsewhere, or a song set read-only (BUG-861). The library
		// sync attaches it to the track while the file is unchanged.
		if matchHeldOnHubSide(path) {
			heldMatches++
			setMBIDFileState(state, path, &MBIDFileState{
				Resolved:       true,
				MBID:           mbid,
				LocalID:        localID,
				Reason:         ReasonResolved,
				AttemptedAt:    attempt,
				FileModifiedAt: currentMtime,
			})
			dirty = true
			return nil
		}

		if writeErr := writeMBIDTag(path, mbid); writeErr != nil {
			log.Printf("MBID resolver: write tag %q: %v", path, writeErr)
			// MBID is known, file write failed. Record so the next pass
			// can retry the write without re-querying MB.
			setMBIDFileState(state, path, &MBIDFileState{
				Resolved:       false,
				MBID:           mbid,
				LocalID:        localID,
				Reason:         ReasonTagWriteFailed,
				AttemptedAt:    attempt,
				FileModifiedAt: currentMtime,
			})
			dirty = true
			return nil
		}

		// Tag was just rewritten — refresh mtime so next pass doesn't
		// treat the change as external.
		if fi, infoErr := os.Stat(path); infoErr == nil {
			currentMtime = fi.ModTime()
		}

		tagWrites++
		mbHits++
		setMBIDFileState(state, path, &MBIDFileState{
			Resolved:       true,
			MBID:           mbid,
			LocalID:        localID,
			Reason:         ReasonResolved,
			AttemptedAt:    attempt,
			FileModifiedAt: currentMtime,
		})
		dirty = true
		return nil
	})

	if walkErr != nil && !errors.Is(walkErr, context.Canceled) {
		log.Printf("MBID resolver: walk ended with error: %v", walkErr)
	}

	passDuration := time.Since(walkStart)
	queriesUsed := initialBudget - queryBudget
	recomputeStats(state, queriesUsed, passDuration)
	dirty = true

	log.Printf(
		"MBID resolver: pass done in %s. tag_writes=%d held_read_only=%d existing_hits=%d no_match=%d transient=%d unsupported=%d skipped_cached=%d cover_writes=%d budget_used=%d/%d",
		passDuration.Round(time.Millisecond),
		tagWrites, heldMatches, mbHits-tagWrites, mbMisses, mbTransient,
		unsupported, skipped, coverWrites, queriesUsed, initialBudget,
	)

	if tagWrites > 0 || coverWrites > 0 {
		if scanErr := triggerNavidromeScan(); scanErr != nil {
			log.Printf("MBID resolver: trigger Navidrome scan: %v", scanErr)
		} else {
			log.Printf("MBID resolver: requested Navidrome rescan (%d new MBIDs, %d new covers)", tagWrites, coverWrites)
		}
	}

	return tagWrites, dirty, nil
}

// recomputeStats walks MBIDResolutionState and recalculates the
// aggregate snapshot. Cheap — even a 100k-file map is microseconds.
//
// PendingRetry counts both ReasonNoMatch entries past their RetryAfter
// and every ReasonTagWriteFailed entry (those have zero RetryAfter and
// retry immediately).
func recomputeStats(state *SidecarState, queriesThisPass int, passDuration time.Duration) {
	now := time.Now()
	s := MBIDResolutionStats{
		LastPassAt:       now,
		LastPassQueries:  queriesThisPass,
		LastPassDuration: passDuration.Round(time.Second).String(),
	}
	for _, f := range state.MBIDResolutionState {
		if f == nil {
			continue
		}
		s.TotalFilesSeen++
		switch f.Reason {
		case ReasonResolved:
			s.ResolvedWithMBID++
		case ReasonNoMatch:
			s.NoMatchCached++
			if !f.RetryAfter.IsZero() && now.After(f.RetryAfter) {
				s.PendingRetry++
			}
		case ReasonInsufficientTags:
			s.InsufficientTags++
		case ReasonTagWriteFailed:
			s.PendingRetry++
		}
	}
	state.MBIDResolutionStats = s
}

// isSupportedAudio is the audio the hub can WRITE into (MBID tag, embedded art):
// FLAC and MP3. Everything that writes a person's files gates on this.
func isSupportedAudio(path string) bool {
	ext := strings.ToLower(extOf(path))
	return ext == ".flac" || ext == ".mp3"
}

// isReadOnlyAudio is audio the library holds and reads but never writes into, nor
// writes beside (no folder cover, no artist photo): Apple's AAC / ALAC files.
// A MusicBrainz match for one is held in state (see attachHeldMBIDs).
func isReadOnlyAudio(path string) bool {
	ext := strings.ToLower(extOf(path))
	return ext == ".m4a" || ext == ".aac"
}

// matchHeldOnHubSide reports whether a song's MusicBrainz match lives in the
// hub's state rather than in the file: a format the hub never writes (M4A), or a
// FLAC/MP3 it must not rewrite because it is a link or set read-only (songHeld,
// BUG-861).
func matchHeldOnHubSide(path string) bool {
	return isReadOnlyAudio(path) || errors.Is(songHeld(path), errSongHeld)
}

// isLibraryAudio is every format the library accepts.
func isLibraryAudio(path string) bool {
	return isSupportedAudio(path) || isReadOnlyAudio(path)
}

// ─── MusicBrainz API ──────────────────────────────────────────────────────

// mbTransientError wraps an error that should NOT be cached as a no-match.
// Examples: HTTP 502/503/504/429, connection refused, request timeout,
// context cancellation. The walker treats these as "try again next pass."
type mbTransientError struct{ err error }

func (e *mbTransientError) Error() string {
	if e == nil || e.err == nil {
		return "transient musicbrainz error"
	}
	return e.err.Error()
}
func (e *mbTransientError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.err
}

// mbRecordingResponse mirrors only the fields we consume. MB's full
// recording schema is much richer; ignoring unknown fields keeps us
// resilient to additions.
type mbRecordingResponse struct {
	Recordings []mbRecording `json:"recordings"`
}

type mbRecording struct {
	ID     string `json:"id"`
	Score  int    `json:"score"`
	Title  string `json:"title"`
	Length int    `json:"length"` // milliseconds, may be 0 if MB does not have a duration
}

// queryMusicBrainz performs a single fuzzy /recording lookup. Returns
// the MBID of the top match if and only if it clears both the score and
// duration thresholds. Returns ("", nil) when there's no acceptable match.
//
// Transient failures (502/503/504/429, network errors, context deadlines)
// are returned as *mbTransientError so the caller can distinguish them
// from genuine no-match outcomes and avoid poisoning the cache.
func queryMusicBrainz(ctx context.Context, client *http.Client, t *trackTags) (string, error) {
	query := buildMBQuery(t)
	u := mbAPIBase + "/recording?query=" + url.QueryEscape(query) + "&fmt=json&limit=5"

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", mbUserAgent)
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		// Network errors and context cancellations are transient. Anything
		// else from net/http (TLS handshake fail, DNS fail) is also a
		// blip rather than a fact about this track.
		return "", &mbTransientError{err: fmt.Errorf("musicbrainz request: %w", err)}
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout, http.StatusTooManyRequests:
		return "", &mbTransientError{err: fmt.Errorf("musicbrainz HTTP %d", resp.StatusCode)}
	}
	if resp.StatusCode >= 500 {
		// Other 5xx — treat as transient as well; MB will recover.
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 256))
		return "", &mbTransientError{err: fmt.Errorf("musicbrainz HTTP %d: %s", resp.StatusCode, string(body))}
	}
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return "", fmt.Errorf("musicbrainz HTTP %d: %s", resp.StatusCode, string(body))
	}

	var parsed mbRecordingResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return "", fmt.Errorf("decode MB response: %w", err)
	}

	for _, rec := range parsed.Recordings {
		if rec.Score < mbAcceptanceScore {
			break // recordings are score-sorted descending; below threshold means none qualify
		}
		// Duration check (when MB has one): tolerate ±N seconds.
		if rec.Length > 0 && t.DurationSeconds > 0 {
			diff := math.Abs(float64(rec.Length)/1000 - float64(t.DurationSeconds))
			if diff > mbDurationToleranceSec {
				continue
			}
		}
		if rec.ID != "" {
			return rec.ID, nil
		}
	}
	return "", nil
}

// buildMBQuery formats a Lucene-style query for the MB /recording endpoint.
// The plan locks the exact field set:
//
//	artist:"X" AND recording:"Y" AND release:"Z" AND dur:N
//
// Where dur is in milliseconds. Release (album) and dur are omitted when
// unknown so we still get a useful fuzzy match.
func buildMBQuery(t *trackTags) string {
	parts := []string{
		fmt.Sprintf(`artist:"%s"`, escapeLuceneQuoted(t.Artist)),
		fmt.Sprintf(`recording:"%s"`, escapeLuceneQuoted(t.Title)),
	}
	if t.Album != "" {
		parts = append(parts, fmt.Sprintf(`release:"%s"`, escapeLuceneQuoted(t.Album)))
	}
	if t.DurationSeconds > 0 {
		parts = append(parts, fmt.Sprintf("dur:%d", t.DurationSeconds*1000))
	}
	return strings.Join(parts, " AND ")
}

// escapeLuceneQuoted escapes the only characters that matter inside a
// double-quoted Lucene field value: backslash and double quote. All other
// Lucene specials (+, -, !, etc.) are inert inside quotes.
func escapeLuceneQuoted(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	return s
}
