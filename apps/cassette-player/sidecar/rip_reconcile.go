// Cross-restart rip self-heal (BUG-256).
//
// A rip lands all its tracks on disk, then hands off to the library: trigger a
// Navidrome scan, wait until the album is indexed, push it to the cloud, and
// stamp .cassette-rip.json registered:true (see registerRippedAlbum). If that
// scan is killed mid-run — the likeliest trigger being the app being quit or
// updated right after a rip — the album never indexes, the in-memory background
// converger (convergeRippedAlbum) dies with the process, and the record is left
// registered:false with its tracks absent from the library. Nothing retries: the
// heartbeat sync never forces a scan, so the album can sit stranded on disk
// indefinitely (observed live on Alvvays "Blue Rev": 14 files ripped, 11 in the
// library, registered:false).
//
// This closes that gap. On every launch it finds the registered:false records
// and finishes the job — healing the flag for any that did land, and forcing a
// fresh scan + sync for the ones that didn't. A single rescan indexes the whole
// library, so all pending rips converge together. Anything still short is logged
// and retried on the next launch, so the system recovers on its own without a
// re-rip or any manual intervention.

package main

import (
	"encoding/json"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"time"
)

type unregisteredRip struct {
	dir string
	rec completenessRecord
}

// findUnregisteredRipRecords walks the library for .cassette-rip.json records
// still marked registered:false (with tracks that actually landed). Cheap: the
// same tree walk the folder watcher already does, reading only the small records.
func findUnregisteredRipRecords(root string) []unregisteredRip {
	var out []unregisteredRip
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || d.Name() != ".cassette-rip.json" {
			return nil
		}
		data, rerr := os.ReadFile(path)
		if rerr != nil {
			return nil
		}
		var rec completenessRecord
		if json.Unmarshal(data, &rec) != nil {
			return nil
		}
		if rec.Registered || rec.LandedTracks <= 0 || rec.Album == "" {
			return nil
		}
		out = append(out, unregisteredRip{dir: filepath.Dir(path), rec: rec})
		return nil
	})
	return out
}

// reconcileUnregisteredRips is the launch-time self-heal. Runs in the background
// after the startup sync + watcher settle; safe to no-op when unpaired or when
// nothing is pending.
func reconcileUnregisteredRips(state *SidecarState) {
	if state == nil || state.BearerToken == "" {
		return // unpaired — nothing to push
	}
	pending := findUnregisteredRipRecords(sidecarMusicDir)
	if len(pending) == 0 {
		return
	}
	log.Printf("rip-reconcile: %d rip(s) not yet registered in the library — finishing them", len(pending))

	// First pass: any already indexed just need their flag healed — a converger
	// that succeeded before a restart, or a synchronous-wait timeout whose album
	// landed moments later. No scan needed for those.
	var missing []unregisteredRip
	for _, rr := range pending {
		if countIndexedAlbumTracks(rr.rec.Album) >= rr.rec.LandedTracks {
			markRipRegistered(state, rr)
			log.Printf("rip-reconcile: %q already in the library — marked registered", rr.rec.Album)
		} else {
			missing = append(missing, rr)
		}
	}
	if len(missing) == 0 {
		return
	}

	// The genuinely-missing ones need a FULL scan, not the quick ingest: a quick
	// pass skips a folder whose mtime predates Navidrome's last-scan marker, which
	// is exactly how these got stranded (a killed/partial scan advanced the marker
	// past them). One full scan re-reads every folder, so a single backoff loop
	// converges them all together rather than per-album.
	log.Printf("rip-reconcile: %d rip(s) missing from the library — forcing a full rescan", len(missing))
	for _, wait := range ripConvergeBackoff {
		runFullRescanPass(state)
		var still []unregisteredRip
		for _, rr := range missing {
			if countIndexedAlbumTracks(rr.rec.Album) >= rr.rec.LandedTracks {
				markRipRegistered(state, rr)
				log.Printf("rip-reconcile: %q converged into the library — marked registered", rr.rec.Album)
			} else {
				still = append(still, rr)
			}
		}
		missing = still
		if len(missing) == 0 {
			return
		}
		time.Sleep(wait)
	}
	for _, rr := range missing {
		log.Printf("rip-reconcile: %q still short (%d/%d indexed) — will retry next launch",
			rr.rec.Album, countIndexedAlbumTracks(rr.rec.Album), rr.rec.LandedTracks)
	}
}

// markRipRegistered flips the local record's Registered flag and re-posts the
// completeness record so the cloud dashboard stops flagging the rip incomplete.
// Best-effort throughout, mirroring writeCompletenessRecord.
func markRipRegistered(state *SidecarState, rr unregisteredRip) {
	rec := rr.rec
	rec.Registered = true
	if data, err := json.MarshalIndent(rec, "", "  "); err == nil {
		if werr := atomicWriteFile(filepath.Join(rr.dir, ".cassette-rip.json"), data, 0o644); werr != nil {
			log.Printf("rip-reconcile: local flag write failed for %q: %v", rec.Album, werr)
		}
	}
	if state.BearerToken != "" {
		if err := callCassetteAPI("POST", "/api/player/rip-completeness", state.BearerToken, rec); err != nil {
			log.Printf("rip-reconcile: cloud completeness re-post failed for %q: %v", rec.Album, err)
		}
	}
}
