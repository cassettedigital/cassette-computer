package main

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestAudioFingerprintsKeepToTheirTime (BUG-789): with no time left nothing is
// read and every song still goes up; with time, new songs are read first; a
// known, unchanged song reuses its fingerprint without being read.
func TestAudioFingerprintsKeepToTheirTime(t *testing.T) {
	dir := t.TempDir()
	var tracks []librarySyncTrack
	for i := 0; i < 3; i++ {
		p := filepath.Join(dir, fmt.Sprintf("%02d.flac", i))
		if err := os.WriteFile(p, []byte(fmt.Sprintf("audio %d", i)), 0o644); err != nil {
			t.Fatal(err)
		}
		tracks = append(tracks, librarySyncTrack{Path: p, CassetteLocalID: fmt.Sprintf("%032d", i)})
	}
	state := &SidecarState{}

	attachAudioFingerprintsWithin(tracks, state, 0)
	for _, tr := range tracks {
		if tr.AudioFingerprint != nil {
			t.Fatalf("no time to read, yet %s got a fingerprint", tr.Path)
		}
	}

	attachAudioFingerprintsWithin(tracks, state, time.Minute)
	for _, tr := range tracks {
		if tr.AudioFingerprint == nil {
			t.Fatalf("%s should have been read", tr.Path)
		}
	}
	first := *tracks[0].AudioFingerprint

	// Unchanged and freshly read: reused even with no time to read anything.
	again := make([]librarySyncTrack, len(tracks))
	for i, tr := range tracks {
		again[i] = librarySyncTrack{Path: tr.Path, CassetteLocalID: tr.CassetteLocalID}
	}
	attachAudioFingerprintsWithin(again, state, 0)
	if again[0].AudioFingerprint == nil || *again[0].AudioFingerprint != first {
		t.Error("a known, unchanged song should reuse its fingerprint without being read")
	}
}
