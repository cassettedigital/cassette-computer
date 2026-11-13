// Instant ingest (SPEC drag-and-drop, J1) — kill the ~1h wait + the silence when
// files are added to the music folder (a download dropped in, or the web-drop
// door in J2 landing a file).
//
// Today a new file is discovered only on Navidrome's ~1h scan + the sidecar's
// hourly sync gate (shouldRunLibrarySync). This makes it immediate via two
// triggers that both bypass the gate:
//   - an explicit POST /api/library/ingest (the web door calls it after an
//     upload; a "Scan now" UI action calls it) — instant, and
//   - a no-dep change-poll watcher on the music dir (a dropped folder auto-
//     ingests within ~10-15s instead of an hour).
// Both feed ONE serialized goroutine (ingestWatcher) holding the live state, so
// there is never a concurrent ingest, and runLibrarySync's librarySyncMu still
// serializes against the heartbeat.
//
// This file does NOT touch the accumulator (rip_resolve.go / rip_acoustid.go) —
// identification quality is the J4-J5 engine seam, gated on the AcoustID work.
// J1 only makes the EXISTING tag-based ingestion immediate + visible.

package main

import (
	"encoding/json"
	"hash/fnv"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const (
	ingestPollInterval = 10 * time.Second // music-dir change poll cadence
	ingestSettleWait   = 3 * time.Second  // re-check after a change to avoid mid-copy
	scanIdlePollEvery  = 1 * time.Second
	scanIdleMaxWait    = 60 * time.Second
	// A FULL re-read of the whole library is much slower than the quick pass, so
	// the recovery paths (convergeRippedAlbum, reconcileUnregisteredRips) give it
	// a far larger settle budget.
	fullScanIdleMaxWait = 5 * time.Minute
	// The folder-cover rescan runs while the library-sync mutex is held, so it gets a
	// much tighter budget than the ingest path — the heartbeat and the next ingest are
	// already backstops, and blocking a full minute here would serialize the post-rip
	// sync and /api/library/converge behind it for no benefit.
	coverScanIdleMaxWait = 15 * time.Second
	// On-demand convergence (POST /api/library/converge) blocks up to this long
	// for the scan-first pass to complete; it polls the completion epoch this often.
	convergeMaxWait   = 90 * time.Second
	convergePollEvery = 250 * time.Millisecond
)

// convergeEpoch is bumped after every ingestNow (the scan-first convergence
// routine) completes — success OR failure. An on-demand /api/library/converge
// caller records the epoch, signals a converge, and waits for the epoch to pass
// that value, so concurrent asks collapse onto one run (single-flight) and a
// fresh scan-first pass always completes after the request before it returns.
var convergeEpoch uint64

func bumpConvergeEpoch() { atomic.AddUint64(&convergeEpoch, 1) }

// ingestTrigger is the explicit "ingest now" signal (buffered 1, non-blocking
// send) from the HTTP endpoint into the watcher goroutine.
var ingestTrigger = make(chan struct{}, 1)

// signalIngest fires a non-blocking, coalescing ingest trigger. The single
// ingestWatcher goroutine runs the actual (serialized) ingestNow; a trigger already
// queued/running coalesces onto it, so repeated callers never block or pile up.
func signalIngest() {
	select {
	case ingestTrigger <- struct{}{}:
	default:
	}
}

// ─── Progress (so a drop isn't met with silence) ─────────────────────────────

type ingestProgress struct {
	State string `json:"state"`           // idle | scanning | working | done | error
	Count int    `json:"count,omitempty"` // tracks synced on the last completed ingest
	// Total and Identified describe the CURRENT (in-progress or just-finished)
	// ingest pass so the web dashboard can show "Adding [album] — N tracks · M
	// identified" live. Both are sourced from the inventory that runLibrarySync
	// actually pushed to the cloud (syncLibraryInventory), NOT from the resolver's
	// whole-cache stats:
	//   - Total      = every track in the Subsonic inventory this pass synced
	//                  (== Count on a completed pass; the library total, which is
	//                  the denominator the panel shows).
	//   - Identified = the subset of those tracks that carry a MusicBrainz
	//                  recording MBID (mapSubsonicSong set MusicBrainzRecordingID
	//                  non-nil), i.e. tracks resolved to a MusicBrainz identity.
	// Both are 0 during scanning and reset to 0 on error.
	Total      int       `json:"total,omitempty"`
	Identified int       `json:"identified,omitempty"`
	At         time.Time `json:"at,omitempty"`
}

var (
	ingestProgMu sync.RWMutex
	ingestProg   = ingestProgress{State: "idle"}
)

// setIngestState updates state + the last-synced count, leaving Total/Identified
// at their zero defaults. Kept for callers that only know the lifecycle state
// (scanning/working/error); setIngestProgress is the richer setter that also
// carries the current pass's per-track counts.
func setIngestState(state string, count int) {
	setIngestProgress(state, count, 0, 0)
}

// setIngestProgress publishes the full ingest progress, including the current
// pass's Total/Identified track counts.
func setIngestProgress(state string, count, total, identified int) {
	ingestProgMu.Lock()
	ingestProg = ingestProgress{
		State:      state,
		Count:      count,
		Total:      total,
		Identified: identified,
		At:         nowFn().UTC(),
	}
	ingestProgMu.Unlock()
}

// ingestSnapshot is the value the status snapshot embeds (read by /status.json
// and, via that, the web devices panel that already polls it).
func ingestSnapshot() ingestProgress {
	ingestProgMu.RLock()
	defer ingestProgMu.RUnlock()
	return ingestProg
}

// ─── The ingest itself ───────────────────────────────────────────────────────

// ingestNow indexes freshly-added files and pushes them to the cloud right away,
// bypassing the 1h heartbeat gate (the gate lives only in shouldRunLibrarySync's
// callers, so calling runLibrarySync directly is the documented bypass).
//
// Two passes so identity lands in the SAME ingest: pass 1 indexes the new files,
// runs the resolver (which writes any MBIDs it finds into the file tags and
// triggers a re-scan), and syncs; pass 2 — after that tag-write scan settles —
// syncs again so the just-written MBIDs reach the cloud. The common case (a few
// well-tagged albums) completes in seconds because waitForScanIdle returns as
// soon as Navidrome reports idle.
//
// B1 (self-healing convergence): this IS the shared scan-first convergence
// routine. It re-reads the disk (triggerNavidromeScan + waitForScanIdle) BEFORE
// the full sync, so it converges ADDS and DELETES alike — a deleted file is
// marked missing by the scan, excluded from search3, and soft-removed by the
// cloud's full-sync sweep. Every convergence trigger funnels here: the music-dir
// watcher (FS change), POST /api/library/ingest, the on-demand /api/library/
// converge endpoint, and the heartbeat backstop (B3). The 1h gate lives only in
// shouldRunLibrarySync's callers, so this always re-reads current truth.
func ingestNow(state *SidecarState) {
	// Wake any on-demand /api/library/converge waiter on every return path.
	defer bumpConvergeEpoch()
	if state == nil || state.BearerToken == "" {
		return // unpaired → nothing to push
	}
	setIngestState("scanning", 0)
	if err := triggerNavidromeScan(); err != nil {
		log.Printf("ingest: scan trigger failed (continuing): %v", err)
	}
	waitForScanIdle(scanIdleMaxWait)

	setIngestState("working", 0)
	count, identified, err := runLibrarySyncWithCounts(state, "full") // resolve (+ tag-write + rescan) + sync
	if err != nil {
		log.Printf("ingest: first sync failed: %v", err)
		setIngestState("error", 0)
		return
	}
	// Surface the first pass's counts while the second pass runs, so the panel
	// shows live "N tracks · M identified" instead of sitting at zero.
	setIngestProgress("working", count, count, identified)
	// Second pass: pick up MBIDs the resolver just wrote into the files (its
	// re-scan is settling now). Cheap — the resolver is cached, the sync is fast.
	waitForScanIdle(scanIdleMaxWait)
	if c2, id2, err2 := runLibrarySyncWithCounts(state, "full"); err2 == nil {
		count, identified = c2, id2
	}
	log.Printf("ingest: complete — %d tracks (%d identified)", count, identified)
	setIngestProgress("done", count, count, identified)
}

// waitForScanIdle polls Navidrome's getScanStatus until it reports not-scanning
// (or maxWait elapses). Best-effort: if the status call fails it returns after a
// short grace so ingest still proceeds (the second pass + the heartbeat backstop
// catch anything not yet indexed).
// Returns true only when it actually OBSERVED Navidrome report not-scanning. A false
// return means "unknown" — status unavailable, or the wait timed out with a scan still
// running — and callers whose correctness depends on the scan having completed (the
// cover fingerprinter) must not treat that as success.
func waitForScanIdle(maxWait time.Duration) (confirmedIdle bool) {
	deadline := nowFn().Add(maxWait)
	failures := 0
	for nowFn().Before(deadline) {
		scanning, ok := navidromeScanning()
		if !ok {
			failures++
			if failures >= 3 {
				return false // status unavailable → don't block ingest
			}
		} else {
			failures = 0
			if !scanning {
				return true
			}
		}
		time.Sleep(scanIdlePollEvery)
	}
	return false
}

// navidromeScanning queries Subsonic getScanStatus. Returns (scanning, ok).
func navidromeScanning() (scanning bool, ok bool) {
	params := url.Values{
		"u": {navidromeAdminUser}, "p": {navidromeAdmin},
		"v": {"1.16.1"}, "c": {"cassette-sidecar"}, "f": {"json"},
	}
	resp, err := http.Get(navidromeBase + "/rest/getScanStatus?" + params.Encode())
	if err != nil {
		return false, false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false, false
	}
	var body struct {
		SubsonicResponse struct {
			Status     string `json:"status"`
			ScanStatus struct {
				Scanning bool `json:"scanning"`
			} `json:"scanStatus"`
		} `json:"subsonic-response"`
	}
	if json.NewDecoder(resp.Body).Decode(&body) != nil {
		return false, false
	}
	if body.SubsonicResponse.Status != "ok" {
		return false, false
	}
	return body.SubsonicResponse.ScanStatus.Scanning, true
}

// runFullRescanPass forces a FULL Navidrome scan, waits for it to settle, then
// pushes the refreshed inventory to the cloud. A quick scan decides a folder is
// unchanged from its name/size/mtime and skips it, so a rip whose scan was killed
// mid-run — or a replace-rip into a folder a later scan already marked seen —
// leaves new files a quick pass will never re-read. Recovery REQUIRES a full
// re-read; this is the same escalation the cover fingerprinter makes when a quick
// scan can't see an in-place change (see triggerNavidromeScanMode). Used by the
// rip converger and the launch reconcile, never the hot ingest path.
func runFullRescanPass(state *SidecarState) {
	if state == nil || state.BearerToken == "" {
		return // unpaired — nothing to push
	}
	if err := triggerNavidromeScanMode(true); err != nil {
		log.Printf("full rescan: trigger failed: %v", err)
	}
	waitForScanIdle(fullScanIdleMaxWait)
	if _, err := runLibrarySync(state, "full"); err != nil {
		log.Printf("full rescan: sync failed (will retry): %v", err)
	}
}

// ─── The no-dep folder watcher ───────────────────────────────────────────────

// musicDirSignature is a cheap fingerprint of the AUDIO files AND folder cover art
// under the music dir (path|size|mtime, hashed). A dropped/removed file changes it.
// Cover/tag writes the sidecar makes are absorbed by recomputing the baseline AFTER
// each ingest.
//
// Cover art is included because swapping an album's cover.jpg changes no audio file:
// without it the watcher never fires on a Finder-side art change and the new cover
// waits on the 1h shouldRunLibrarySync gate before any satellite can hear about it.
func musicDirSignature() string {
	h := fnv.New64a()
	_ = filepath.WalkDir(sidecarMusicDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		if !isLibraryAudio(path) {
			name := d.Name()
			stem := strings.ToLower(strings.TrimSuffix(name, filepath.Ext(name)))
			if !coverBaseNames[stem] {
				return nil
			}
		}
		info, ierr := d.Info()
		if ierr != nil {
			return nil
		}
		_, _ = h.Write([]byte(path))
		var buf [16]byte
		n := info.Size()
		m := info.ModTime().UnixNano()
		for i := 0; i < 8; i++ {
			buf[i] = byte(n >> (8 * i))
			buf[8+i] = byte(m >> (8 * i))
		}
		_, _ = h.Write(buf[:])
		return nil
	})
	return string(h.Sum(nil))
}

// musicDirEvents carries "something under the music folder changed" from the
// macOS change-notice watch (fsevents_darwin.go). Buffered by one: a burst of
// changes is one pending look.
var musicDirEvents = make(chan struct{}, 1)

func noteMusicDirChanged() {
	select {
	case musicDirEvents <- struct{}{}:
	default:
	}
}

// ingestWatcher is the single serialized consumer of both ingest triggers: the
// explicit endpoint signal and a change in the music folder. Started once at boot.
//
// On macOS the folder is watched with change notices, and read only after one
// arrives. Re-reading the whole folder every 10 s kept external drives awake all
// day and cost real time on big libraries (BUG-789). Where the watch can't start,
// it polls as before.
func ingestWatcher(state *SidecarState) {
	time.Sleep(20 * time.Second) // let the startup sync settle before watching
	lastSig := musicDirSignature()
	watching := watchMusicDir(sidecarMusicDir)
	if watching {
		log.Printf("ingest: watching %s for changes", sidecarMusicDir)
	} else {
		log.Printf("ingest: change notices unavailable; polling %s every %s", sidecarMusicDir, ingestPollInterval)
	}
	ticker := time.NewTicker(ingestPollInterval)
	defer ticker.Stop()
	pending := !watching // polling looks every tick; watching looks only after a notice
	for {
		select {
		case <-ingestTrigger:
			ingestNow(state)
			lastSig = musicDirSignature() // absorb the resolver's tag/cover writes
			continue
		case <-musicDirEvents:
			pending = true
		case <-ticker.C:
		}
		if !pending {
			continue
		}
		// A rip writes each finished track straight into the album's folder, which
		// looked like a settled change after every track: a rescan and two cloud
		// pushes per track, and every phone pulled the album in pieces while it
		// ripped (the founder, 2026-10-31). The rip registers its album itself when
		// it ends (registerRippedAlbum); the change stays pending, so anything else
		// that changed meanwhile is picked up on the first tick after.
		if ripActive.Load() {
			continue
		}
		sig := musicDirSignature()
		if sig == lastSig {
			pending = !watching
			continue
		}
		// Change detected — settle, then confirm stable before ingesting so a
		// half-copied album isn't ingested mid-write. If still changing, keep it
		// pending and re-evaluate next tick (handles long copies).
		time.Sleep(ingestSettleWait)
		if musicDirSignature() != sig {
			continue
		}
		log.Printf("ingest: music dir changed — auto-ingesting")
		ingestNow(state)
		lastSig = musicDirSignature()
		pending = !watching
	}
}

// ─── The explicit endpoint (web door J2 + a manual "Scan now") ───────────────

// handleLibraryIngest signals an immediate ingest and returns at once. The
// watcher does the work (serialized), so repeated/overlapping calls coalesce.
func handleLibraryIngest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "POST only"})
		return
	}
	signalIngest()
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "started": true})
}

// ─── On-demand convergence (B2 phone pull-to-refresh / C2 desktop Sync Now) ──

// handleLibraryConverge runs the scan-first convergence and BLOCKS until it
// completes, so the caller knows the cloud index now reflects the Mac's current
// disk and can re-report inventory + reconcile. It signals the shared
// (coalescing) convergence trigger and waits for the completion epoch to advance
// past the value it observed — so concurrent asks collapse onto one run
// (single-flight) and a fresh scan-first pass always completes after the request.
// Times out after convergeMaxWait (returns 200 with converged:false) rather than
// hanging the caller; the heartbeat backstop still catches anything missed.
func handleLibraryConverge(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "POST only"})
		return
	}

	from := atomic.LoadUint64(&convergeEpoch)
	signalIngest() // coalesces onto any convergence already queued/running

	deadline := nowFn().Add(convergeMaxWait)
	for nowFn().Before(deadline) {
		if atomic.LoadUint64(&convergeEpoch) > from {
			snap := ingestSnapshot()
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok":        true,
				"converged": true,
				"state":     snap.State,
				"count":     snap.Count,
			})
			return
		}
		time.Sleep(convergePollEvery)
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "converged": false, "timeout": true})
}
