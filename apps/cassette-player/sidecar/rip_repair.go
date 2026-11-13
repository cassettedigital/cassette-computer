package main

// Single-track REPAIR — re-read one already-landed track from the inserted disc
// and replace the file in place, safely.
//
// This is distinct from /api/rip/retry, which FILLS a track that never landed
// (and refuses to touch a track whose file already exists — the resume-skip in
// ripTrackSet). Repair is for a track that landed but is BAD (a skip in
// playback): it force-re-reads that one track and swaps the file.
//
// Safety (the file it replaces is the user's owned music):
//   1. Detect the inserted disc and refuse unless it is the SAME ALBUM being
//      repaired (a different copy of the same album is fine; a different album
//      is refused, so we never rip the wrong audio into your folder).
//   2. Back up the current file, re-read + encode + `flac -t` verify the new one,
//      and only THEN swap it in. Restore the backup on any failure.
//
// Original-disc repair only. A general "replace from another source" flow is a
// separate feature (the disc is the authority here).

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
)

type repairMatchKind int

const (
	repairNoMatch     repairMatchKind = iota // a different album — refuse
	repairSameRelease                        // same ReleaseMBID — same release, safe
	repairSameAlbum                          // same album, no/other MBID — may differ slightly
)

// repairMatch decides whether the inserted disc `rel` is the album the caller
// asked to repair. Permissive by album identity, not by exact pressing.
func repairMatch(rel *MatchedRelease, wantMBID, wantAlbum, wantArtist string) repairMatchKind {
	if rel == nil {
		return repairNoMatch
	}
	if wantMBID != "" && rel.ReleaseMBID != "" && rel.ReleaseMBID == wantMBID {
		return repairSameRelease
	}
	want := albumKey(wantAlbum, wantArtist)
	if want != "" && albumKey(rel.Album, rel.AlbumArtist) == want {
		return repairSameAlbum
	}
	return repairNoMatch
}

func writeRepairJSON(w http.ResponseWriter, code int, body map[string]any) {
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(body)
}

// handleRipRepairTrack: POST /api/rip/repair {position, releaseMbid, album, albumArtist}.
func handleRipRepairTrack(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var req struct {
		Position    int    `json:"position"`
		ReleaseMBID string `json:"releaseMbid"`
		Album       string `json:"album"`
		AlbumArtist string `json:"albumArtist"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)
	if req.Position < 1 {
		writeRepairJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "No track to repair."})
		return
	}

	// Single-flight: never run alongside another rip/retry.
	if !ripActive.CompareAndSwap(false, true) {
		writeRepairJSON(w, http.StatusConflict, map[string]any{"ok": false, "alreadyRipping": true, "error": "A rip is already in progress."})
		return
	}

	// Re-detect the inserted disc up front so we can answer synchronously whether
	// it's the right disc (this also makes repair survive a sidecar restart — no
	// reliance on the in-memory lastRippedRel).
	dr, err := detectAndResolve()
	if err != nil || dr == nil || dr.res == nil || dr.res.Release == nil {
		ripActive.Store(false)
		writeRepairJSON(w, http.StatusConflict, map[string]any{"ok": false, "needsDisc": true, "error": "Put the disc in the drive to repair this track."})
		return
	}
	rel := dr.res.Release

	// Same-ALBUM gate.
	match := repairMatch(rel, req.ReleaseMBID, req.Album, req.AlbumArtist)
	if match == repairNoMatch {
		ripActive.Store(false)
		writeRepairJSON(w, http.StatusConflict, map[string]any{
			"ok":            false,
			"wrongDisc":     true,
			"insertedAlbum": rel.Album,
			"error":         fmt.Sprintf("That disc is %q, not %q. Put in your copy of %q to repair this track.", rel.Album, req.Album, req.Album),
		})
		return
	}

	// Find the track by position on the inserted disc.
	idx := -1
	for i := range rel.Tracks {
		if rel.Tracks[i].Position == req.Position {
			idx = i
			break
		}
	}
	if idx < 0 {
		ripActive.Store(false)
		writeRepairJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "That disc doesn't have that track."})
		return
	}

	destDir := albumDir(rel)
	tr := rel.Tracks[idx]
	final := landedPath(destDir, rel, tr)
	if !fileNonEmpty(final) {
		// Nothing to repair here — this is /retry's job (fill a missing track), not
		// repair's (replace a bad one). Guard so we never silently create a file the
		// caller thought already existed.
		ripActive.Store(false)
		writeRepairJSON(w, http.StatusConflict, map[string]any{"ok": false, "error": "That track isn't on the hub yet — nothing to repair."})
		return
	}

	// Accepted — do the work off the request.
	go func() {
		defer ripActive.Store(false)
		ripStopRequested.Store(false)
		ripMu.Lock()
		defer ripMu.Unlock()

		prog := matchedProgress(rel, nil)
		prog.LandedDir = destDir
		// Seed the progress view: every landed track reads "done", the target reads
		// "ripping", so the panel shows a single-track repair rather than a whole rip.
		for i := range rel.Tracks {
			if i == idx {
				continue
			}
			if fileNonEmpty(landedPath(destDir, rel, rel.Tracks[i])) {
				setTrack(prog, i, "done", 0, "")
			}
		}
		progUpdate(prog, func() {
			prog.State = "ripping"
			prog.Message = fmt.Sprintf("Repairing track %d…", req.Position)
			prog.StartedAt = nowFn()
			setTrack(prog, idx, "ripping", 0, "")
		})

		// 1. Back up the current (bad) file so a failed re-read is reversible.
		backup := final + ".repairbak"
		_ = os.Remove(backup) // clear any leftover from a prior aborted repair
		if err := os.Rename(final, backup); err != nil {
			progUpdate(prog, func() { setTrack(prog, idx, "error", 0, err.Error()); prog.State = "error"; prog.Message = "Couldn't set the current file aside." })
			return
		}
		restore := func() {
			// Put the original back exactly as it was.
			if fileNonEmpty(backup) {
				_ = os.Remove(final)
				_ = os.Rename(backup, final)
			}
		}

		// 2. Re-read just this track from the disc (cd-paranoia, macOS CDDA fallback).
		tmp, err := os.MkdirTemp("", "cassette-repair-")
		if err != nil {
			restore()
			progUpdate(prog, func() { setTrack(prog, idx, "error", 0, err.Error()); prog.State = "error"; prog.Message = "Couldn't create a temp dir." })
			return
		}
		defer os.RemoveAll(tmp)

		wav := filepath.Join(tmp, fmt.Sprintf("track%02d.wav", tr.Position))
		boundPos, boundFrames := discOS.enhancedLastTrackBound()
		maxFrames := 0
		if boundPos > 0 && tr.Position == boundPos {
			maxFrames = boundFrames
		}
		attempts, rerr := discOS.ripTrackToWAV(tr.Position, maxFrames, wav)
		if rerr != nil {
			if fbErr := discOS.ripTrackFallbackToWAV(tr.Position, wav); fbErr != nil {
				log.Printf("repair: track %d %q could not be re-read — cd-paranoia: %v; CDDA fallback: %v", tr.Position, tr.Title, rerr, fbErr)
				restore()
				progUpdate(prog, func() { setTrack(prog, idx, "error", attempts, rerr.Error()); prog.State = "error"; prog.Message = "Couldn't re-read that track from the disc. The original is untouched." })
				return
			}
			log.Printf("repair: track %d %q re-read via macOS CDDA after cd-paranoia hang (%v)", tr.Position, tr.Title, rerr)
		}

		// 3. Encode + tag + `flac -t` verify + land (into destDir, where `final` now
		//    doesn't exist, so it writes fresh). encodeTagLand fails if the new FLAC
		//    doesn't decode-verify — in which case we restore the backup.
		if _, eerr := encodeTagLand(wav, rel, tr, destDir); eerr != nil {
			log.Printf("repair: track %d %q re-read didn't verify: %v", tr.Position, tr.Title, eerr)
			restore()
			progUpdate(prog, func() { setTrack(prog, idx, "error", attempts, eerr.Error()); prog.State = "error"; prog.Message = "The re-read didn't verify. The original is untouched." })
			return
		}

		// 4. Success — the verified new file is in place; drop the backup.
		_ = os.Remove(backup)
		log.Printf("repair: track %d %q repaired (%d read attempt(s), match=%d)", tr.Position, tr.Title, attempts, match)
		progUpdate(prog, func() {
			setTrack(prog, idx, "done", attempts, "")
			prog.CompletedTracks = countTracksInState(prog, "done")
			prog.State = "done"
			prog.Message = fmt.Sprintf("Track %d repaired.", req.Position)
		})
	}()

	writeRepairJSON(w, http.StatusOK, map[string]any{"ok": true, "mayDiffer": match == repairSameAlbum})
}
