package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// The folder watcher's heart: musicDirSignature must change when AUDIO content OR
// folder cover art is added/modified/removed — so both a track drop and a Finder-side
// cover swap are noticed — while ignoring incidental non-audio writes (lyrics,
// .DS_Store) so the watcher doesn't churn. The sidecar's own cover writes don't loop
// because the watcher recomputes its baseline after each ingest (see musicDirSignature).
func TestMusicDirSignature_DetectsAudioChangesOnly(t *testing.T) {
	tmp := t.TempDir()
	old := sidecarMusicDir
	sidecarMusicDir = tmp
	defer func() { sidecarMusicDir = old }()

	base := musicDirSignature()

	// incidental non-audio, non-cover file → signature unchanged
	if err := os.WriteFile(filepath.Join(tmp, "notes.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if musicDirSignature() != base {
		t.Fatal("an incidental non-audio file changed the signature (watcher would churn)")
	}

	// folder cover art → signature changes: a cover swap must be noticed even though
	// no audio file changed (that's why cover art is folded into the signature).
	if err := os.WriteFile(filepath.Join(tmp, "cover.jpg"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if musicDirSignature() == base {
		t.Fatal("adding folder cover art did not change the signature (Finder cover swaps would be missed)")
	}
	base = musicDirSignature() // fold the cover into the baseline for the audio checks below

	// drop an audio file → signature changes
	album := filepath.Join(tmp, "Artist", "Album")
	if err := os.MkdirAll(album, 0o755); err != nil {
		t.Fatal(err)
	}
	track := filepath.Join(album, "01 - Track.flac")
	if err := os.WriteFile(track, []byte("audio"), 0o644); err != nil {
		t.Fatal(err)
	}
	withFile := musicDirSignature()
	if withFile == base {
		t.Fatal("dropping an audio file did not change the signature")
	}

	// modify the audio file (size/mtime) → signature changes (mid-copy detection)
	if err := os.WriteFile(track, []byte("audio-larger"), 0o644); err != nil {
		t.Fatal(err)
	}
	if musicDirSignature() == withFile {
		t.Fatal("modifying the audio file did not change the signature")
	}

	// remove it → signature changes (count drops)
	if err := os.Remove(track); err != nil {
		t.Fatal(err)
	}
	if musicDirSignature() == withFile {
		t.Fatal("removing the audio file did not change the signature")
	}
}

// The explicit endpoint: POST signals the watcher and reports started; GET is 405.
func TestHandleLibraryIngest_Contract(t *testing.T) {
	select { // drain any pending trigger
	case <-ingestTrigger:
	default:
	}

	rec := httptest.NewRecorder()
	handleLibraryIngest(rec, httptest.NewRequest(http.MethodPost, "/api/library/ingest", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("POST status = %d, want 200", rec.Code)
	}
	select {
	case <-ingestTrigger: // good — it signaled the watcher
	default:
		t.Fatal("POST did not signal the ingest trigger")
	}

	rec2 := httptest.NewRecorder()
	handleLibraryIngest(rec2, httptest.NewRequest(http.MethodGet, "/api/library/ingest", nil))
	if rec2.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET status = %d, want 405", rec2.Code)
	}
}
