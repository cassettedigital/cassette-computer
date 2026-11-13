package main

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

// TestMain keeps every test's "moved to the Trash" fixtures out of the real
// Trash: trashStale moves them into a scratch folder instead.
func TestMain(m *testing.M) {
	bin, err := os.MkdirTemp("", "sidecar-test-trash-")
	if err != nil {
		panic(err)
	}
	trashStale = func(p string) error {
		return os.Rename(p, filepath.Join(bin, filepath.Base(p)+"."+time.Now().Format("150405.000000000")))
	}
	code := m.Run()
	os.RemoveAll(bin)
	os.Exit(code)
}

// TestFolderArtAllowedOnlyForNewFolders (BUG-786): the automatic passes write
// only into folders created after the hub started watching.
func TestFolderArtAllowedOnlyForNewFolders(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("folder creation times are read on macOS only")
	}
	t.Cleanup(func() { folderArtSinceNanos.Store(0) })
	dir := t.TempDir()

	folderArtSinceNanos.Store(0)
	if folderArtAllowed(dir) {
		t.Error("with no start time recorded, nothing may be written")
	}

	state := &SidecarState{FolderArtSince: time.Now().Add(-time.Hour)}
	if ensureFolderArtBaseline(state) {
		t.Error("an existing start time must be kept, not restamped")
	}
	if !folderArtAllowed(dir) {
		t.Error("a folder made after the start time should get art")
	}

	state = &SidecarState{FolderArtSince: time.Now().Add(time.Hour)}
	ensureFolderArtBaseline(state)
	if folderArtAllowed(dir) {
		t.Error("a folder that was already there must be left alone")
	}

	fresh := &SidecarState{}
	if !ensureFolderArtBaseline(fresh) || fresh.FolderArtSince.IsZero() {
		t.Error("the first run must stamp a start time and ask to save it")
	}
	if folderArtAllowed(dir) {
		t.Error("a folder that predates the first run must be left alone")
	}
}

// TestArtistDirForPathNeverRoot (BUG-787): an artist photo lands in the artist
// folder, in the album folder for a flat album, and never in the library root
// or above it.
func TestArtistDirForPathNeverRoot(t *testing.T) {
	root := t.TempDir()
	prev := sidecarMusicDir
	sidecarMusicDir = root
	t.Cleanup(func() { sidecarMusicDir = prev })

	nested := filepath.Join(root, "Artist", "Album")
	flat := filepath.Join(root, "Artist - Album")
	for _, d := range []string{nested, flat} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}

	if got, err := artistDirForPath(filepath.Join(nested, "01.flac")); err != nil || got != filepath.Join(root, "Artist") {
		t.Errorf("nested: got %q, %v", got, err)
	}
	if got, err := artistDirForPath(filepath.Join(flat, "01.flac")); err != nil || got != flat {
		t.Errorf("flat album: got %q, %v; want the album folder", got, err)
	}
	if got, err := artistDirForPath(filepath.Join(root, "loose.flac")); err == nil {
		t.Errorf("a song loose in the library root must have no artist folder, got %q", got)
	}
}
