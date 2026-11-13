//go:build windows

package main

import (
	"os"
	"syscall"
	"time"
)

// folderBornAt returns path's creation time: NTFS keeps a real one (the Windows port, 2026-11-07). Copying a
// folder in makes a new folder with a new date, moving one on the same disk keeps its date, the same as on a
// Mac, so the folder-art rule (folderArtAllowed) reads the same on both.
func folderBornAt(path string) (time.Time, bool) {
	fi, err := os.Stat(path)
	if err != nil {
		return time.Time{}, false
	}
	return windowsCreated(fi)
}

// windowsCreated is a file's or folder's creation time, as Windows records it. A zero means the volume keeps none.
func windowsCreated(fi os.FileInfo) (time.Time, bool) {
	d, ok := fi.Sys().(*syscall.Win32FileAttributeData)
	if !ok || (d.CreationTime.HighDateTime == 0 && d.CreationTime.LowDateTime == 0) {
		return time.Time{}, false
	}
	return time.Unix(0, d.CreationTime.Nanoseconds()), true
}
