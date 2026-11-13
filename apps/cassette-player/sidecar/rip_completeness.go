// Rip-completeness record (A5) — the connective tissue between Part A (rip
// reliability) and Part B (library ownership display).
//
// At registration time we record what the disc PROMISED (expected track count)
// vs what LANDED, plus which tracks failed and why. Two copies:
//   - LOCAL: .cassette-rip.json in the album folder — durable next to the audio,
//     read by the "Retry track N" flow and any future local tooling.
//   - CLOUD: POST /api/player/rip-completeness — what the dashboard library reads
//     to tell "incomplete because the rip FAILED" (flag + recover) from "partial
//     because the user DELETED tracks" (normal ownership, shown cleanly).
//
// The cloud route computes the album_group_key from album/albumArtist with the
// SAME helper the library cards use, so the record joins to the right card — the
// sidecar deliberately sends raw names and ports nothing.

package main

import (
	"encoding/json"
	"log"
	"path/filepath"
	"time"
)

type failedTrackRecord struct {
	Position int    `json:"position"`
	Title    string `json:"title"`
	Attempts int    `json:"attempts"`
	Error    string `json:"error"`
}

// completenessRecord is the persisted/posted shape. snake_case JSON to match the
// cloud column contract.
type completenessRecord struct {
	Album           string              `json:"album"`
	AlbumArtist     string              `json:"album_artist"`
	ReleaseMBID     string              `json:"release_mbid,omitempty"`
	DiscID          string              `json:"disc_id,omitempty"`
	ExpectedTracks  int                 `json:"expected_tracks"`
	LandedTracks    int                 `json:"landed_tracks"`
	FailedPositions []failedTrackRecord `json:"failed_positions"`
	Registered      bool                `json:"registered"`
	RippedAt        string              `json:"ripped_at"`
}

func buildCompletenessRecord(prog *RipProgress, rel *MatchedRelease, registered bool) completenessRecord {
	failed := []failedTrackRecord{}
	for _, t := range prog.Tracks {
		if t.State != "done" {
			failed = append(failed, failedTrackRecord{
				Position: t.Position, Title: t.Title, Attempts: t.Attempts, Error: t.Error,
			})
		}
	}
	return completenessRecord{
		Album:           rel.Album,
		AlbumArtist:     rel.AlbumArtist,
		ReleaseMBID:     rel.ReleaseMBID,
		DiscID:          rel.DiscID,
		ExpectedTracks:  prog.TrackCount,
		LandedTracks:    prog.CompletedTracks,
		FailedPositions: failed,
		Registered:      registered,
		RippedAt:        nowFn().UTC().Format(time.RFC3339),
	}
}

// writeCompletenessRecord persists the record locally and POSTs it to the cloud.
// Best-effort throughout: a failure is logged, never blocks or fails the rip.
func writeCompletenessRecord(prog *RipProgress, rel *MatchedRelease, registered bool) {
	rec := buildCompletenessRecord(prog, rel, registered)

	if prog.LandedDir != "" {
		if data, err := json.MarshalIndent(rec, "", "  "); err == nil {
			if err := atomicWriteFile(filepath.Join(prog.LandedDir, ".cassette-rip.json"), data, 0o644); err != nil {
				log.Printf("rip-completeness: local write failed: %v", err)
			}
		}
	}

	if liveState == nil || liveState.BearerToken == "" {
		return // not paired — the local record stands; the cloud will catch up never (fine)
	}
	if err := callCassetteAPI("POST", "/api/player/rip-completeness", liveState.BearerToken, rec); err != nil {
		log.Printf("rip-completeness: cloud POST failed (dashboard falls back to local): %v", err)
	}
}
