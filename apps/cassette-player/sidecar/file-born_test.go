package main

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

// BUG-897: a song's file creation time stays put through a change that keeps the file (a tag write, here its date
// moving on) and moves on when the file is replaced (a re-rip).
func TestFileCreationTimeTellsAReplacedFileFromAnEditedOne(t *testing.T) {
	p := filepath.Join(t.TempDir(), "01 - Song.flac")
	if err := os.WriteFile(p, flacFile("ARTIST=X", "first rip"), 0o644); err != nil {
		t.Fatal(err)
	}
	created := func() int64 {
		tracks := []librarySyncTrack{{Path: p, CassetteLocalID: "id1"}}
		attachAudioFingerprints(tracks, &SidecarState{})
		if tracks[0].FileCreatedAt == nil {
			t.Fatal("no creation time sent")
		}
		return *tracks[0].FileCreatedAt
	}
	first := created()

	later := time.Now().Add(2 * time.Hour)
	if err := os.Chtimes(p, later, later); err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS == "darwin" && created() != first {
		t.Fatal("an edit that kept the file moved its creation time")
	}

	time.Sleep(1100 * time.Millisecond)
	if err := os.Remove(p); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, flacFile("ARTIST=X", "the re-rip"), 0o644); err != nil {
		t.Fatal(err)
	}
	if again := created(); again <= first {
		t.Fatalf("a replaced file kept the old creation time (%d, was %d)", again, first)
	}
}
