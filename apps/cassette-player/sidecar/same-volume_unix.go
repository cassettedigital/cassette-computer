//go:build !windows

package main

import "golang.org/x/sys/unix"

// sameVolume reports whether a and b are on one disk, where a move is a rename rather than a copy.
func sameVolume(a, b string) bool {
	var sa, sb unix.Stat_t
	if unix.Stat(a, &sa) != nil || unix.Stat(b, &sb) != nil {
		return false
	}
	return sa.Dev == sb.Dev
}
