//go:build darwin

package main

import (
	"strings"
	"testing"
)

// The diskutil parsing these tests read lives in usb_platform_darwin.go, so they build on macOS only.
// In usb_test.go they broke `go vet` and `go test` for Linux and Windows (BUG-869).

// Captured from `diskutil info /` on the founder's Mac (2026-09-15), trimmed.
const diskutilBootSample = `   Device Identifier:         disk3s1s1
   Device Node:               /dev/disk3s1s1
   Whole:                     No
   Part of Whole:             disk3

   Volume Name:               Macintosh HD
   Mounted:                   Yes
   Mount Point:               /

   File System Personality:   APFS
   Type (Bundle):             apfs
   Name (User Visible):       APFS

   Protocol:                  Apple Fabric
   Volume UUID:               4EE4B5D2-1F80-4EC2-A868-26F3DF27E9AA

   Media Read-Only:           Yes
   Volume Read-Only:          Yes (read-only mount flag set)

   Device Location:           Internal
   Removable Media:           Fixed
`

// The shape diskutil prints for an exFAT card in a USB player.
const diskutilCardSample = `   Device Identifier:         disk10s1
   Device Node:               /dev/disk10s1
   Whole:                     No
   Part of Whole:             disk10

   Volume Name:               ECHO MINI
   Mounted:                   Yes
   Mount Point:               /Volumes/ECHO MINI

   Partition Type:            Windows_NTFS
   File System Personality:   ExFAT
   Type (Bundle):             exfat
   Name (User Visible):       ExFAT

   Protocol:                  USB
   Disk Size:                 64.0 GB (63999836160 Bytes) (exactly 124999680 512-Byte-Units)
   Volume UUID:               A1B2C3D4-0000-1111-2222-333344445555

   Media Read-Only:           No
   Volume Read-Only:          No

   Device Location:           External
   Removable Media:           Removable
   Media Removal:             Software-Activated
`

// A mounted .dmg (the simulator runtimes show up like this): external by
// location, but not something a person carries away.
const diskutilImageSample = `   Device Identifier:         disk5s1
   Volume Name:               AppleTVOS 26.5 Simulator
   Mounted:                   Yes
   Mount Point:               /Volumes/AppleTVOS 26.5 Simulator
   File System Personality:   APFS
   Protocol:                  Disk Image
   Virtual:                   Yes
   Media Read-Only:           No
   Volume Read-Only:          No
   Device Location:           External
   Removable Media:           Removable
`

func TestParseDiskutilInfoKeepsColonsInValues(t *testing.T) {
	m := parseDiskutilInfo("   Mount Point:   /Volumes/A:B\n   Mounted: Yes\n")
	if m["Mount Point"] != "/Volumes/A:B" {
		t.Fatalf("Mount Point = %q", m["Mount Point"])
	}
	if m["Mounted"] != "Yes" {
		t.Fatalf("Mounted = %q", m["Mounted"])
	}
}

func TestClassifyDiskutilVolume(t *testing.T) {
	if _, ok := classifyDiskutilVolume("/", parseDiskutilInfo(diskutilBootSample)); ok {
		t.Fatal("the boot volume must never be listed")
	}
	if _, ok := classifyDiskutilVolume("/Volumes/AppleTVOS 26.5 Simulator", parseDiskutilInfo(diskutilImageSample)); ok {
		t.Fatal("a mounted disk image must never be listed")
	}
	vol, ok := classifyDiskutilVolume("/Volumes/ECHO MINI", parseDiskutilInfo(diskutilCardSample))
	if !ok {
		t.Fatal("an external exFAT card must be listed")
	}
	if vol.Name != "ECHO MINI" || vol.Filesystem != "ExFAT" || !vol.Writable || vol.Device != "disk10s1" {
		t.Fatalf("unexpected volume: %+v", vol)
	}
	if vol.VolumeUUID != "A1B2C3D4-0000-1111-2222-333344445555" {
		t.Fatalf("uuid = %q", vol.VolumeUUID)
	}

	locked := strings.Replace(diskutilCardSample, "Volume Read-Only:          No", "Volume Read-Only:          Yes (read-only mount flag set)", 1)
	vol, ok = classifyDiskutilVolume("/Volumes/ECHO MINI", parseDiskutilInfo(locked))
	if !ok || vol.Writable {
		t.Fatalf("a locked card is listed but not writable: ok=%v writable=%v", ok, vol.Writable)
	}
}
