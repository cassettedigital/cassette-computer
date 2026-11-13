// Post-rip re-match reconciliation (#3) — the WRITE-BACK half of the disc-identity
// loop's newest seam.
//
// When a user opens "Edit album" in the cloud and re-matches an already-ripped
// album to a different catalog release, that correction lands server-side but
// CANNOT reach this Mac's disc_identity.jsonl — which is the source of truth for
// BOTH rung-zero local memory AND the shared-pool contribution the sidecar sends.
// A server-only fix would be silently reverted on the next sync (we re-send our
// stale record every time and the server upsert overwrites from it).
//
// So the sidecar PULLS those re-matches (GET /api/player/disc-relinks) on each sync
// and rewrites its own disc_identity.jsonl. The corrected record then:
//   - resolves this user's OWN next insert of the disc correctly (local memory), and
//   - flows to the shared pool through the normal gatherPoolDiscIdentities path —
//     durably, with no revert, because the source of truth now agrees.
//
// Fail-soft throughout: any miss/error/no-token skips reconciliation for the sync.

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

// serverRelink mirrors one entry of GET /api/player/disc-relinks — a post-rip
// library re-match projected to a disc identity, keyed by mb_disc_id.
type serverRelink struct {
	MBDiscID    string `json:"mb_disc_id"`
	ReleaseMBID string `json:"release_mbid"`
	Album       string `json:"album"`
	AlbumArtist string `json:"album_artist"`
	Date        string `json:"date"`
	CoverURL    string `json:"cover_url"`
	UpdatedAt   string `json:"updated_at"` // RFC3339 (server time)
}

const relinkPullTimeout = 6 * time.Second

// fetchServerRelinks pulls the user's post-rip re-matches. Fail-soft: any
// miss/error/no-token returns nil and reconciliation is skipped this sync.
func fetchServerRelinks() []serverRelink {
	if liveState == nil || liveState.BearerToken == "" {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), relinkPullTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cassetteBase+"/api/player/disc-relinks", nil)
	if err != nil {
		return nil
	}
	req.Header.Set("Authorization", "Bearer "+liveState.BearerToken)
	resp, err := (&http.Client{Timeout: relinkPullTimeout}).Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil
	}
	var body struct {
		Relinks []serverRelink `json:"relinks"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&body); err != nil {
		return nil
	}
	return body.Relinks
}

// reconcileServerRelinks pulls the user's cloud re-matches and rewrites the matching
// local disc-identity records. Best-effort; call it BEFORE carryDiscIdentity /
// gatherPoolDiscIdentities so a correction lands in the same sync. Returns how many
// records were rewritten.
func reconcileServerRelinks() int {
	relinks := fetchServerRelinks()
	if len(relinks) == 0 {
		return 0
	}
	applied := 0
	for _, rl := range relinks {
		applied += applyRelink(rl)
	}
	if applied > 0 {
		log.Printf("disc-identity: applied %d post-rip re-match correction(s) from the cloud", applied)
	}
	return applied
}

// sameRelinkIdentity reports whether the local record already claims the relink's
// identity — the idempotency check (a re-pulled relink we already applied is a
// no-op). Prefers the release MBID; falls back to album+artist when either side is
// MBID-less.
func sameRelinkIdentity(rl serverRelink, rec *DiscIdentityRecord) bool {
	if rl.ReleaseMBID != "" && rec.ReleaseMBID != "" {
		return rl.ReleaseMBID == rec.ReleaseMBID
	}
	return strings.EqualFold(strings.TrimSpace(rl.Album), strings.TrimSpace(rec.Album)) &&
		strings.EqualFold(strings.TrimSpace(rl.AlbumArtist), strings.TrimSpace(rec.AlbumArtist))
}

// relinkShouldApply decides whether a pulled relink supersedes the local record:
// only when the identity actually DIFFERS and the server re-match is NEWER than the
// record's last confirmation. The newer-than guard protects a fresher LOCAL
// re-identification (a re-rip the user confirmed after the relink) from being
// clobbered by an older cloud relink. Pure — unit-tested.
func relinkShouldApply(rl serverRelink, rec *DiscIdentityRecord) bool {
	if rec == nil || rl.MBDiscID == "" || rl.MBDiscID != rec.MBDiscID {
		return false
	}
	if sameRelinkIdentity(rl, rec) {
		return false // already applied — idempotent
	}
	rlAt, err := time.Parse(time.RFC3339, rl.UpdatedAt)
	if err != nil {
		return false // no trustworthy server timestamp → don't touch
	}
	recAt, err := time.Parse(time.RFC3339, rec.UpdatedAt)
	if err != nil {
		return true // local record has no parseable time → the explicit relink wins
	}
	return rlAt.After(recAt)
}

// applyRelinkToRecord rewrites a record's IDENTITY to the relink's, keeping the
// disc-intrinsic facts (TOC, fingerprint, track recordings, rip_complete). The
// record becomes a deliberate, single-source manual correction — the honest
// provenance for a post-rip re-match — and carries the was_override signal.
func applyRelinkToRecord(rl serverRelink, rec *DiscIdentityRecord) {
	rec.ReleaseMBID = rl.ReleaseMBID
	rec.Album = rl.Album
	rec.AlbumArtist = rl.AlbumArtist
	if rl.Date != "" {
		rec.Date = rl.Date
	}
	if rl.CoverURL != "" {
		rec.CoverURL = rl.CoverURL
	}
	rec.Sources = []string{"manual"}
	rec.Corroborated = false
	rec.Confidence = 1.0
	rec.ConfirmedVia = "user_relink"
	rec.WasOverride = true
	if t, err := time.Parse(time.RFC3339, rl.UpdatedAt); err == nil {
		rec.UpdatedAt = t.UTC().Format(time.RFC3339)
	} else {
		rec.UpdatedAt = nowFn().UTC().Format(time.RFC3339)
	}
}

// applyRelink rewrites every local record for the relink's disc that should adopt
// it (in-place atomic file rewrite, mirroring rewriteRipComplete), then refreshes
// the live memory index so this user's next insert resolves to the correction.
// Returns how many records changed.
func applyRelink(rl serverRelink) int {
	if rl.MBDiscID == "" {
		return 0
	}
	changed := rewriteRelinkIdentity(rl)
	if changed == 0 {
		return 0
	}
	discMemory.mu.Lock()
	if r, ok := discMemory.byMBDisc[rl.MBDiscID]; ok {
		applyRelinkToRecord(rl, r)
		r.ClusterID = clusterID(r)
	}
	discMemory.mu.Unlock()
	log.Printf("disc-identity: re-match → %q — %q (disc %s)", rl.AlbumArtist, rl.Album, discFingerprint(rl.MBDiscID))
	return changed
}

// rewriteRelinkIdentity is applyRelink's file half: it rewrites the identity of
// every record matching the relink's disc that relinkShouldApply admits, and
// atomically rewrites the store. Returns how many records changed. Holds identityMu
// for the whole read-modify-write; malformed lines pass through untouched.
func rewriteRelinkIdentity(rl serverRelink) int {
	identityMu.Lock()
	defer identityMu.Unlock()
	data, err := os.ReadFile(discIdentityPath())
	if os.IsNotExist(err) {
		return 0
	}
	if err != nil {
		log.Printf("disc-identity: relink read: %v", err)
		return 0
	}
	lines := splitJSONLines(data)
	var buf bytes.Buffer
	changed := 0
	for _, line := range lines {
		var rec DiscIdentityRecord
		if json.Unmarshal(line, &rec) != nil {
			buf.Write(line)
			buf.WriteByte('\n')
			continue
		}
		if relinkShouldApply(rl, &rec) {
			applyRelinkToRecord(rl, &rec)
			rec.ClusterID = clusterID(&rec)
			changed++
		}
		out, err := json.Marshal(rec)
		if err != nil {
			buf.Write(line)
			buf.WriteByte('\n')
			continue
		}
		buf.Write(out)
		buf.WriteByte('\n')
	}
	if changed == 0 {
		return 0
	}
	tmp := discIdentityPath() + ".tmp"
	if err := os.WriteFile(tmp, buf.Bytes(), 0o644); err != nil {
		log.Printf("disc-identity: relink write: %v", err)
		return 0
	}
	if err := os.Rename(tmp, discIdentityPath()); err != nil {
		log.Printf("disc-identity: relink rename: %v", err)
		return 0
	}
	return changed
}
