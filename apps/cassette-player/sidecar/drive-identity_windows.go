//go:build windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
)

// driveOf names the drive a folder is on by the drive's own serial number, and the folder's place on it,
// so a drive Windows gives another letter (E: one day, F: the next) can still be found. ok is false for a
// network share (\\server\share keeps its name) or a folder whose drive won't say.
func driveOf(path string) (serial, rel string, ok bool) {
	vol := filepath.VolumeName(path)
	if len(vol) != 2 || vol[1] != ':' {
		return "", "", false
	}
	s, err := volumeSerial(vol + `\`)
	if err != nil {
		return "", "", false
	}
	return s, strings.TrimPrefix(path[len(vol):], `\`), true
}

func volumeSerial(root string) (string, error) {
	p, err := windows.UTF16PtrFromString(root)
	if err != nil {
		return "", err
	}
	var serial uint32
	if err := windows.GetVolumeInformation(p, nil, 0, &serial, nil, nil, nil, 0); err != nil {
		return "", err
	}
	return fmt.Sprintf("%08X", serial), nil
}

// findOnDrive looks through the drive letters for the drive with this serial and returns the folder's
// path on it now, when that folder is there.
func findOnDrive(serial, rel string) (string, bool) {
	mask, err := windows.GetLogicalDrives()
	if err != nil {
		return "", false
	}
	for i := 0; i < 26; i++ {
		if mask&(1<<uint(i)) == 0 {
			continue
		}
		root := string(rune('A'+i)) + `:\`
		if s, err := volumeSerial(root); err != nil || s != serial {
			continue
		}
		p := filepath.Join(root, rel)
		if info, err := os.Stat(p); err == nil && info.IsDir() {
			return p, true
		}
	}
	return "", false
}
