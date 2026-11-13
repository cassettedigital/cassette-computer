//go:build darwin

package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestWatchMusicDirSeesANewFile (BUG-789): macOS tells the hub about a file
// added under the music folder, so nothing has to re-read it on a timer.
func TestWatchMusicDirSeesANewFile(t *testing.T) {
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if !watchMusicDir(dir) {
		t.Fatal("the change watch didn't start")
	}
	for len(musicDirEvents) > 0 {
		<-musicDirEvents
	}
	time.Sleep(500 * time.Millisecond)
	if err := os.MkdirAll(filepath.Join(dir, "Artist", "Album"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "Artist", "Album", "01.flac"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	select {
	case <-musicDirEvents:
	case <-time.After(15 * time.Second):
		t.Fatal("no change notice within 15 s")
	}
}
