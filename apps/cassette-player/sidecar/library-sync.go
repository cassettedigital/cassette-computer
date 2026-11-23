package main

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	libraryPageSize     = 500
	librarySyncInterval = time.Hour
)

var librarySyncMu sync.Mutex

type librarySyncTrack struct {
	SubsonicTrackID        string  `json:"subsonicTrackId"`
	MusicBrainzRecordingID *string `json:"musicbrainzRecordingId"`
	// CassetteLocalID is Layer 1's cross-device identity fallback for
	// tracks without an MBID. Computed in CassetteLocalIDFromSeconds and
	// validated server-side against /^[0-9a-f]{32}$/.
	CassetteLocalID string  `json:"cassetteLocalId"`
	TrackTitle      string  `json:"trackTitle"`
	ArtistName      string  `json:"artistName"`
	AlbumName       string  `json:"albumName"`
	AlbumArtist     *string `json:"albumArtist"`
	DurationSeconds int     `json:"durationSeconds"`
	FileFormat      string  `json:"fileFormat"`
	// Carried disc identity (migration 0034) — attached by carryDiscIdentity from
	// disc_identity.jsonl rung-zero memory. nil when there is no confident disc link.
	ReleaseMBID    *string `json:"releaseMbid"`
	MBDiscID       *string `json:"mbDiscId"`
	DiscTrackIndex *int    `json:"discTrackIndex"`
	// Disc number (which disc in a multi-disc album), read from Navidrome's Subsonic
	// discNumber — the FLAC DISCNUMBER truth. nil when single-disc / absent.
	DiscNumber *int `json:"discNumber"`
	// Content fingerprint of this album's FOLDER cover (cover/folder/front.*), from
	// our own disk walk — see cover-fingerprint.go. Album-grained, so every track of
	// an album carries the same value; the cloud only needs one to survive. nil means
	// UNKNOWN (no cover, or unreadable), which the cloud must treat as "leave the
	// stored value alone" — never as "the cover was removed".
	CoverFingerprint *string `json:"coverFingerprint,omitempty"`
	// Content fingerprint of THIS TRACK'S OWN FILE, from our own disk read — see
	// audio-fingerprint.go. Unlike CoverFingerprint this is per-track, not
	// album-grained: a re-rip that fixes one track leaves its siblings' values
	// alone. nil means UNKNOWN (unreadable this pass), which the cloud must treat
	// as "leave the stored value alone" — never as "the track changed".
	AudioFingerprint *string `json:"audioFingerprint,omitempty"`
	// When this track's file came into being on the hub's disk, Unix seconds (file-born_*.go). A re-rip makes a
	// new file; a tag write keeps the date. A phone whose copy is older than this was made from a file the hub
	// has since replaced, so it fetches the song again (BUG-897). nil means UNKNOWN: leave the stored value alone.
	FileCreatedAt *int64 `json:"fileCreatedAt,omitempty"`
	// Absolute album-relative source path, carried IN-PROCESS ONLY (json:"-") so the
	// cover fingerprinter can locate this track's album folder, and the audio
	// fingerprinter can hash this track's own file. Local filesystem paths must
	// never reach the cloud.
	Path string `json:"-"`
	// Navidrome's own track number for the song (Subsonic "track"), IN-PROCESS ONLY.
	// fillFromFileNames turns it into DiscTrackIndex for every song carry did not
	// place. 0 when the file has no track tag.
	NavidromeTrack int `json:"-"`
}

type librarySyncPayload struct {
	Tracks   []librarySyncTrack `json:"tracks"`
	SyncMode string             `json:"syncMode"`
	// Rich disc-identity records for the shared pool (write path). Quality-gated,
	// stripped of machine-local fields, deduped by mb_disc_id before sending.
	DiscIdentities []poolDiscIdentity `json:"discIdentities,omitempty"`
	// Paged uploads (BUG-789): set on every request of a library sent in pages.
	Page *librarySyncPage `json:"page,omitempty"`
	// On the final page of a paged full sync: every track's id, so the cloud can
	// tell what is gone without one request carrying the whole library.
	AllTrackIDs []string `json:"allTrackIds,omitempty"`
	// This hub's computer id, on every request: the cloud refuses another
	// computer's library (BUG-862). Set in postLibrarySyncRequest.
	ComputerID string `json:"computerId,omitempty"`
}

type librarySyncPage struct {
	Index int  `json:"index"`
	Final bool `json:"final"`
}

// librarySyncPageTracks is how many tracks one request carries: compressed, a
// page sits far under the host's ~4.5 MB request cap and the cloud's 10,000.
const librarySyncPageTracks = 2000

type subsonicSearch3Response struct {
	SubsonicResponse struct {
		Status string `json:"status"`
		Error  struct {
			Code    int    `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
		SearchResult3 struct {
			Song []subsonicSong `json:"song"`
		} `json:"searchResult3"`
	} `json:"subsonic-response"`
}

type subsonicSong struct {
	ID string `json:"id"`
	// Absolute on-disk path. Navidrome only reports the REAL path to a player row
	// with report_real_path=1, which is why the library fetch uses its own client
	// name (see librarySyncClientName). Never leaves this Mac.
	Path               string `json:"path"`
	Title              string `json:"title"`
	Artist             string `json:"artist"`
	Album              string `json:"album"`
	DisplayAlbumArtist string `json:"displayAlbumArtist"`
	Duration           int    `json:"duration"`
	Suffix             string `json:"suffix"`
	ContentType        string `json:"contentType"`
	MusicBrainzID      string `json:"musicBrainzId"`
	DiscNumber         int    `json:"discNumber"`
	Track              int    `json:"track"`
}

func shouldRunLibrarySync(state *SidecarState) bool {
	return state.LastLibrarySyncAt.IsZero() ||
		time.Since(state.LastLibrarySyncAt) >= librarySyncInterval
}

// runLibrarySyncAndSave is the fire-and-forget wrapper used by the heartbeat /
// startup paths: it runs a sync and only logs on failure.
func runLibrarySyncAndSave(state *SidecarState, syncMode string) {
	if _, err := runLibrarySync(state, syncMode); err != nil {
		log.Printf("Library sync failed (will retry later): %v", err)
	}
}

// runLibrarySync runs a resolver pass + full inventory sync + state save, and
// returns the synced track count (so a just-finished rip can confirm its tracks
// registered). It is called both from the heartbeat gate AND immediately after a
// rip (Job 1) — the 1-hour gate lives in the CALLERS (shouldRunLibrarySync), so
// calling this directly bypasses it on purpose.
func runLibrarySync(state *SidecarState, syncMode string) (int, error) {
	count, _, err := runLibrarySyncWithCounts(state, syncMode)
	return count, err
}

// runLibrarySyncWithCounts is runLibrarySync with the richer return: the synced
// track count AND how many of those tracks carry a MusicBrainz recording MBID
// (identified). The ingest progress panel uses these to show "N tracks · M
// identified". runLibrarySync delegates here so its (int, error) contract — used
// by the heartbeat/startup/rip callers — is unchanged.
func runLibrarySyncWithCounts(state *SidecarState, syncMode string) (total int, identified int, err error) {
	return runLibrarySyncReporting(state, syncMode, nil)
}

// runLibrarySyncReporting is runLibrarySyncWithCounts whose resolver run reports
// each lookup to progress as it goes (nil: no one is listening). The ingest uses
// it for the window's live report (ingest-progress.go).
func runLibrarySyncReporting(state *SidecarState, syncMode string, progress resolverProgress) (total int, identified int, err error) {
	librarySyncMu.Lock()
	defer librarySyncMu.Unlock()

	if state.BearerToken == "" {
		return 0, 0, nil
	}
	// A satellite, or a computer the cloud refused as main, reports nothing and writes nothing into its
	// files: the account's library lives on the main computer (satellite.go, BUG-862).
	if asSpare() {
		return 0, 0, nil
	}
	if navidromeAdmin == "" {
		log.Println("Library sync skipped: NAVIDROME_ADMIN_PW is not set.")
		return 0, 0, nil
	}

	// First sync: put the library in front of the person before the MusicBrainz
	// pass, which on a new install can run half an hour at one lookup a second
	// (BUG-789). The pass then runs and the inventory goes up again with what it
	// found.
	if state.LastLibrarySyncAt.IsZero() {
		start := time.Now()
		if count, withMBID, err := syncLibraryInventory(state.BearerToken, syncMode, state); err != nil {
			log.Printf("First library sync (before identification) failed, continuing: %v", err)
		} else {
			state.LastLibrarySyncAt = time.Now()
			if err := saveState(state); err != nil {
				log.Printf("Warning: could not save library sync state: %v", err)
			}
			log.Printf("First library sync: %d tracks (%d identified) up in %s; identifying the rest next.", count, withMBID, time.Since(start).Round(time.Millisecond))
		}
	}

	// Layer 1.5: run a bounded MBID resolver pass before pushing inventory
	// so any newly-written MBIDs appear in this cycle's Subsonic results.
	// passBudgetFor returns both the query budget and the matching
	// context timeout so the first sync's burst budget gets enough
	// wall-clock time to complete.
	_, resolverTimeout := passBudgetFor(state)
	resolverCtx, cancel := context.WithTimeout(context.Background(), resolverTimeout)
	_, resolverDirty, resolverErr := resolveMBIDsOnce(resolverCtx, state, progress)
	cancel()
	if resolverErr != nil {
		log.Printf("MBID resolver pass error (continuing with sync): %v", resolverErr)
	}
	if resolverDirty {
		if err := saveState(state); err != nil {
			log.Printf("Warning: could not save resolver state: %v", err)
		}
	}

	start := time.Now()
	count, withMBID, err := syncLibraryInventory(state.BearerToken, syncMode, state)
	if err != nil {
		return 0, 0, err
	}

	state.LastLibrarySyncAt = time.Now()
	if err := saveState(state); err != nil {
		log.Printf("Warning: could not save library sync state: %v", err)
	}
	log.Printf("Library sync complete: %d tracks (%d identified) (%s, %s).", count, withMBID, syncMode, time.Since(start).Round(time.Millisecond))
	return count, withMBID, nil
}

// countIndexedAlbumTracks returns how many songs of the given album Navidrome
// currently has indexed (via Subsonic search3). Used to poll until a fresh rip
// has actually been ingested before we claim library presence (Job 1).
func countIndexedAlbumTracks(album string) int {
	params := url.Values{
		"u":           {navidromeAdminUser},
		"p":           {navidromeAdmin},
		"v":           {"1.16.1"},
		"c":           {"cassette-sidecar"},
		"f":           {"json"},
		"query":       {album},
		"songCount":   {"500"},
		"albumCount":  {"0"},
		"artistCount": {"0"},
	}
	endpoint := navidromeBase + "/rest/search3?" + params.Encode()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return 0
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0
	}
	defer resp.Body.Close()

	var result subsonicSearch3Response
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return 0
	}
	// Match on the SAME normalized key the reinsert "in library" hint uses
	// (normalizeForLocalID via albumKey), not a strict exact-name compare — so a
	// punctuation/case/diacritic drift between the written tag and the matched
	// release name can't make a genuinely-indexed album read as "not indexed"
	// (which would strand it on the heartbeat gate — BUG-108).
	count := 0
	want := normalizeForLocalID(album)
	if want == "" {
		return 0
	}
	for _, s := range result.SubsonicResponse.SearchResult3.Song {
		if normalizeForLocalID(s.Album) == want {
			count++
		}
	}
	return count
}

// syncLibraryInventory pushes the full Subsonic inventory to the cloud and
// returns (total, identified): total tracks sent, and how many of those carry a
// MusicBrainz recording MBID (MusicBrainzRecordingID != nil, set by
// mapSubsonicSong from the file's tag). identified is the live progress panel's
// "M identified" — counted from the same payload that reached the cloud.
func syncLibraryInventory(token string, syncMode string, state *SidecarState) (total int, identified int, err error) {
	tracks, err := fetchAllSubsonicSongs()
	if err != nil {
		return 0, 0, err
	}
	// #3 — pull the user's post-rip re-matches from the cloud and rewrite the local
	// disc-identity records FIRST, so a correction reaches both this Mac's memory and
	// the shared pool in THIS sync (durable — no revert, the source of truth now
	// agrees). Best-effort: a failure just skips reconciliation for the sync.
	reconcileServerRelinks()

	// Read-only files (M4A) never carry our MusicBrainz match in their own tags,
	// so the match the resolver held for them rides along here.
	attachHeldMBIDs(tracks, state)

	// Attach the rip's confirmed disc identity (mb_disc_id / release_mbid / disc
	// position) from rung-zero memory so the cloud reuses it instead of re-deriving
	// (Stage 1) and the delete tombstone survives a re-rip (Stage 2).
	carryDiscIdentity(tracks)

	// Every other song's number on its disc (Navidrome's track number, else its file
	// name's), and a title without the file name's number when the title IS the file
	// name. After carry, so a CD rip's placement always wins (library-filename.go).
	fillFromFileNames(tracks)

	// Folder-cover fingerprints: stamp each track with its album's cover fingerprint
	// and learn which albums' cover BYTES changed since the last sync.
	//
	// LOAD-BEARING ORDERING. Navidrome's artwork cache key embeds the folder's
	// ImagesUpdatedAt, which only advances when a SCAN re-hashes that folder. If we
	// reported the new fingerprint first, a phone could fetch getCoverArt while
	// Navidrome still served the cached OLD bytes, write them, and stamp the new
	// fingerprint as applied — pinning that album to stale art permanently. So we
	// force the rescan and BLOCK until it settles BEFORE posting.
	coverPass := attachCoverFingerprints(tracks, state)
	if len(coverPass.ChangedDirs) > 0 {
		log.Printf("cover-fp: %d album folder(s) changed — rescanning Navidrome before reporting", len(coverPass.ChangedDirs))
		confirmedIdle := false
		if scanErr := triggerNavidromeScanMode(coverPass.NeedFullScan); scanErr != nil {
			log.Printf("cover-fp: scan trigger failed: %v", scanErr)
		} else {
			// Tighter budget than the ingest path's full 60s: this runs while the
			// library-sync mutex is held, and the heartbeat plus the next ingest are
			// already backstops, so blocking longer buys nothing.
			confirmedIdle = waitForScanIdle(coverScanIdleMaxWait)
		}
		if confirmedIdle {
			coverPass.Commit(state)
			if state != nil {
				if saveErr := saveState(state); saveErr != nil {
					log.Printf("cover-fp: could not persist cover observations: %v", saveErr)
				}
			}
		} else {
			// The rescan did not finish (big library, or status unavailable), so
			// Navidrome may still serve the OLD bytes for these albums. Reporting the
			// NEW fingerprint now would have a device fetch stale art and stamp it as
			// converged — permanently. Withhold, record nothing, retry next sync.
			withheld := coverPass.WithholdChanged(tracks)
			log.Printf("cover-fp: rescan not confirmed idle — withholding %d track fingerprint(s); will retry next sync", withheld)
		}
	}

	// Audio content fingerprints: stamp each track with a fingerprint of its own
	// file. No confirmed-rescan gating needed here — see the ordering comment on
	// the cover pass above and audio-fingerprint.go's file-level comment for why.
	attachAudioFingerprints(tracks, state)
	if state != nil {
		if saveErr := saveState(state); saveErr != nil {
			log.Printf("audio-fp: could not persist track observations: %v", saveErr)
		}
	}

	for _, t := range tracks {
		if t.MusicBrainzRecordingID != nil && *t.MusicBrainzRecordingID != "" {
			identified++
		}
	}

	// A drive that's unplugged or a NAS that's asleep looks empty, and a full sync tells the cloud that
	// whatever it didn't list is gone, so every phone would drop those songs. While any folder of the
	// library is away, only what's here goes up; nothing is marked gone until every folder answers again
	// (library-folders.go, #1163). Checked after the list is read, so a drive that left mid-read counts.
	if syncMode == "full" {
		if away := awayFolders(state); len(away) > 0 {
			log.Printf("Library sync: %d folder(s) away (%s); sending what's here, removing nothing", len(away), strings.Join(away, ", "))
			syncMode = "delta"
		}
	}

	payload := librarySyncPayload{
		Tracks:         tracks,
		SyncMode:       syncMode,
		DiscIdentities: gatherPoolDiscIdentities(),
	}
	if err := postLibrarySync(token, payload); err != nil {
		return 0, 0, err
	}
	rememberSyncedTracks(tracks)
	return len(tracks), identified, nil
}

// syncedTrackIDs is every song id the last successful sync reported to the
// cloud: nil until one has, this run of the hub. The ingest report reads it to
// tell the songs an ingest brings in from the ones already there
// (ingestNewSongs). Each sync swaps in a fresh map and never changes one it
// has handed out, so a reader may keep it.
var (
	syncedTrackIDsMu sync.Mutex
	syncedTrackIDs   map[string]struct{}
)

func rememberSyncedTracks(tracks []librarySyncTrack) {
	ids := make(map[string]struct{}, len(tracks))
	for _, t := range tracks {
		ids[t.SubsonicTrackID] = struct{}{}
	}
	syncedTrackIDsMu.Lock()
	syncedTrackIDs = ids
	syncedTrackIDsMu.Unlock()
}

func lastSyncedTrackIDs() map[string]struct{} {
	syncedTrackIDsMu.Lock()
	defer syncedTrackIDsMu.Unlock()
	return syncedTrackIDs
}

func fetchAllSubsonicSongs() ([]librarySyncTrack, error) {
	var out []librarySyncTrack
	for offset := 0; ; offset += libraryPageSize {
		songs, err := fetchSubsonicSongsPage(offset, libraryPageSize)
		if err != nil {
			return nil, err
		}
		for _, song := range songs {
			if song.ID == "" || song.Title == "" {
				continue
			}
			out = append(out, mapSubsonicSong(song))
		}
		if len(songs) < libraryPageSize {
			break
		}
	}
	return out, nil
}

// librarySyncClientName is DELIBERATELY distinct from the sidecar's usual client
// string. Navidrome stores report_real_path per PLAYER ROW and only new rows inherit
// ND_SUBSONIC_DEFAULTREPORTREALPATH=true — the long-lived "cassette-sidecar" row was
// created before that and reports a RELATIVE, tag-synthesized path whose directories
// often do not exist on disk. This dedicated name mints a row that reports the true
// absolute path, which is what lets the cover fingerprinter find album folders for
// EVERY audio format without parsing tags. Changing this string re-mints the row.
const librarySyncClientName = "cassette-fp"

func fetchSubsonicSongsPage(offset int, count int) ([]subsonicSong, error) {
	params := url.Values{
		"u":          {navidromeAdminUser},
		"p":          {navidromeAdmin},
		"v":          {"1.16.1"},
		"c":          {librarySyncClientName},
		"f":          {"json"},
		"query":      {""},
		"songCount":  {fmt.Sprintf("%d", count)},
		"songOffset": {fmt.Sprintf("%d", offset)},
	}

	endpoint := navidromeBase + "/rest/search3?" + params.Encode()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("search3 request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read search3 response: %w", err)
	}
	log.Printf("search3 response: status=%d content-type=%q body=%.500q",
		resp.StatusCode, resp.Header.Get("Content-Type"), string(respBody))

	var result subsonicSearch3Response
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, fmt.Errorf("decode search3 response: %w (body: %.200q)", err, respBody)
	}
	if result.SubsonicResponse.Status != "ok" {
		return nil, fmt.Errorf(
			"Navidrome search3 error %d: %s",
			result.SubsonicResponse.Error.Code,
			result.SubsonicResponse.Error.Message,
		)
	}
	return result.SubsonicResponse.SearchResult3.Song, nil
}

func mapSubsonicSong(song subsonicSong) librarySyncTrack {
	var mbid *string
	if strings.TrimSpace(song.MusicBrainzID) != "" {
		v := strings.TrimSpace(song.MusicBrainzID)
		mbid = &v
	}

	fileFormat := strings.ToLower(strings.TrimSpace(song.Suffix))
	if fileFormat == "" && strings.Contains(song.ContentType, "/") {
		parts := strings.Split(song.ContentType, "/")
		fileFormat = strings.ToLower(parts[len(parts)-1])
	}

	var albumArtist *string
	if v := strings.TrimSpace(song.DisplayAlbumArtist); v != "" {
		albumArtist = &v
	}

	var discNumber *int
	if song.DiscNumber > 0 {
		d := song.DiscNumber
		discNumber = &d
	}

	return librarySyncTrack{
		SubsonicTrackID:        song.ID,
		MusicBrainzRecordingID: mbid,
		CassetteLocalID:        CassetteLocalIDFromSeconds(song.Artist, song.Title, song.Duration),
		TrackTitle:             song.Title,
		ArtistName:             song.Artist,
		AlbumName:              song.Album,
		AlbumArtist:            albumArtist,
		DurationSeconds:        song.Duration,
		FileFormat:             fileFormat,
		DiscNumber:             discNumber,
		Path:                   song.Path,
		NavidromeTrack:         song.Track,
	}
}

// attachHeldMBIDs gives a file the hub never writes into (matchHeldOnHubSide: an
// M4A, or a FLAC/MP3 that is a link or set read-only) the MusicBrainz match the
// resolver found for it. Other FLAC/MP3 carry their match in their own tag, which
// Navidrome reports; a held one lives only in the resolver state. A held match is
// dropped the moment the file changes on disk (mtime differs), so a later re-tag
// in another program is never shadowed. A tag the file already carries (Navidrome
// reported it) always wins.
func attachHeldMBIDs(tracks []librarySyncTrack, state *SidecarState) {
	if state == nil || len(state.MBIDResolutionState) == 0 {
		return
	}
	for i := range tracks {
		t := &tracks[i]
		if t.MusicBrainzRecordingID != nil || t.Path == "" {
			continue
		}
		held := state.MBIDResolutionState[filepath.Clean(t.Path)]
		if held == nil || !held.Resolved || held.MBID == "" || held.FileModifiedAt.IsZero() {
			continue
		}
		if !matchHeldOnHubSide(t.Path) {
			continue
		}
		fi, err := os.Stat(t.Path)
		if err != nil || !fi.ModTime().Equal(held.FileModifiedAt) {
			continue
		}
		mbid := held.MBID
		t.MusicBrainzRecordingID = &mbid
	}
}

// errCloudWantsOneRequest means the cloud is older than paged, compressed
// uploads: it read the compressed body as broken JSON and wrote nothing.
var errCloudWantsOneRequest = errors.New("cloud takes the library in one uncompressed request")

// postLibrarySync sends the library to the cloud. A library up to one page goes
// in one compressed request. A bigger one goes as pages that only add and update,
// then a final page carrying every track's id, which is the only one that may
// remove anything (BUG-789). One request used to carry everything, which failed
// once a library passed about 5,000 songs. Against an older cloud, which turns
// the first compressed request away before writing anything, it sends the old
// single request instead.
func postLibrarySync(token string, payload librarySyncPayload) error {
	if payload.Tracks == nil {
		payload.Tracks = []librarySyncTrack{}
	}
	if len(payload.Tracks) <= librarySyncPageTracks {
		err := postLibrarySyncRequest(token, payload, true, 30*time.Second)
		if errors.Is(err, errCloudWantsOneRequest) {
			return postLibrarySyncRequest(token, payload, false, 30*time.Second)
		}
		return err
	}

	var pages [][]librarySyncTrack
	for i := 0; i < len(payload.Tracks); i += librarySyncPageTracks {
		pages = append(pages, payload.Tracks[i:min(i+librarySyncPageTracks, len(payload.Tracks))])
	}
	for i, tracks := range pages {
		page := librarySyncPayload{Tracks: tracks, SyncMode: "delta", Page: &librarySyncPage{Index: i}}
		err := postLibrarySyncRequest(token, page, true, 30*time.Second)
		if i == 0 && errors.Is(err, errCloudWantsOneRequest) {
			return postLibrarySyncRequest(token, payload, false, 30*time.Second)
		}
		if err != nil {
			return fmt.Errorf("library page %d of %d: %w", i+1, len(pages), err)
		}
	}
	final := librarySyncPayload{
		Tracks:         []librarySyncTrack{},
		SyncMode:       payload.SyncMode,
		DiscIdentities: payload.DiscIdentities,
		Page:           &librarySyncPage{Index: len(pages), Final: true},
	}
	if payload.SyncMode == "full" {
		final.AllTrackIDs = make([]string, 0, len(payload.Tracks))
		for _, t := range payload.Tracks {
			final.AllTrackIDs = append(final.AllTrackIDs, t.SubsonicTrackID)
		}
	}
	// The final page does the whole-library work on the cloud's side: give it longer.
	return postLibrarySyncRequest(token, final, true, 90*time.Second)
}

func postLibrarySyncRequest(token string, payload librarySyncPayload, compress bool, timeout time.Duration) error {
	payload.ComputerID = computerID
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if compress {
		var buf bytes.Buffer
		zw := gzip.NewWriter(&buf)
		if _, err := zw.Write(b); err != nil {
			return err
		}
		if err := zw.Close(); err != nil {
			return err
		}
		b = buf.Bytes()
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		cassetteBase+"/api/player/library-sync",
		bytes.NewReader(b),
	)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	if compress {
		req.Header.Set("Content-Encoding", "gzip")
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("library-sync request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		if compress && (resp.StatusCode == http.StatusUnsupportedMediaType ||
			(resp.StatusCode == http.StatusBadRequest && strings.Contains(string(body), "Invalid JSON body"))) {
			return errCloudWantsOneRequest
		}
		return fmt.Errorf("cassette API POST /api/player/library-sync → %d", resp.StatusCode)
	}
	return nil
}
