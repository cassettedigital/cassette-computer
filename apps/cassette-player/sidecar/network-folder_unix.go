//go:build darwin || linux

package main

import (
	"runtime"
	"strings"

	"golang.org/x/sys/unix"
)

// isNetworkFolder reports whether path sits on a network share (a NAS over SMB, AFP or NFS). Change
// notices don't arrive for changes another machine makes there, so those folders are looked at on a
// timer instead (library-folders.go). False when it can't tell: the folder then gets the local treatment,
// and the hourly scan still catches what notices miss.
func isNetworkFolder(path string) bool {
	var st unix.Statfs_t
	if err := unix.Statfs(path, &st); err != nil {
		return false
	}
	if runtime.GOOS == "darwin" {
		return networkFSName(statfsTypeName(&st))
	}
	return networkFSMagic(int64(statfsMagic(&st)))
}

func networkFSName(name string) bool {
	switch strings.ToLower(name) {
	case "smbfs", "afpfs", "nfs", "webdav", "cifs", "ftp":
		return true
	}
	return false
}

func networkFSMagic(m int64) bool {
	switch m {
	case 0x6969, // NFS
		0x517B,     // SMB
		0xFF534D42, // CIFS
		0xFE534D42, // SMB2
		0x65735546: // FUSE (sshfs and friends)
		return true
	}
	return false
}
