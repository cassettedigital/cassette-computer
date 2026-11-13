// Background goroutines that survive a panic (BUG-788).
//
// Go ends the whole process when any goroutine panics. For the hub that meant a
// bug in the hourly library pass or the USB watcher took Navidrome, playback and
// the pairing down with it. These wrappers recover, log the stack durably and
// report it the same way recoverMiddleware does for a request.

package main

import (
	"fmt"
	"log"
	"runtime/debug"
	"time"
)

// goSafe runs fn once in the background; a panic is logged and reported, and the
// goroutine ends.
func goSafe(name string, fn func()) {
	go func() {
		_ = runRecovered(name, fn)
	}()
}

// goForever runs a loop that is meant to last the whole session. If it panics it
// is logged, reported, and started again after a pause, so one bad pass doesn't
// silently stop the heartbeat or the USB watcher for good.
func goForever(name string, fn func()) {
	go func() {
		for {
			if !runRecovered(name, fn) {
				return // returned on its own: nothing to restart
			}
			time.Sleep(30 * time.Second)
		}
	}()
}

// runRecovered calls fn and reports whether it panicked.
func runRecovered(name string, fn func()) (panicked bool) {
	defer func() {
		rec := recover()
		if rec == nil {
			return
		}
		panicked = true
		stack := debug.Stack()
		log.Printf("PANIC in %s: %v\n%s", name, rec, stack)
		if diagnosticsEnabled() {
			msg := fmt.Sprintf("%v", rec)
			go sendReport(diagnosticsReport{
				ReportType:   "unhandled_error",
				Severity:     "error",
				Title:        "panic: " + msg,
				Fingerprint:  panicFingerprint(stack),
				Context:      map[string]interface{}{"goroutine": name},
				CrashSummary: crashSummary(msg, stack),
			})
		}
	}()
	fn()
	return false
}
