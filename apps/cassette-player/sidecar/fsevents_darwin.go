//go:build darwin

package main

// #cgo LDFLAGS: -framework CoreServices
// #include <stdlib.h>
// int cassetteWatchDir(const char *path);
// int cassetteWatchLinked(const char *path);
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

//export cassetteLinkedFolderChanged
func cassetteLinkedFolderChanged() { noteLinkedFolderChanged() }

// watchLinkedFolder is watchMusicDir for a folder Cassette only reads: its notices go to the linked
// folders' own watcher (library-folders.go). The watch lives for the whole process; one left on a folder
// that was later removed only wakes a look that finds nothing to do.
func watchLinkedFolder(dir string) bool {
	cs := C.CString(dir)
	defer C.free(unsafe.Pointer(cs))
	return C.cassetteWatchLinked(cs) == 1
}
