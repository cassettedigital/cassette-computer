//go:build darwin

// macOS removable-volume enumeration for corded devices.
//
// Walks /Volumes and asks `diskutil info` about each entry. diskutil is what
// tells external from internal, a real card from a mounted disk image, and a
// writable mount from a locked one; statfs supplies the sizes. Read-only
// throughout: nothing here touches a volume.

package main

import (
	"context"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

type darwinUSB struct{}

func init() { usbOS = darwinUSB{} }

const diskutilTimeout = 8 * time.Second

func (darwinUSB) listRemovableVolumes() ([]usbVolume, error) {
	entries, err := os.ReadDir("/Volumes")
	if err != nil {
		return nil, err
	}
	var out []usbVolume
	for _, e := range entries {
		mount := filepath.Join("/Volumes", e.Name())
		// "Macintosh HD" is a symlink to /; anything that isn't a real directory
		// here isn't a mounted volume.
		fi, err := os.Lstat(mount)
		if err != nil || fi.Mode()&os.ModeSymlink != 0 || !fi.IsDir() {
			continue
		}
		info, err := diskutilInfo(mount)
		if err != nil {
			log.Printf("usb: diskutil info %q failed: %v", mount, err)
			continue
		}
		vol, ok := classifyDiskutilVolume(mount, info)
		if !ok {
			continue
		}
		vol.TotalBytes, vol.FreeBytes = statfsBytes(mount)
		out = append(out, vol)
	}
	return out, nil
}

func (darwinUSB) freeBytes(mountPath string) int64 {
	_, free := statfsBytes(mountPath)
	return free
}

// scrubFile removes every extended attribute from path and deletes the
// AppleDouble sidecar macOS may already have written for it. Best effort: a
// player reading a card with a stray "._" entry is a nuisance, never a fault.
func (darwinUSB) scrubFile(path string) {
	buf := make([]byte, 8192)
	if n, err := unix.Listxattr(path, buf); err == nil && n > 0 {
		for _, name := range strings.Split(strings.TrimRight(string(buf[:n]), "\x00"), "\x00") {
			if name != "" {
				_ = unix.Removexattr(path, name)
			}
		}
	}
	_ = os.Remove(filepath.Join(filepath.Dir(path), "._"+filepath.Base(path)))
}

func diskutilInfo(mount string) (map[string]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), diskutilTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, "/usr/sbin/diskutil", "info", mount).Output()
	if err != nil {
		return nil, err
	}
	return parseDiskutilInfo(string(out)), nil
}

// statfsBytes returns (total, free) bytes for the filesystem at mount, or
// (-1, -1) when the call fails.
func statfsBytes(mount string) (int64, int64) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(mount, &st); err != nil {
		return -1, -1
	}
	bsize := int64(st.Bsize)
	return int64(st.Blocks) * bsize, int64(st.Bavail) * bsize
}

// parseDiskutilInfo turns diskutil's "   Key:   Value" text into a map. Values
// keep any colons of their own (SplitN on the first colon only). Pure, so the
// classification below is testable on captured output.
func parseDiskutilInfo(text string) map[string]string {
	m := map[string]string{}
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		i := strings.Index(line, ":")
		if i <= 0 {
			continue
		}
		key := strings.TrimSpace(line[:i])
		val := strings.TrimSpace(line[i+1:])
		if _, dup := m[key]; dup {
			continue // first occurrence wins
		}
		m[key] = val
	}
	return m
}

// classifyDiskutilVolume decides whether a diskutil record describes a volume a
// person could carry away, and if so builds the usbVolume for it (sizes are
// filled in by the caller). The rules, each one a real false positive seen on a
// Mac: the boot volume and any internal disk are out; a mounted disk image (a
// .dmg, a simulator runtime) reports as external and is out; a network mount
// has no diskutil record at all and never gets here.
func classifyDiskutilVolume(mount string, info map[string]string) (usbVolume, bool) {
	if v, ok := info["Mounted"]; ok && !strings.EqualFold(v, "Yes") {
		return usbVolume{}, false
	}
	external := strings.EqualFold(info["Device Location"], "External") ||
		strings.HasPrefix(strings.ToLower(info["Removable Media"]), "removable")
	if !external {
		return usbVolume{}, false
	}
	if strings.EqualFold(info["Protocol"], "Disk Image") || strings.EqualFold(info["Virtual"], "Yes") {
		return usbVolume{}, false
	}
	readOnly := strings.HasPrefix(strings.ToLower(info["Volume Read-Only"]), "yes") ||
		strings.HasPrefix(strings.ToLower(info["Media Read-Only"]), "yes")

	name := strings.TrimSpace(info["Volume Name"])
	if name == "" {
		name = filepath.Base(mount)
	}
	fs := strings.TrimSpace(info["File System Personality"])
	if fs == "" {
		fs = strings.TrimSpace(info["Name (User Visible)"])
	}
	return usbVolume{
		MountPath:  mount,
		Name:       name,
		VolumeUUID: strings.TrimSpace(info["Volume UUID"]),
		Device:     strings.TrimSpace(info["Device Identifier"]),
		Filesystem: fs,
		Writable:   !readOnly,
	}, true
}
