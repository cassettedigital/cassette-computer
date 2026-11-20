package main

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPathInsideLibrary(t *testing.T) {
	base := t.TempDir()
	music := filepath.Join(base, "Music")
	outside := filepath.Join(base, "Elsewhere")
	sibling := filepath.Join(base, "Music-extra")
	for _, d := range []string{filepath.Join(music, "Artist", "Album"), outside, sibling} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	write := func(p string) string {
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		return p
	}
	song := write(filepath.Join(music, "Artist", "Album", "01 Song.mp3"))
	loose := write(filepath.Join(music, "Loose.mp3"))
	away := write(filepath.Join(outside, "Away.mp3"))
	next := write(filepath.Join(sibling, "Next.mp3"))

	ok := []string{
		song,
		loose,
		filepath.Join(music, "Artist", "..", "Artist", "Album", "01 Song.mp3"),
	}
	for _, p := range ok {
		real, realDir, err := pathInsideLibrary(p, music)
		if err != nil {
			t.Errorf("pathInsideLibrary(%q) refused: %v", p, err)
			continue
		}
		if !strings.HasPrefix(real, realDir+string(filepath.Separator)) {
			t.Errorf("pathInsideLibrary(%q) = %q, not under %q", p, real, realDir)
		}
	}

	refused := []string{
		away, // outside the folder
		next, // a sibling whose name starts the same way
		filepath.Join(music, "..", "Elsewhere", "Away.mp3"), // a ../ climb out
		filepath.Join(music, "Artist", "..", "..", "Elsewhere", "Away.mp3"),
		music, // the folder itself is not a song in it
		filepath.Join(music, "Artist", "Album", "Missing.mp3"), // not there
	}

	// A link inside the folder that points out of it, and a linked folder inside
	// that leads out. Skipped where links cannot be made (Windows without rights).
	linkOut := filepath.Join(music, "Artist", "Album", "02 Link.mp3")
	dirOut := filepath.Join(music, "Linked")
	if err := os.Symlink(away, linkOut); err == nil {
		refused = append(refused, linkOut)
		if err := os.Symlink(outside, dirOut); err == nil {
			refused = append(refused, filepath.Join(dirOut, "Away.mp3"))
		}
		// A link that stays inside is fine.
		linkIn := filepath.Join(music, "Artist", "Album", "03 Link.mp3")
		if err := os.Symlink(song, linkIn); err == nil {
			if _, _, err := pathInsideLibrary(linkIn, music); err != nil {
				t.Errorf("link to a song inside was refused: %v", err)
			}
		}
	} else {
		t.Logf("no symlinks here (%v); skipping the link cases", err)
	}

	for _, p := range refused {
		if real, _, err := pathInsideLibrary(p, music); err == nil {
			t.Errorf("pathInsideLibrary(%q) = %q, want refused", p, real)
		}
	}

	// A music folder reached through a link still holds its songs.
	linkedMusic := filepath.Join(base, "MusicLink")
	if err := os.Symlink(music, linkedMusic); err == nil {
		if _, _, err := pathInsideLibrary(filepath.Join(linkedMusic, "Loose.mp3"), linkedMusic); err != nil {
			t.Errorf("song in a linked music folder refused: %v", err)
		}
		if _, _, err := pathInsideLibrary(song, linkedMusic); err != nil {
			t.Errorf("song named by its real path, music folder by its link, refused: %v", err)
		}
	}

	if _, _, err := pathInsideLibrary(song, ""); !errors.Is(err, errNotInLibrary) {
		t.Errorf("no music folder: err = %v, want errNotInLibrary", err)
	}
}

func TestRevealTarget(t *testing.T) {
	music := filepath.Join(string(filepath.Separator)+"m", "Music")
	song := filepath.Join(music, "Artist", "Album", "01 Song.mp3")
	loose := filepath.Join(music, "Loose.mp3")
	cases := []struct{ file, what, want string }{
		{song, "song", song},
		{song, "record", filepath.Dir(song)},
		{loose, "song", loose},
		{loose, "record", loose}, // the record's folder would be the music folder itself
	}
	for _, c := range cases {
		if got := revealTarget(c.file, music, c.what); got != c.want {
			t.Errorf("revealTarget(%q, %q) = %q, want %q", c.file, c.what, got, c.want)
		}
	}
}

func TestLibraryRevealRefusesBadRequests(t *testing.T) {
	cases := []struct {
		method, body string
		status       int
	}{
		{http.MethodGet, "", http.StatusMethodNotAllowed},
		{http.MethodPost, "{not json", http.StatusBadRequest},
		{http.MethodPost, `{"songId":"abc","what":"album"}`, http.StatusBadRequest},
		{http.MethodPost, `{"songId":"a b"}`, http.StatusBadRequest},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		handleLibraryReveal(rec, httptest.NewRequest(c.method, "/api/library/reveal", strings.NewReader(c.body)))
		if rec.Code != c.status {
			t.Errorf("%s %q: status %d, want %d (%s)", c.method, c.body, rec.Code, c.status, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), `"ok":false`) {
			t.Errorf("%s %q: body %s, want ok false", c.method, c.body, rec.Body.String())
		}
	}
}
