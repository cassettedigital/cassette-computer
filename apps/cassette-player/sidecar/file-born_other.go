//go:build !darwin

package main

import (
	"os"
	"time"
)

// fileBornAt: no creation date to read here, so the last change stands in for it (see file-born_darwin.go). A tag
// write then reads as a newer file, which only ever costs a phone one extra download, never a stale copy.
func fileBornAt(fi os.FileInfo) (time.Time, bool) {
	return fi.ModTime(), true
}
