//go:build windows

package main

import "golang.org/x/sys/windows"

// diskFreeBytes is the room a person can still use on the disk holding path, or -1 when it won't say.
func diskFreeBytes(path string) int64 {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return -1
	}
	var free, total, totalFree uint64
	if err := windows.GetDiskFreeSpaceEx(p, &free, &total, &totalFree); err != nil {
		return -1
	}
	return int64(free)
}
