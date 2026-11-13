//go:build !windows

package main

import "golang.org/x/sys/unix"

// diskFreeBytes is the room a person can still use on the disk holding path, or -1 when it won't say.
func diskFreeBytes(path string) int64 {
	var st unix.Statfs_t
	if err := unix.Statfs(path, &st); err != nil {
		return -1
	}
	return int64(st.Bavail) * int64(st.Bsize)
}
