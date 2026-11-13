package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/bogem/id3v2/v2"
)

// writeArtistMP3 writes a song whose track artist tag is artist.
func writeArtistMP3(t *testing.T, path, artist string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	tag := id3v2.NewEmptyTag()
	tag.SetVersion(4)
	tag.SetTitle("Song")
	tag.SetArtist(artist)
	if _, err := tag.WriteTo(&buf); err != nil {
		t.Fatal(err)
	}
	buf.Write(mp3Audio)
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}

func inMusicRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	prev := sidecarMusicDir
	sidecarMusicDir = root
	artistFolderVerdictMu.Lock()
	artistFolderVerdicts = map[string]artistFolderVerdict{}
	artistFolderVerdictMu.Unlock()
	t.Cleanup(func() { sidecarMusicDir = prev })
	return root
}

// TestSharedFolderIsNotAnArtistFolder (BUG-553): a folder two levels up that holds albums by different artists is a
// grouping folder, so each artist's photo goes in their own album folder, never in the shared one.
func TestSharedFolderIsNotAnArtistFolder(t *testing.T) {
	root := inMusicRoot(t)
	fun := filepath.Join(root, "Indie", "Some Nights")
	eyes := filepath.Join(root, "Indie", "I'm Wide Awake, It's Morning")
	writeArtistMP3(t, filepath.Join(fun, "01.mp3"), "fun.")
	writeArtistMP3(t, filepath.Join(eyes, "01.mp3"), "Bright Eyes")

	if got, err := artistDirForPath(filepath.Join(fun, "01.mp3")); err != nil || got != fun {
		t.Errorf("fun.: got %q, %v; want its own album folder %q", got, err, fun)
	}
	if got, err := artistDirForPath(filepath.Join(eyes, "01.mp3")); err != nil || got != eyes {
		t.Errorf("Bright Eyes: got %q, %v; want its own album folder %q", got, err, eyes)
	}
}

// A real artist folder stays one, however the credits on its albums are written.
func TestOneArtistsFolderStaysTheArtistFolder(t *testing.T) {
	root := inMusicRoot(t)
	artist := filepath.Join(root, "Taylor Swift")
	writeArtistMP3(t, filepath.Join(artist, "Fearless", "01.mp3"), "Taylor Swift")
	writeArtistMP3(t, filepath.Join(artist, "Red", "01.mp3"), "Taylor Swift feat. Ed Sheeran")
	writeArtistMP3(t, filepath.Join(artist, "1989", "01.mp3"), "The Taylor Swift")
	writeArtistMP3(t, filepath.Join(artist, "Now 50", "01.mp3"), "Various Artists")

	for _, album := range []string{"Fearless", "Red", "1989", "Now 50"} {
		if got, err := artistDirForPath(filepath.Join(artist, album, "01.mp3")); err != nil || got != artist {
			t.Errorf("%s: got %q, %v; want the artist folder %q", album, got, err, artist)
		}
	}
}

// Disc folders inside an album do not make the album folder look shared.
func TestDiscFoldersKeepTheAlbumFolder(t *testing.T) {
	root := inMusicRoot(t)
	album := filepath.Join(root, "Artist", "Album")
	writeArtistMP3(t, filepath.Join(album, "Disc 1", "01.mp3"), "Artist")
	writeArtistMP3(t, filepath.Join(album, "Disc 2", "01.mp3"), "Artist")
	// {music}/{Artist}/{Album}/Disc 1/track: two levels up is the album folder, as before.
	if got, err := artistDirForPath(filepath.Join(album, "Disc 1", "01.mp3")); err != nil || got != album {
		t.Errorf("disc layout: got %q, %v; want %q", got, err, album)
	}
}

// With nothing to compare (one album, or tags that cannot be read) the folder stays an artist folder, as it was.
func TestNothingToCompareKeepsTheArtistFolder(t *testing.T) {
	root := inMusicRoot(t)
	artist := filepath.Join(root, "Artist")
	writeArtistMP3(t, filepath.Join(artist, "Only Album", "01.mp3"), "Artist")
	if got, err := artistDirForPath(filepath.Join(artist, "Only Album", "01.mp3")); err != nil || got != artist {
		t.Errorf("one album: got %q, %v; want %q", got, err, artist)
	}

	noTags := filepath.Join(root, "Mystery")
	for _, a := range []string{"One", "Two"} {
		if err := os.MkdirAll(filepath.Join(noTags, a), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(noTags, a, "01.mp3"), mp3Audio, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if got, err := artistDirForPath(filepath.Join(noTags, "One", "01.mp3")); err != nil || got != noTags {
		t.Errorf("untagged: got %q, %v; want %q", got, err, noTags)
	}
}

func TestPrimaryArtistKey(t *testing.T) {
	for in, want := range map[string]string{
		"Taylor Swift feat. Ed Sheeran": "taylor swift",
		"The Beatles":                   "beatles",
		"Simon & Garfunkel":             "simon",
		"fun.":                          "fun",
		"  Bright   Eyes ":              "bright eyes",
		"":                              "",
	} {
		if got := primaryArtistKey(in); got != want {
			t.Errorf("primaryArtistKey(%q) = %q, want %q", in, got, want)
		}
	}
	if !sameArtistKey("fun", "fun some nights") || sameArtistKey("fun", "funky") || sameArtistKey("bright eyes", "fun") {
		t.Error("sameArtistKey: a credit matches itself or one that opens with it as whole words, nothing else")
	}
}
