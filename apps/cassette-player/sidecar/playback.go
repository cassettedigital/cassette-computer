// Native playback brokering (Native Playback — The Real Player, SPEC §6).
//
// Web is a remote control, not a player. The browser POSTs commands (an ordered
// queue, where the web resolves coverage: catalog then owned local tracks, plus
// transport verbs) to this sidecar. The broker is the shared, cross-platform
// Source: it resolves each track id to a local Subsonic stream URL with the env
// creds and hands the queue plus commands to the OS-neutral playbackOut seam. On
// macOS that forwards to the in-process Swift/AVFoundation host; on Windows it
// drives a bundled headless mpv.exe. The browser never streams.
//
// State flows back through playbackOut.state(): the broker proxies it at
// GET /api/playback/state (the web polls it), and a background poller watches the
// same state to log plays at the scrobble threshold.
//
// The output engine (per OS) lives behind playbackPlatform in
// playback_platform*.go. Everything here is platform-neutral: id resolution, the
// queue store, the HTTP handlers, and play-logging.

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const maxTrackIDLen = 128

// ─── Source resolution (the broker's cross-platform Source) ────────────────────

// subsonicStreamURL turns a Navidrome track id into a local Subsonic /rest/stream
// URL, authenticated with the admin creds the sidecar already uses for library
// sync (plaintext p= auth over loopback). Reused unchanged for future engines.
//
// NOTE (hardening, SPEC §5): this URL carries the admin password. It stays on
// loopback and is never logged — the broker logs track ids, the Swift player logs
// neither id nor URL. Remaining: have the Swift /play server validate the host is
// the local Navidrome before playing.
func subsonicStreamURL(trackID string) string {
	params := url.Values{
		"id": {trackID},
		"u":  {navidromeAdminUser},
		"p":  {navidromeAdmin},
		"v":  {"1.16.1"},
		"c":  {"cassette-sidecar"},
	}
	return navidromeBase + "/rest/stream?" + params.Encode()
}

// subsonicCoverArtURL turns a Navidrome id (song/album/artist) into a local
// Subsonic /rest/getCoverArt URL, authenticated with the same admin creds as
// subsonicStreamURL. size<=0 omits the size param — Navidrome then serves the
// original (full-resolution) cover. Like the stream URL, this carries the admin
// password: it stays on loopback, is never logged, and is never handed to the
// browser — the browser reaches cover art only through handlePlaybackCover.
func subsonicCoverArtURL(id string, size int) string {
	params := url.Values{
		"id": {id},
		"u":  {navidromeAdminUser},
		"p":  {navidromeAdmin},
		"v":  {"1.16.1"},
		"c":  {"cassette-sidecar"},
	}
	if size > 0 {
		params.Set("size", strconv.Itoa(size))
	}
	return navidromeBase + "/rest/getCoverArt?" + params.Encode()
}

// subsonicGetSongURL builds the getSong lookup URL (admin creds, JSON), used to
// resolve a song id to its canonical cover-art id (see resolveCoverArtID).
func subsonicGetSongURL(id string) string {
	params := url.Values{
		"id": {id},
		"u":  {navidromeAdminUser},
		"p":  {navidromeAdmin},
		"v":  {"1.16.1"},
		"c":  {"cassette-sidecar"},
		"f":  {"json"},
	}
	return navidromeBase + "/rest/getSong?" + params.Encode()
}

// subsonicGetSongRealPathURL is getSong asked as the client whose Navidrome player
// row reports REAL filesystem paths (see librarySyncClientName).
//
// report_real_path is stored per player row, and the legacy "cassette-sidecar" row
// has it OFF — so Navidrome answers with a path SYNTHESIZED from the track's tags
// rather than the file's actual location. That synthetic path is convincing, and it
// matches for most albums because our ripper names files the same way, which is why
// this went unnoticed. It diverges exactly where tags and filenames legitimately
// differ, e.g.:
//
//	reported 01-02 - Method Acting.flac   on disk 02 - Method Acting.flac   (disc prefix)
//	reported 09 - Why Am I Alive Now?.flac  on disk 09 - Why Am I Alive Now.flac  ("?")
//	reported 12 - Easy_Lucky_Free.flac    on disk 12 - Easy-Lucky-Free.flac  ("/")
//
// Anything resolving a track to a path it intends to READ OR WRITE must use this,
// or it silently addresses a file that does not exist. Used by getSongPath, which
// backs both the Trash door and the cover-replace door.
func subsonicGetSongRealPathURL(id string) string {
	params := url.Values{
		"id": {id},
		"u":  {navidromeAdminUser},
		"p":  {navidromeAdmin},
		"v":  {"1.16.1"},
		"c":  {librarySyncClientName},
		"f":  {"json"},
	}
	return navidromeBase + "/rest/getSong?" + params.Encode()
}

func isPlausibleTrackID(id string) bool {
	if id == "" || len(id) > maxTrackIDLen {
		return false
	}
	return !strings.ContainsAny(id, " \t\r\n")
}

// ─── Current queue (kept for play-logging metadata) ────────────────────────────

// queueTrack is what the web sends per track: the id + the metadata needed for
// state, system Now Playing, and play-logging (mbid/title/artist/duration).
type queueTrack struct {
	SubsonicTrackID string  `json:"subsonicTrackId"`
	Title           string  `json:"title"`
	Artist          string  `json:"artist"`
	Album           string  `json:"album"`
	DurationSeconds float64 `json:"durationSeconds"`
	MBID            string  `json:"mbid"`
}

var (
	queueMu      sync.Mutex
	currentQueue []queueTrack // last queue forwarded to Swift, indexed as Swift indexes it
)

func setCurrentQueue(q []queueTrack) {
	queueMu.Lock()
	currentQueue = q
	queueMu.Unlock()
}

// queueTrackAt returns the metadata for a Swift queueIndex, verifying the id
// matches (guards against a stale queue vs. a newer state read).
func queueTrackAt(idx int, trackID string) (queueTrack, bool) {
	queueMu.Lock()
	defer queueMu.Unlock()
	if idx < 0 || idx >= len(currentQueue) {
		return queueTrack{}, false
	}
	t := currentQueue[idx]
	if t.SubsonicTrackID != trackID {
		return queueTrack{}, false
	}
	return t, true
}

// ─── Web → broker: play (queue) ────────────────────────────────────────────────

type playRequest struct {
	Queue      []queueTrack `json:"queue"`
	StartIndex int          `json:"startIndex"`
	Repeat     string       `json:"repeat"`
}

func handlePlaybackPlay(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req playRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Queue) == 0 {
		writePlaybackJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "queue is required"})
		return
	}

	resolved, kept := resolveQueue(req.Queue)
	if len(resolved) == 0 {
		writePlaybackJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "no playable tracks"})
		return
	}
	start := req.StartIndex
	if start < 0 || start >= len(resolved) {
		start = 0
	}

	// Keep the metadata for play-logging, then hand the resolved queue to the
	// per-OS output engine.
	setCurrentQueue(kept)
	log.Printf("playback: play queue of %d (start %d) → engine", len(resolved), start)
	if err := playbackOut.play(resolved, start, normalizeRepeat(req.Repeat)); err != nil {
		log.Printf("playback: could not reach the native player: %v", err)
		writePlaybackJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "could not reach the native player"})
		return
	}
	writePlaybackJSON(w, http.StatusOK, map[string]any{"ok": true, "count": len(resolved)})
}

// resolveQueue resolves each id to its stream URL (the broker Source), skipping
// malformed ids, and returns the engine's list alongside the metadata kept for
// play-logging. Never nil, so an empty list still marshals as [] for the engine.
func resolveQueue(q []queueTrack) ([]resolvedTrack, []queueTrack) {
	resolved := make([]resolvedTrack, 0, len(q))
	kept := make([]queueTrack, 0, len(q))
	for _, t := range q {
		id := strings.TrimSpace(t.SubsonicTrackID)
		if !isPlausibleTrackID(id) {
			continue
		}
		t.SubsonicTrackID = id
		// On a satellite the song plays from this computer's copy, under the id the desk knows it by
		// (the main computer's), so the player's answers still match the desk's queue. A song not on
		// this computer is left out (satellite.go).
		local := localSongID(id)
		if local == "" {
			continue
		}
		resolved = append(resolved, resolvedTrack{
			TrackID: id, URL: subsonicStreamURL(local),
			Title: t.Title, Artist: t.Artist, Album: t.Album, DurationSeconds: t.DurationSeconds,
		})
		kept = append(kept, t)
	}
	return resolved, kept
}

// upcomingRequest is /api/playback/queue's body: the songs to play after the
// current one, in order, in /play's item shape.
type upcomingRequest struct {
	Queue []queueTrack `json:"queue"`
}

// handlePlaybackQueue replaces everything after the current song and leaves the
// current song playing where it is: the desk's shuffle switch acting on what is
// playing (One Home, 2026-10-28). An empty queue clears what's next. Ids are
// resolved exactly as /play resolves them.
func handlePlaybackQueue(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req upcomingRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Queue == nil {
		writePlaybackJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "queue is required"})
		return
	}
	resolved, kept := resolveQueue(req.Queue)
	log.Printf("playback: next %d after the current song → engine", len(resolved))
	if err := playbackOut.setUpcoming(resolved); err != nil {
		log.Printf("playback: could not reach the native player: %v", err)
		writePlaybackJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "could not reach the native player"})
		return
	}
	// Play-logging reads the metadata by the engine's own index, so keep it lined
	// up with what the engine now holds: what it kept, then the new songs.
	if st, err := playbackOut.state(); err == nil {
		replaceUpcomingQueue(st.QueueIndex, kept)
	}
	writePlaybackJSON(w, http.StatusOK, map[string]any{"ok": true, "count": len(resolved)})
}

// replaceUpcomingQueue keeps the play-logging metadata aligned after setUpcoming:
// the entries up to and including the engine's current index stay, the new
// upcoming songs follow. A head the sidecar never saw (a queue started before it
// restarted) is padded with empty entries, which never match a track id, so a
// song is never logged under another song's metadata. Nothing loaded (index -1):
// the engine kept nothing, and neither does this.
func replaceUpcomingQueue(index int, upcoming []queueTrack) {
	if index < 0 {
		return
	}
	queueMu.Lock()
	defer queueMu.Unlock()
	head := make([]queueTrack, index+1)
	copy(head, currentQueue)
	currentQueue = append(head, upcoming...)
}

func normalizeRepeat(m string) string {
	switch m {
	case "all", "one":
		return m
	default:
		return "off"
	}
}

// ─── Web → broker: transport verbs ─────────────────────────────────────────────

func handlePlaybackPause(w http.ResponseWriter, r *http.Request)  { transportVerb(w, r, playbackOut.pause) }
func handlePlaybackResume(w http.ResponseWriter, r *http.Request) { transportVerb(w, r, playbackOut.resume) }
func handlePlaybackNext(w http.ResponseWriter, r *http.Request)   { transportVerb(w, r, playbackOut.next) }
func handlePlaybackPrev(w http.ResponseWriter, r *http.Request)   { transportVerb(w, r, playbackOut.prev) }

// transportVerb runs a no-argument engine command and reports ok/err, the shared
// shape for pause/resume/next/prev.
func transportVerb(w http.ResponseWriter, r *http.Request, fn func() error) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := fn(); err != nil {
		writePlaybackJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "could not reach the native player"})
		return
	}
	writePlaybackJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func handlePlaybackSeek(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		PositionSeconds float64 `json:"positionSeconds"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if err := playbackOut.seek(body.PositionSeconds); err != nil {
		writePlaybackJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "could not reach the native player"})
		return
	}
	writePlaybackJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func handlePlaybackRepeat(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Mode string `json:"mode"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	if err := playbackOut.setRepeat(normalizeRepeat(body.Mode)); err != nil {
		writePlaybackJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "could not reach the native player"})
		return
	}
	writePlaybackJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func handlePlaybackVolume(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var body struct {
		Level float64 `json:"level"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body)
	level := body.Level
	if level < 0 {
		level = 0
	} else if level > 1 {
		level = 1
	}
	if err := playbackOut.setVolume(level); err != nil {
		writePlaybackJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "could not reach the native player"})
		return
	}
	writePlaybackJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ─── Web ← broker: live state (from the per-OS output engine) ──────────────────

func handlePlaybackState(w http.ResponseWriter, r *http.Request) {
	st, err := fetchSwiftState()
	if err != nil {
		// Fail-soft: report a quiet "nothing playing" rather than an error the
		// web poller would have to special-case.
		writePlaybackJSON(w, http.StatusOK, map[string]any{
			"currentTrackId": nil, "positionSeconds": 0, "durationSeconds": 0,
			"isPlaying": false, "queueIndex": -1, "queueLength": 0,
		})
		return
	}
	writePlaybackJSON(w, http.StatusOK, map[string]any{
		"currentTrackId":  nullableID(st.CurrentTrackID),
		"positionSeconds": st.PositionSeconds,
		"durationSeconds": st.DurationSeconds,
		"isPlaying":       st.IsPlaying,
		"queueIndex":      st.QueueIndex,
		"queueLength":     st.QueueLength,
	})
}

func nullableID(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// fetchSwiftState reads the live transport snapshot from the active output
// engine. The name is retained because the card-actions helper and the
// play-logger both call it; the actual read is per-OS behind playbackOut.state().
func fetchSwiftState() (playbackState, error) {
	return playbackOut.state()
}

// ─── Clients ← broker: cover art (Navidrome getCoverArt proxy) ─────────────────

// resolveCoverArtID maps a Subsonic song id to a cover-art id Navidrome can
// actually serve. getCoverArt does NOT accept a raw song id — it answers with
// Subsonic error 70 "Artwork not found" — so we look the song up and use its
// canonical coverArt id (e.g. "al-<albumId>_0"), falling back to the bare album
// id, then to the raw id as a last resort. Best-effort: any lookup failure
// returns the raw id and the caller's clean-404 path covers a genuine miss.
func resolveCoverArtID(ctx context.Context, songID string) string {
	// A satellite knows the song by its own id (satellite.go); the desk holds the main computer's.
	if local := localSongID(songID); local != "" {
		songID = local
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, subsonicGetSongURL(songID), nil)
	if err != nil {
		return songID
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return songID
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return songID
	}
	var body struct {
		Response struct {
			Status string `json:"status"`
			Song   struct {
				CoverArt string `json:"coverArt"`
				AlbumID  string `json:"albumId"`
			} `json:"song"`
		} `json:"subsonic-response"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&body); err != nil {
		return songID
	}
	if body.Response.Status != "ok" {
		return songID
	}
	if id := strings.TrimSpace(body.Response.Song.CoverArt); id != "" {
		return id
	}
	if id := strings.TrimSpace(body.Response.Song.AlbumID); id != "" {
		return id
	}
	return songID
}

// handlePlaybackCover proxies a track's cover from the local Navidrome to the
// caller, keyed off the track id the caller already holds. It is the single hub
// for now-playing art: the SwiftUI card, macOS Control Center, and the web
// transport bar all consume it. The sidecar is the only component with admin
// creds, so it is the boundary — the browser must never hit Navidrome (:4533)
// directly with the admin password.
//
// No-art handling: Navidrome streams the raw image on success but returns a
// Subsonic error document (XML/JSON, error 70 "not found", often still HTTP 200)
// when a track has no local art. We never stream that error body as an image —
// anything that isn't an image, or any non-200, becomes a clean 404 so clients
// fall back to a placeholder. This case is routine: the sidecar materializes
// cover.jpg asynchronously, so a track can briefly have no local art. The
// fallback covers that timing gap.
func handlePlaybackCover(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	trackID := strings.TrimSpace(r.URL.Query().Get("trackId"))
	if !isPlausibleTrackID(trackID) {
		http.Error(w, "bad trackId", http.StatusBadRequest)
		return
	}
	size := 0
	if s := strings.TrimSpace(r.URL.Query().Get("size")); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			size = n
		}
	}

	// Fast path: stream the album's on-disk folder cover directly — no Navidrome
	// getCoverArt round-trip and no resize. The folder cover is the source of truth
	// every device reads, so serving it straight off disk is what makes covers
	// appear instantly on the desktop app instead of after a beat of skeleton. Falls
	// through to the Navidrome proxy below when the album has no folder cover yet
	// (unmatched / not-yet-materialized), which also covers that timing gap.
	if coverPath := folderCoverPathForTrack(trackID); coverPath != "" {
		if serveFolderCover(w, r, coverPath, size) {
			return
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	// getCoverArt won't accept the raw song id — resolve it to the song's
	// canonical coverArt id (or album id) first.
	coverID := resolveCoverArtID(ctx, trackID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, subsonicCoverArtURL(coverID, ladderRung(size)), nil)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		// Navidrome unreachable → 404 so clients show the placeholder, not an error.
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	defer resp.Body.Close()

	ct := resp.Header.Get("Content-Type")
	if resp.StatusCode != http.StatusOK || !strings.HasPrefix(ct, "image/") {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	// This Navidrome fallback is only for albums with no folder cover yet (or art only inside the
	// files), at the same address a folder cover takes once one lands, so it is never kept: still
	// no-cache, so a late materialize isn't hidden behind it (BUG-106). It carries an ETag, so the ask
	// that comes back each time is answered "not changed" without sending the picture again (BUG-920;
	// it had no validator, so every ask was the whole picture). An ETag and not a date: the folder
	// cover that lands later answers by date (ServeContent), and a cover copied in with an older date
	// than Navidrome's would then read as "not changed"; ServeContent never matches an ETag it didn't set.
	w.Header().Set("Cache-Control", coverCacheRevalidate)
	if tag := navidromeCoverETag(coverID, ladderRung(size), resp.Header.Get("Last-Modified")); tag != "" {
		w.Header().Set("ETag", tag)
		if etagListed(r.Header.Get("If-None-Match"), tag) {
			w.WriteHeader(http.StatusNotModified)
			return
		}
	}
	w.Header().Set("Content-Type", ct)
	if cl := resp.Header.Get("Content-Length"); cl != "" {
		w.Header().Set("Content-Length", cl)
	}
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, resp.Body)
}

// ─── Play-logging poller (Principle 2: the renderer logs) ──────────────────────

// startPlayLogger polls the output engine's state and, when the current track
// crosses the scrobble threshold (~50% played or ~4 min), POSTs one play to the
// existing /api/sync/plays. The host renders the audio, so the host logs the play,
// tagged source_device="mac". Keyed on cassette_local_id (computed locally), which
// is what the endpoint expects.
func startPlayLogger() {
	const scrobbleSeconds = 240.0
	// Adaptive poll cadence: brisk while audio is playing (the CPU is already
	// awake rendering it, so the poll is ~free), and backed off hard when idle so
	// the Mac can actually sleep instead of waking every 3s around the clock.
	const activePollInterval = 3 * time.Second
	const idlePollInterval = 15 * time.Second
	go func() {
		ticker := time.NewTicker(activePollInterval)
		defer ticker.Stop()
		loggedKey := "" // trackId@queueIndex of the play we already logged
		failureSeq := 0 // newest engine failure already logged
		for range ticker.C {
			st, err := fetchSwiftState()
			// Re-arm the cadence each pass off the live playing state.
			if err == nil && st.IsPlaying {
				ticker.Reset(activePollInterval)
			} else {
				ticker.Reset(idlePollInterval)
			}
			// Before the not-playing skip: a queue that failed through to its end
			// has stopped, and its failures still need their trace.
			if err == nil {
				failureSeq = logEngineFailures(st.Failures, failureSeq, getSongPath)
			}
			if err != nil || st.CurrentTrackID == "" || !st.IsPlaying {
				continue
			}
			key := fmt.Sprintf("%s@%d", st.CurrentTrackID, st.QueueIndex)
			if key == loggedKey {
				continue
			}
			crossed := st.PositionSeconds >= scrobbleSeconds ||
				(st.DurationSeconds > 0 && st.PositionSeconds >= st.DurationSeconds*0.5)
			if !crossed {
				continue
			}
			meta, ok := queueTrackAt(st.QueueIndex, st.CurrentTrackID)
			if !ok {
				continue
			}
			if err := postPlay(meta, st); err != nil {
				log.Printf("playback: play-log failed (will retry next pass): %v", err)
				continue
			}
			loggedKey = key
			log.Printf("playback: logged play of %q", meta.Title)
		}
	}()
}

// logEngineFailures logs each engine failure newer than seen, naming the song's
// file (looked up by its track id) and the engine's error, so a song that won't
// play leaves a trace in the hub's log, which the app keeps; the audio helper's
// own output goes nowhere in the app (BUG-791). Returns the newest seq logged. A
// newest seq below seen means the helper restarted and counts from 1 again.
func logEngineFailures(failures []playbackFailure, seen int, pathOf func(trackID string) (string, error)) int {
	if n := len(failures); n > 0 && failures[n-1].Seq < seen {
		seen = 0
	}
	for _, f := range failures {
		if f.Seq <= seen {
			continue
		}
		seen = f.Seq
		song := "track " + f.TrackID
		if p, err := pathOf(f.TrackID); err == nil && p != "" {
			song = fmt.Sprintf("%q (track %s)", p, f.TrackID)
		}
		reason := f.Error
		if navidromeAdmin != "" {
			reason = strings.ReplaceAll(reason, navidromeAdmin, "…") // never the stream password
		}
		if len(reason) > 300 {
			reason = reason[:300] + "…"
		}
		log.Printf("playback: could not play %s, skipped it: %s", song, reason)
	}
	return seen
}

func postPlay(meta queueTrack, st playbackState) error {
	token := ""
	if liveState != nil {
		token = liveState.BearerToken
	}
	if token == "" {
		return fmt.Errorf("not paired (no bearer token)")
	}

	localID := CassetteLocalID(meta.Artist, meta.Title, meta.DurationSeconds)
	var mbid any
	if m := strings.TrimSpace(meta.MBID); m != "" {
		mbid = m
	}
	var ratio any
	if meta.DurationSeconds > 0 {
		r := st.PositionSeconds / meta.DurationSeconds
		if r > 1 {
			r = 1
		}
		ratio = r
	}
	play := map[string]any{
		"cassette_local_id":       localID,
		"mbid":                    mbid,
		"played_at":               time.Now().UTC().Format(time.RFC3339),
		"duration_played_seconds": int(st.PositionSeconds),
		"completion_ratio":        ratio,
		"source_device":           "mac",
	}
	payload, err := json.Marshal(map[string]any{"plays": []any{play}})
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cassetteBase+"/api/sync/plays", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 300))
		return fmt.Errorf("/api/sync/plays → %d: %s", resp.StatusCode, b)
	}
	return nil
}

func writePlaybackJSON(w http.ResponseWriter, status int, payload map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
