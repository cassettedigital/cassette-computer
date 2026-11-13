//go:build darwin

package main

// #cgo LDFLAGS: -framework CoreServices
// #include <stdlib.h>
// int cassetteWatchDir(const char *path);
import "C"
import "unsafe"

//export cassetteMusicDirChanged
func cassetteMusicDirChanged() { noteMusicDirChanged() }

// watchMusicDir asks macOS to say when anything under dir changes, so the hub
// stops re-reading the whole folder every few seconds (BUG-789). False when the
// watch couldn't start; the caller falls back to polling.
func watchMusicDir(dir string) bool {
	cs := C.CString(dir)
	defer C.free(unsafe.Pointer(cs))
	return C.cassetteWatchDir(cs) == 1
}
