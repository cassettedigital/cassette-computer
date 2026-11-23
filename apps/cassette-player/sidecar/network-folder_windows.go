//go:build windows

package main

import (
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
)

// isNetworkFolder reports whether path sits on a network share: a \\server\share path, or a drive letter
// mapped to one. See network-folder_unix.go for why it matters.
func isNetworkFolder(path string) bool {
	if strings.HasPrefix(path, `\\`) {
		return true
	}
	vol := filepath.VolumeName(path)
	if vol == "" {
		return false
	}
	root, err := windows.UTF16PtrFromString(vol + `\`)
	if err != nil {
		return false
	}
	return windows.GetDriveType(root) == windows.DRIVE_REMOTE
}
