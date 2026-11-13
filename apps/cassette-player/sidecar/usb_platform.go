// Per-OS removable-volume seam for corded devices (USB players, memory cards).
//
// Same shape as the disc seam in rip_platform.go: the OS-neutral layer in
// usb.go never shells out to a platform tool; it asks usbOS. macOS's
// implementation is usb_platform_darwin.go (diskutil + statfs). Every other OS
// compiles the stub, which lists nothing, so the feature is simply absent there
// until a port lands rather than half-working.

package main

// usbVolume is one mounted volume a person could carry away.
type usbVolume struct {
	// MountPath is where the volume's files are (e.g. /Volumes/ECHO MINI).
	MountPath string `json:"mountPath"`
	// Name is the volume label the OS shows in Finder.
	Name string `json:"name"`
	// VolumeUUID is the OS's identifier for the volume. A secondary hint only:
	// identity for sync purposes is the marker file (see usb.go).
	VolumeUUID string `json:"volumeUuid,omitempty"`
	// Device is the OS device identifier (e.g. disk10s1). Diagnostics only.
	Device string `json:"device,omitempty"`
	// Filesystem is the human-readable filesystem name (exFAT, MS-DOS FAT32, …).
	Filesystem string `json:"filesystem,omitempty"`
	TotalBytes int64  `json:"totalBytes"`
	FreeBytes  int64  `json:"freeBytes"`
	// Writable is false for a read-only mount (a locked card). Listed so the pane
	// can say why it can't be added; never a sync target.
	Writable bool `json:"writable"`
}

// usbPlatform is the seam between usb.go and the OS.
type usbPlatform interface {
	// listRemovableVolumes returns every mounted, external-or-removable volume.
	// Internal disks, the boot volume, disk images and network mounts are never
	// returned, so nothing here can be mistaken for a sync target by accident.
	listRemovableVolumes() ([]usbVolume, error)

	// freeBytes reports the free space on the volume at mountPath, or -1 when the
	// OS can't say (the copy loop then proceeds without the room guard).
	freeBytes(mountPath string) int64

	// scrubFile strips whatever the OS stamped on a file or folder the hub just
	// wrote that would surface as junk on the card. macOS adds extended
	// attributes (com.apple.provenance) to files an app writes, and on FAT/exFAT
	// those materialise as a "._name" AppleDouble sidecar next to every file - a
	// player then lists 484 "tracks" for 242 songs. No-op elsewhere.
	scrubFile(path string)
}

// usbOS is the compiled-in implementation for this OS (set by the platform
// file's init).
var usbOS usbPlatform
