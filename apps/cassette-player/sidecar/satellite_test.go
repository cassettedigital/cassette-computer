package main

import (
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestCopyVerdictFollowsTheMainComputer(t *testing.T) {
	cases := []struct{ recorded, current, want string }{
		{"abc", "abc", "keep"}, // the same song
		{"abc", "", "keep"},    // the main hasn't measured it yet: no signal, never a re-copy
		{"", "", "keep"},
		{"abc", "def", "recopy"},   // changed at the source: copy it again, no reasons asked
		{"", "abc", "recopy"},      // a copy whose version was never known is followed to the source
		{"abc", "a1:abc", "adopt"}, // measured a new way: the same song, the new baseline
		{"f1:abc", "a1:def", "adopt"},
		{"a1:abc", "a1:def", "recopy"},
	}
	for _, c := range cases {
		if got := copyVerdict(c.recorded, c.current); got != c.want {
			t.Errorf("copyVerdict(%q, %q) = %q, want %q", c.recorded, c.current, got, c.want)
		}
	}
}

func TestSatRelPathIsTheMainsTagsMadeSafe(t *testing.T) {
	s := &mainSong{ID: "x", DisplayAlbumArtist: "AC/DC", Album: "Back: In Black?", Title: "Hells Bells", Track: 1, Suffix: "flac"}
	if got := satRelPath(s); got != "AC_DC/Back_ In Black_/01 Hells Bells.flac" {
		t.Errorf("got %q", got)
	}
	s2 := &mainSong{ID: "y", Artist: "Big Thief", Album: "Dragon", Title: "Spud Infinity", Track: 3, DiscNumber: 2, Suffix: "mp3"}
	if got := satRelPath(s2); got != "Big Thief/Dragon/2-03 Spud Infinity.mp3" {
		t.Errorf("got %q", got)
	}
	if got := satRelPath(&mainSong{ID: "z"}); got != "Unknown artist/Unknown album/z.audio" {
		t.Errorf("got %q", got)
	}
}

func TestPinnedClientTrustsOnlyTheMainComputersKey(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("ok")) }))
	defer srv.Close()
	sum := sha256.Sum256(srv.Certificate().RawSubjectPublicKeyInfo)
	pin := base64.StdEncoding.EncodeToString(sum[:])
	resp, err := pinnedClient(pin, 0).Get(srv.URL)
	if err != nil {
		t.Fatalf("the main computer's own key was refused: %v", err)
	}
	resp.Body.Close()
	wrong := base64.StdEncoding.EncodeToString(make([]byte, 32))
	if _, err := pinnedClient(wrong, 0).Get(srv.URL); err == nil {
		t.Fatal("a computer with another key was trusted")
	}
}

func TestLocalSongIDMapsOnlyOnASatellite(t *testing.T) {
	defer satelliteOn.Store(false)
	defer satIndex.Store(nil)
	satelliteOn.Store(false)
	if got := localSongID("main-1"); got != "main-1" {
		t.Errorf("the main computer's ids must pass through, got %q", got)
	}
	satelliteOn.Store(true)
	satIndex.Store(&satelliteIndex{byMain: map[string]string{"main-1": "here-9"}})
	if got := localSongID("main-1"); got != "here-9" {
		t.Errorf("got %q", got)
	}
	if got := localSongID("main-2"); got != "" {
		t.Errorf("a song not on this computer must not play, got %q", got)
	}
}

func TestSatelliteFolderNeverTakesAFolderWithThingsInIt(t *testing.T) {
	root := t.TempDir()
	old := sidecarMusicDir
	defer func() { sidecarMusicDir = old }()
	sidecarMusicDir = filepath.Join(root, "Cassette")
	if got := satelliteFolderFor("Home desktop"); got != filepath.Join(root, "Cassette from Home desktop") {
		t.Fatalf("got %q", got)
	}
	taken := filepath.Join(root, "Cassette from Home desktop")
	_ = os.MkdirAll(taken, 0o755)
	_ = os.WriteFile(filepath.Join(taken, "someone's notes.txt"), []byte("x"), 0o644)
	if got := satelliteFolderFor("Home desktop"); got != taken+" 2" {
		t.Fatalf("a folder with the person's things in it was chosen: %q", got)
	}
}

func TestMainOnlyRefusesOnASatellite(t *testing.T) {
	defer satelliteOn.Store(false)
	defer notMainName.Store("")
	called := false
	h := mainOnly(func(w http.ResponseWriter, r *http.Request) { called = true })
	satelliteOn.Store(true)
	notMainName.Store("Home desktop")
	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodPost, "/api/library/trash", nil))
	if called || rec.Code != http.StatusConflict {
		t.Fatalf("a satellite changed the library: called=%v code=%d", called, rec.Code)
	}
	satelliteOn.Store(false)
	notMainName.Store("")
	h(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/api/library/trash", nil))
	if !called {
		t.Fatal("the main computer was refused")
	}
}
