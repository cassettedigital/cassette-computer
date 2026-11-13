package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
)

// withFakeCloud points the hub's cloud calls at h, signed in, for one test.
func withFakeCloud(t *testing.T, h http.HandlerFunc) {
	t.Helper()
	srv := httptest.NewServer(h)
	prevBase, prevState := cassetteBase, liveState
	cassetteBase = srv.URL
	liveState = &SidecarState{BearerToken: "hub-token"}
	t.Cleanup(func() {
		srv.Close()
		cassetteBase, liveState = prevBase, prevState
	})
}

// The end of a rip asks the cloud the rip panel's own question (the disc's release, album and album
// artist, signed in as the hub) and keeps that picture, fetched from the address meant for the file:
// the cover the person saw, whatever album the library later files the rip as (BUG-919).
func TestDiscOwnCover_AsksTheRipPanelsQuestion(t *testing.T) {
	img := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/file.jpg" {
			http.NotFound(w, r) // the shown address is not where the file is fetched from
			return
		}
		w.Header().Set("Content-Type", "image/jpeg")
		_, _ = w.Write(jpegBytes)
	}))
	defer img.Close()
	var asked atomic.Int32
	withFakeCloud(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/catalog/disc-cover" {
			t.Errorf("asked %s; the disc's cover comes from /api/catalog/disc-cover", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		asked.Add(1)
		q := r.URL.Query()
		if q.Get("releaseMbid") != "2aaf404a" || q.Get("album") != "The Very Best of Daryl Hall & John Oates" || q.Get("artist") != "Daryl Hall & John Oates" {
			t.Errorf("asked %v, want the disc's own release, album and artist", q)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer hub-token" {
			t.Errorf("Authorization = %q, want the hub's token", got)
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"coverUrl": img.URL + "/shown.jpg", "fileUrl": img.URL + "/file.jpg"})
	})

	rel := &MatchedRelease{ReleaseMBID: "2aaf404a", Album: "The Very Best of Daryl Hall & John Oates", AlbumArtist: "Daryl Hall & John Oates"}
	data, _, ok, triedRelease := discOwnCover(rel)
	if !ok || !bytes.Equal(data, jpegBytes) {
		t.Fatalf("discOwnCover ok=%v (%d bytes); want the panel's picture", ok, len(data))
	}
	if triedRelease {
		t.Error("the panel's cover was found, yet the Cover Art Archive was asked too")
	}
	if asked.Load() != 1 {
		t.Errorf("cloud asked %d times, want once", asked.Load())
	}
}

// A disc we couldn't name at all has no cover of its own: nothing is asked, so nothing can match an
// album that merely shares a placeholder name.
func TestDiscOwnCover_NamelessDiscAsksNothing(t *testing.T) {
	withFakeCloud(t, func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("a nameless disc asked the cloud %s", r.URL.Path)
	})
	if _, _, ok, tried := discOwnCover(&MatchedRelease{Album: "Unknown Album", Unidentified: true, NeedsNaming: true}); ok || tried {
		t.Errorf("nameless disc: ok=%v tried=%v, want nothing", ok, tried)
	}
	if _, _, ok, tried := discOwnCover(nil); ok || tried {
		t.Errorf("no release: ok=%v tried=%v, want nothing", ok, tried)
	}
}

// The rip's first cover step is the art inside the files and nothing else: it never asks the cloud for
// the matched album's cover (which, on a re-rip of an album filed wrong, would beat the disc's own), and a
// folder that already has a cover keeps it.
func TestMaterializeEmbeddedCover_NeverAsksTheCatalog(t *testing.T) {
	withFakeCloud(t, func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("the embedded-art step asked the cloud %s", r.URL.Path)
	})
	dir := t.TempDir()
	synthFLAC(t, filepath.Join(dir, "01 - Rich Girl.flac")) // no art inside
	if wrote, err := materializeEmbeddedCover(dir); err != nil || wrote {
		t.Fatalf("no embedded art: wrote=%v err=%v, want nothing written", wrote, err)
	}
	if hasFolderCover(dir) {
		t.Fatal("a cover appeared with no embedded art")
	}

	mine := filepath.Join(dir, "folder.png")
	if err := os.WriteFile(mine, pngBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	if wrote, _ := materializeEmbeddedCover(dir); wrote {
		t.Error("wrote over a folder that already has a cover")
	}
	if got, _ := os.ReadFile(mine); !bytes.Equal(got, pngBytes) {
		t.Error("the person's own cover changed")
	}
}
