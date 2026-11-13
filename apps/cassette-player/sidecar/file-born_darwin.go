//go:build darwin

package main

import (
	"os"
	"syscall"
	"time"
)

// fileBornAt is when this file came into being on this disk: a rip or a drop makes a new file; a tag write keeps
// the date (rewriteKeepingMetadata carries it across, BUG-861). The phones use it to tell a copy made before its
// song was replaced from one made after (BUG-897).
func fileBornAt(fi os.FileInfo) (time.Time, bool) {
	st, ok := fi.Sys().(*syscall.Stat_t)
	if !ok || st.Birthtimespec.Sec <= 0 {
		return fi.ModTime(), true
	}
	return time.Unix(st.Birthtimespec.Sec, st.Birthtimespec.Nsec), true
}
