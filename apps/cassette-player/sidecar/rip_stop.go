// Rip control: the cooperative Stop endpoint that cancels an in-progress rip (J4).
//
// The per-read stall watchdog + absolute ceiling and the process-group kill that
// back it are OS-specific and live behind the disc platform seam
// (rip_platform_darwin.go on macOS). This file holds only the OS-neutral control
// state and HTTP handlers:
//
//   - POST /api/rip/stop sets a cooperative stop flag and kills the active
//     track-read process (via discOS.killRipProcess), returning the rip to idle.
//   - the shared stop flag + active-command pointer the rip loop and the
//     platform watchdog both check.

package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os/exec"
	"sync/atomic"
)

var (
	// activeRipCmd is the running track-read command, so /api/rip/stop can kill it.
	// The platform reader stores it while a read is in flight.
	activeRipCmd atomic.Pointer[exec.Cmd]
	// ripStopRequested is the cooperative stop flag the rip loop + watchdog check.
	ripStopRequested atomic.Bool
	// ripForceReplace makes the next rip re-read EVERY track (bypassing the
	// resume-skip) so "Replace rip" overwrites a bad rip instead of only filling
	// missing tracks. runRipJob consumes it (Swap-clears) so it never leaks to a
	// later rip.
	ripForceReplace atomic.Bool
)

// handleRipStop cancels the active rip: it sets the cooperative stop flag and
// kills the running track-read process. The rip loop aborts between tracks and
// runRipJob publishes a clean idle state. Idempotent; a no-op when not ripping.
func handleRipStop(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if !ripActive.Load() {
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "notRipping": true})
		return
	}
	ripStopRequested.Store(true)
	if cmd := activeRipCmd.Load(); cmd != nil {
		discOS.killRipProcess(cmd)
	}
	log.Printf("rip: STOP requested — cancelling active rip + killing cd-paranoia group")
	_, _ = w.Write([]byte(`{"ok":true}`))
}

// handleDismissInterrupted acknowledges the "a previous rip didn't finish" notice.
func handleDismissInterrupted(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	dismissInterruptedRip()
	_, _ = w.Write([]byte(`{"ok":true}`))
}
