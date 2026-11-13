//go:build darwin

package main

import (
	"syscall"
	"time"
)

// folderBornAt returns path's creation time (APFS and HFS+ keep one).
func folderBornAt(path string) (time.Time, bool) {
	var st syscall.Stat_t
	if err := syscall.Stat(path, &st); err != nil {
		return time.Time{}, false
	}
	if st.Birthtimespec.Sec == 0 && st.Birthtimespec.Nsec == 0 {
		return time.Time{}, false
	}
	return time.Unix(st.Birthtimespec.Sec, st.Birthtimespec.Nsec), true
}
