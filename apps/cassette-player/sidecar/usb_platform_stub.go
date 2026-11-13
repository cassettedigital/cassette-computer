//go:build !darwin

// Not-yet-ported placeholder for corded devices on Windows and Linux. Lists
// nothing, so the Devices pane honestly shows no plugged-in players there
// instead of half-working. A port replaces this with the OS's volume
// enumeration (Windows: GetLogicalDrives + DRIVE_REMOVABLE; Linux: /proc/mounts
// against /sys/block/*/removable) and keeps usb.go untouched.

package main

type stubUSB struct{}

func init() { usbOS = stubUSB{} }

func (stubUSB) listRemovableVolumes() ([]usbVolume, error) { return nil, nil }

func (stubUSB) freeBytes(string) int64 { return -1 }

func (stubUSB) scrubFile(string) {}
