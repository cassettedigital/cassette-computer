//go:build windows

package main

import (
	"path/filepath"
	"strings"
)

// sameVolume reports whether a and b are on one drive, where a move is a rename rather than a copy.
func sameVolume(a, b string) bool {
	va, vb := filepath.VolumeName(a), filepath.VolumeName(b)
	return va != "" && strings.EqualFold(va, vb)
}
