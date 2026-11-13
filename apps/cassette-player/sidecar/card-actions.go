// Menu-bar card quick actions: favorite + add-to-playlist.
//
// These are thin loopback endpoints the in-process Swift card calls; each wraps
// the EXISTING Cassette cloud sync API (the same canonical store the web
// dashboard reads — user_favorites / user_playlists), reusing the bearer token
// the sidecar already holds (liveState.BearerToken, as in postPlay) and the
// cassette_local_id it already computes (CassetteLocalID).
//
// Deliberately NOT Subsonic: a /rest/star to the local Navidrome would be
// invisible to the web dashboard (favorites/playlists there live in the cloud,
// not Navidrome). Writing to the cloud is what makes a Mac action show up on the
// web. iOS parity (Navidrome stars) is a separate, out-of-scope reconciliation.

package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ─── Shared helpers ────────────────────────────────────────────────────────────

// currentTrackMeta resolves the engine's currently-playing track to the queue
// metadata the broker kept (title/artist/album/duration/mbid), via the same
// Swift /state + queue-mirror path the play-logger uses.
func currentTrackMeta() (queueTrack, bool) {
	st, err := fetchSwiftState()
	if err != nil || st.CurrentTrackID == "" {
		return queueTrack{}, false
	}
	return queueTrackAt(st.QueueIndex, st.CurrentTrackID)
}

// currentLocalID returns the cassette_local_id (the cloud's track key) for the
// currently-playing track, plus its metadata.
func currentLocalID() (localID string, meta queueTrack, ok bool) {
	meta, ok = currentTrackMeta()
	if !ok {
		return "", queueTrack{}, false
	}
	return CassetteLocalID(meta.Artist, meta.Title, meta.DurationSeconds), meta, true
}

func bearer() (string, bool) {
	if liveState == nil || liveState.BearerToken == "" {
		return "", false
	}
	return liveState.BearerToken, true
}

// cassetteAPI does an authenticated request to the cloud sync API and returns
// the status + body (callCassetteAPI in main.go discards the body; the reads
// here need it). Mirrors postPlay's request shape.
func cassetteAPI(method, path string, body any) (status int, respBody []byte, err error) {
	token, ok := bearer()
	if !ok {
		return 0, nil, fmt.Errorf("not paired")
	}
	var reader io.Reader
	if body != nil {
		b, e := json.Marshal(body)
		if e != nil {
			return 0, nil, e
		}
		reader = bytes.NewReader(b)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, cassetteBase+path, reader)
	if err != nil {
		return 0, nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	return resp.StatusCode, b, nil
}

// mbidOrNil returns the metadata MBID as a value for JSON, or nil when absent —
// the cloud API wants `mbid: <uuid> | null`.
func mbidOrNil(meta queueTrack) any {
	if m := strings.TrimSpace(meta.MBID); m != "" {
		return m
	}
	return nil
}

func uuidV4() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// ─── Favorite (cloud user_favorites) ───────────────────────────────────────────

// handleCardFavorite is GET (is the current track favorited?), POST (favorite),
// DELETE (un-favorite). Reads/writes the cloud — the web dashboard's store.
func handleCardFavorite(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		cardFavoriteGet(w, r)
	case http.MethodPost, http.MethodDelete:
		cardFavoriteWrite(w, r)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func cardFavoriteGet(w http.ResponseWriter, _ *http.Request) {
	if _, ok := bearer(); !ok {
		writePlaybackJSON(w, http.StatusOK, map[string]any{"authed": false, "favorited": false})
		return
	}
	localID, _, ok := currentLocalID()
	if !ok {
		writePlaybackJSON(w, http.StatusOK, map[string]any{"authed": true, "favorited": false})
		return
	}
	status, body, err := cassetteAPI(http.MethodGet, "/api/sync/favorites", nil)
	if err != nil || status < 200 || status >= 300 {
		// Reachable-but-unknown: report authed so the card stays enabled, default
		// to not-favorited (toggling will still succeed/sync).
		writePlaybackJSON(w, http.StatusOK, map[string]any{"authed": true, "favorited": false})
		return
	}
	var parsed struct {
		Favorites []struct {
			CassetteLocalID string `json:"cassette_local_id"`
		} `json:"favorites"`
	}
	_ = json.Unmarshal(body, &parsed)
	favorited := false
	for _, f := range parsed.Favorites {
		if f.CassetteLocalID == localID {
			favorited = true
			break
		}
	}
	writePlaybackJSON(w, http.StatusOK, map[string]any{"authed": true, "favorited": favorited})
}

func cardFavoriteWrite(w http.ResponseWriter, r *http.Request) {
	if _, ok := bearer(); !ok {
		writePlaybackJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "not paired"})
		return
	}
	localID, meta, ok := currentLocalID()
	if !ok {
		writePlaybackJSON(w, http.StatusConflict, map[string]any{"ok": false, "error": "no current track"})
		return
	}
	now := time.Now().UTC().Format(time.RFC3339)
	var status int
	var err error
	if r.Method == http.MethodPost {
		status, _, err = cassetteAPI(http.MethodPost, "/api/sync/favorites", map[string]any{
			"cassette_local_id": localID,
			"mbid":              mbidOrNil(meta),
			"event_at":          now,
			"source_device":     "mac",
			"track_title":       meta.Title,
			"artist_name":       meta.Artist,
			"album_name":        meta.Album,
		})
	} else { // DELETE
		status, _, err = cassetteAPI(http.MethodDelete, "/api/sync/favorites", map[string]any{
			"cassette_local_id": localID,
			"event_at":          now,
		})
	}
	if err != nil || status < 200 || status >= 300 {
		writePlaybackJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "cloud write failed"})
		return
	}
	writePlaybackJSON(w, http.StatusOK, map[string]any{"ok": true, "favorited": r.Method == http.MethodPost})
}

// ─── Playlists (cloud user_playlists) ──────────────────────────────────────────

// handleCardPlaylists proxies the user's playlists (id + name) for the card's
// add-to-playlist picker.
func handleCardPlaylists(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if _, ok := bearer(); !ok {
		writePlaybackJSON(w, http.StatusOK, map[string]any{"authed": false, "playlists": []any{}})
		return
	}
	status, body, err := cassetteAPI(http.MethodGet, "/api/sync/playlists", nil)
	if err != nil || status < 200 || status >= 300 {
		writePlaybackJSON(w, http.StatusOK, map[string]any{"authed": true, "playlists": []any{}})
		return
	}
	var parsed struct {
		Playlists []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"playlists"`
	}
	_ = json.Unmarshal(body, &parsed)
	out := make([]map[string]any, 0, len(parsed.Playlists))
	for _, p := range parsed.Playlists {
		out = append(out, map[string]any{"id": p.ID, "name": p.Name})
	}
	writePlaybackJSON(w, http.StatusOK, map[string]any{"authed": true, "playlists": out})
}

// handleCardPlaylistAdd adds the current track to a playlist via the cloud's
// idempotent op endpoint (ON CONFLICT DO NOTHING — re-adding is harmless).
func handleCardPlaylistAdd(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if _, ok := bearer(); !ok {
		writePlaybackJSON(w, http.StatusUnauthorized, map[string]any{"ok": false, "error": "not paired"})
		return
	}
	playlistID := strings.TrimSpace(r.PathValue("id"))
	if playlistID == "" {
		writePlaybackJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "missing playlist id"})
		return
	}
	localID, meta, ok := currentLocalID()
	if !ok {
		writePlaybackJSON(w, http.StatusConflict, map[string]any{"ok": false, "error": "no current track"})
		return
	}
	op := map[string]any{
		"op":                "add",
		"item_id":           uuidV4(),
		"cassette_local_id": localID,
		"mbid":              mbidOrNil(meta),
		"position":          float64(time.Now().UnixMilli()), // monotonic-ish append
		"added_at":          time.Now().UTC().Format(time.RFC3339),
		"added_by_device":   "mac",
	}
	status, _, err := cassetteAPI(http.MethodPost, "/api/sync/playlists/"+playlistID+"/ops",
		map[string]any{"ops": []any{op}})
	if err != nil || status < 200 || status >= 300 {
		writePlaybackJSON(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "cloud write failed"})
		return
	}
	writePlaybackJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ─── Pending sync count (for the desktop quit prompt) ──────────────────────────

// handleSyncPending returns how many sync intents for this device's user are
// still in flight — anything not in a terminal state (complete/failed/cancelled).
// The desktop shell reads this on quit to decide whether to warn "your phone is
// still syncing" before it tears the hub down. Loopback-only; reuses the paired
// bearer token. Fails OPEN: any error reports 0 so the shell just quits rather
// than nagging on a transient hiccup.
func handleSyncPending(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if _, ok := bearer(); !ok {
		writePlaybackJSON(w, http.StatusOK, map[string]any{"authed": false, "pending": 0})
		return
	}
	status, body, err := cassetteAPI(http.MethodGet, "/api/sync/intents", nil)
	if err != nil || status < 200 || status >= 300 {
		writePlaybackJSON(w, http.StatusOK, map[string]any{"authed": true, "pending": 0})
		return
	}
	var parsed struct {
		Intents []struct {
			State string `json:"state"`
		} `json:"intents"`
	}
	_ = json.Unmarshal(body, &parsed)
	// Terminal states don't count; everything else (pending/syncing/waiting/…) is
	// still in flight.
	terminal := map[string]bool{"complete": true, "failed": true, "cancelled": true}
	pending := 0
	for _, it := range parsed.Intents {
		if !terminal[it.State] {
			pending++
		}
	}
	writePlaybackJSON(w, http.StatusOK, map[string]any{"authed": true, "pending": pending})
}
