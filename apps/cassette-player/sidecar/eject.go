// Disc eject — open the drive / spit the disc out from inside Cassette, so a user
// never has to fall back to Finder, iTunes, or a dead physical eject button.
//
// The HTTP handler here is OS-neutral: it guards (refuses mid-rip; no disc → a
// harmless no-op at the OS layer), bounds the call with a timeout, and reports the
// result. The actual eject mechanism (diskutil / drutil on macOS) lives behind the
// disc platform seam in discOS.ejectDisc. POST only.

package main

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

// ejectTimeout bounds the eject call so a wedged drive can't hang the handler.
const ejectTimeout = 20 * time.Second

func handleEject(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "POST only"})
		return
	}
	// Never eject mid-rip — that would interrupt the read and leave a partial.
	if ripActive.Load() {
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":    false,
			"error": "A rip is in progress — eject is disabled until it finishes.",
		})
		return
	}

	// Not tied to the request context: the eject should finish even if the browser
	// navigates away the instant the user clicks.
	ctx, cancel := context.WithTimeout(context.Background(), ejectTimeout)
	defer cancel()

	// Hand the platform the specific mounted disc's device when Disk Arbitration gave
	// us one (empty otherwise), so it can target the exact disc rather than the tray.
	var device string
	if d := daDisc.Load(); d != nil {
		device = d.bsdName
	}
	if err := discOS.ejectDisc(ctx, device); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
		return
	}

	daDisc.Store(nil)
	_, _ = w.Write([]byte(`{"ok":true}`))
}
