//go:build windows

package main

import (
	"log"
	"os"
	"syscall"

	"golang.org/x/sys/windows"
)

// carryFileMetadata gives tmp, the rewritten copy of the song at src, the original's creation date (the Windows
// port, 2026-11-07), as file-metadata_darwin.go does on a Mac (BUG-861). That date is what tells the phones a
// song was replaced rather than retagged (BUG-897), so a tag write must not make the file look new. Windows has
// no Finder tags or extended attributes to carry. A date the volume won't take is logged, never a failed write.
func carryFileMetadata(src string, fi os.FileInfo, tmp *os.File) error {
	d, ok := fi.Sys().(*syscall.Win32FileAttributeData)
	if !ok || (d.CreationTime.HighDateTime == 0 && d.CreationTime.LowDateTime == 0) {
		return nil
	}
	created := windows.Filetime{LowDateTime: d.CreationTime.LowDateTime, HighDateTime: d.CreationTime.HighDateTime}
	if err := windows.SetFileTime(windows.Handle(tmp.Fd()), &created, nil, nil); err != nil {
		log.Printf("tag write: could not keep the creation date of %q: %v", src, err)
	}
	return nil
}
