// Disk Arbitration truth — the authoritative "is a disc in the drive?" signal.
//
// The native app watches Disk Arbitration (the same framework Finder and iTunes
// use) and, when a CD appears or disappears, hands us the disc's presence + device
// here — piggy-backed on the existing /api/rip/detect (present) and /api/rip/reset
// (gone) POSTs. We trust THIS over cd-paranoia / drutil, which read false-negative
// on a flaky drive or a sandboxed removable-volume read. So the disc (and the eject
// control) show up as reliably as they do in Finder, even when we can't read the
// TOC yet. The TOC read still uses cd-paranoia — but it no longer gates PRESENCE.

package main

import (
	"encoding/json"
	"net/http"
	"sync/atomic"
)

type discTruth struct {
	present bool
	// whole-disk BSD name, e.g. "disk4" — used for `diskutil eject <bsd>` (Finder's
	// exact eject path). Empty when the watcher couldn't read it.
	bsdName string
	// mounted volume path, when the OS reports one (informational).
	volumePath string
}

// daDisc holds the most recent Disk Arbitration truth; nil = no DA-confirmed disc.
var daDisc atomic.Pointer[discTruth]

type discTruthBody struct {
	Present    *bool  `json:"present"`
	BsdName    string `json:"bsdName"`
	VolumePath string `json:"volumePath"`
}

// applyDiscTruthFrom reads the optional DA-truth body the native watcher sends on
// /api/rip/detect (present:true) and /api/rip/reset (present:false). A request with
// no body — the web "try again" / "start over" buttons — leaves the truth untouched,
// so a user-driven reset never makes a physically-present disc vanish from the UI.
// Must be called synchronously in the handler (before any goroutine), since r.Body
// is closed once the handler returns.
func applyDiscTruthFrom(r *http.Request) {
	b := parseDiscTruthBody(r)
	if b == nil {
		return
	}
	if *b.Present {
		daDisc.Store(&discTruth{present: true, bsdName: b.BsdName, volumePath: b.VolumePath})
	} else {
		daDisc.Store(nil)
	}
}

// parseDiscTruthBody decodes the optional DA-truth body without applying it, so a
// caller (handleRipReset) can decide for itself — e.g. cross-check a "disappeared"
// against IOKit before believing the disc is gone. Returns nil for a bodyless or
// unparseable request (the web "start over" buttons), which must leave truth alone.
// Must be called synchronously in the handler, before any goroutine (r.Body closes
// when the handler returns).
func parseDiscTruthBody(r *http.Request) *discTruthBody {
	if r.Body == nil {
		return nil
	}
	var b discTruthBody
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil || b.Present == nil {
		return nil
	}
	return &b
}
