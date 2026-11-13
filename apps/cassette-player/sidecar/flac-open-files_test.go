//go:build darwin || linux

package main

import (
	"os"
	"path/filepath"
	"runtime/debug"
	"testing"

	flac "github.com/go-flac/go-flac/v2"
)

// openFileCount is how many files this process holds open right now.
func openFileCount(t *testing.T) int {
	t.Helper()
	dir, err := os.Open("/dev/fd")
	if err != nil {
		t.Skipf("can't list open files here: %v", err)
	}
	defer dir.Close()
	names, err := dir.Readdirnames(-1) // names only: stat-ing /dev/fd's entries fails on macOS
	if err != nil {
		t.Skipf("can't list open files here: %v", err)
	}
	return len(names)
}

// BUG-869: readFLACTags and flacArt opened every FLAC they read with flac.ParseFile and never closed it, so a
// library scan held a file open per song until the garbage collector happened by. The collector is off for
// this test, so a leak shows up as one more open file per read.
func TestFLACReadersAndWritersCloseTheirFiles(t *testing.T) {
	dir := t.TempDir()
	song := filepath.Join(dir, "song.flac")
	writeTestFLAC(t, song, 0o644)

	// A FLAC with no tag block: updateFLACNames returns early on it.
	untagged := filepath.Join(dir, "untagged.flac")
	{
		si := flac.MetaDataBlock{Type: flac.StreamInfo, Data: make([]byte, 34)}
		f := &flac.File{Meta: []*flac.MetaDataBlock{&si}, Frames: nil}
		fh, err := os.Create(untagged)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.WriteTo(fh); err != nil {
			t.Fatal(err)
		}
		if _, err := fh.Write(flacAudio); err != nil {
			t.Fatal(err)
		}
		fh.Close()
	}

	// A file that starts like a FLAC and then breaks off: the parse fails after the file is open.
	broken := filepath.Join(dir, "broken.flac")
	if err := os.WriteFile(broken, []byte("fLaC\x00\x00"), 0o644); err != nil {
		t.Fatal(err)
	}

	defer debug.SetGCPercent(debug.SetGCPercent(-1))

	// The gauge itself: flac.ParseFile left unclosed does raise the count.
	base := openFileCount(t)
	var held []*flac.File
	for i := 0; i < 10; i++ {
		f, err := flac.ParseFile(song)
		if err != nil {
			t.Fatal(err)
		}
		held = append(held, f)
	}
	if got := openFileCount(t); got < base+10 {
		t.Fatalf("the open-file count doesn't see unclosed files (%d -> %d)", base, got)
	}
	for _, f := range held {
		f.Close()
	}

	before := openFileCount(t)
	const rounds = 25
	for i := 0; i < rounds; i++ {
		if tags, err := readFLACTags(song); err != nil || tags.Title != "Song" {
			t.Fatalf("readFLACTags = %+v, %v", tags, err)
		}
		flacArt(song)
		if _, err := readFLACTags(broken); err == nil {
			t.Fatal("a broken FLAC read without an error")
		}
		flacArt(broken)
		if _, err := parseFLACFile(broken); err == nil {
			t.Fatal("a broken FLAC parsed without an error")
		}
		if updateFLACNames(untagged, nameOverride{Album: "X"}, nil) {
			t.Fatal("updateFLACNames wrote a file with no tag block")
		}
	}
	if after := openFileCount(t); after > before+2 {
		t.Fatalf("FLAC reads left files open: %d before, %d after %d rounds", before, after, rounds)
	}
}
