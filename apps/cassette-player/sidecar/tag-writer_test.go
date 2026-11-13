package main

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/bogem/id3v2/v2"
	flacvorbis "github.com/go-flac/flacvorbis/v2"
	flac "github.com/go-flac/go-flac/v2"
)

// BUG-861: the MusicBrainz ID write must land without damaging the file it
// touches. These fixtures are written by hand (no ffmpeg): the writers only
// parse the tag, so a few bytes of stand-in audio after it are enough, and
// they let the test check the audio comes through byte for byte.

const testMBID = "0c3dbd4e-2b5c-4c1f-9b1a-8b8f6c7e0a11"

// flacAudio is stand-in FLAC audio: it starts with a frame sync code, which is
// all go-flac checks.
var flacAudio = append([]byte{0xFF, 0xF8}, bytes.Repeat([]byte("frames"), 500)...)

// mp3Audio is stand-in MPEG audio after the tag.
var mp3Audio = append([]byte{0xFF, 0xFB, 0x90, 0x00}, bytes.Repeat([]byte("mpeg"), 500)...)

func writeTestFLAC(t *testing.T, path string, mode os.FileMode) {
	t.Helper()
	si := flac.MetaDataBlock{Type: flac.StreamInfo, Data: make([]byte, 34)}
	cmt := flacvorbis.New()
	if err := cmt.Add("TITLE", "Song"); err != nil {
		t.Fatal(err)
	}
	if err := cmt.Add("ARTIST", "Band"); err != nil {
		t.Fatal(err)
	}
	vc := cmt.Marshal()
	f := &flac.File{Meta: []*flac.MetaDataBlock{&si, &vc}, Frames: bytes.NewReader(flacAudio)}
	var buf bytes.Buffer
	if _, err := f.WriteTo(&buf); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, buf.Bytes(), mode); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, mode); err != nil { // past the umask
		t.Fatal(err)
	}
}

// writeTestMP3 writes an MP3 whose tag is the given ID3v2 version (0: no tag).
func writeTestMP3(t *testing.T, path string, version byte, mode os.FileMode) {
	t.Helper()
	var buf bytes.Buffer
	if version != 0 {
		tag := id3v2.NewEmptyTag()
		tag.SetVersion(version)
		tag.SetTitle("Song")
		tag.SetArtist("Band")
		if version == 3 {
			tag.AddTextFrame("TYER", id3v2.EncodingISO, "1999")
		}
		tag.AddUserDefinedTextFrame(id3v2.UserDefinedTextFrame{Encoding: tag.DefaultEncoding(), Description: "Other", Value: "kept"})
		if _, err := tag.WriteTo(&buf); err != nil {
			t.Fatal(err)
		}
	}
	buf.Write(mp3Audio)
	if err := os.WriteFile(path, buf.Bytes(), mode); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, mode); err != nil {
		t.Fatal(err)
	}
}

func modeOf(t *testing.T, path string) os.FileMode {
	t.Helper()
	fi, err := os.Lstat(path)
	if err != nil {
		t.Fatal(err)
	}
	return fi.Mode()
}

func TestMBIDWriteFLACLandsAndKeepsMode(t *testing.T) {
	p := filepath.Join(t.TempDir(), "a.flac")
	writeTestFLAC(t, p, 0o640)
	if err := writeMBIDTag(p, testMBID); err != nil {
		t.Fatal(err)
	}
	tags, err := readTags(p)
	if err != nil {
		t.Fatal(err)
	}
	if tags.MBID != testMBID || tags.Title != "Song" || tags.Artist != "Band" {
		t.Fatalf("tags after write = %+v", tags)
	}
	if got := modeOf(t, p); got != 0o640 {
		t.Errorf("mode after write = %v, want -rw-r-----", got)
	}
	data, _ := os.ReadFile(p)
	if !bytes.HasSuffix(data, flacAudio) {
		t.Error("the audio after the metadata changed")
	}
	leftovers, _ := filepath.Glob(filepath.Join(filepath.Dir(p), "*.cassette.tmp.*"))
	if len(leftovers) != 0 {
		t.Errorf("temp files left behind: %v", leftovers)
	}
}

func TestMBIDWriteMP3KeepsVersionAndUsesAnEncodingItAllows(t *testing.T) {
	for _, version := range []byte{3, 4} {
		p := filepath.Join(t.TempDir(), "a.mp3")
		writeTestMP3(t, p, version, 0o600)
		if err := writeMBIDTag(p, testMBID); err != nil {
			t.Fatalf("v2.%d: %v", version, err)
		}
		tags, err := readTags(p)
		if err != nil {
			t.Fatal(err)
		}
		if tags.MBID != testMBID || tags.Title != "Song" || tags.Artist != "Band" {
			t.Fatalf("v2.%d: tags after write = %+v", version, tags)
		}
		tag, err := id3v2.Open(p, id3v2.Options{Parse: true})
		if err != nil {
			t.Fatal(err)
		}
		if tag.Version() != version {
			t.Errorf("v2.%d: the tag became v2.%d", version, tag.Version())
		}
		var ours, other int
		for _, fr := range tag.GetFrames("TXXX") {
			udf := fr.(id3v2.UserDefinedTextFrame)
			switch udf.Description {
			case id3MBIDDescription:
				ours++
				if version == 3 && udf.Encoding.Equals(id3v2.EncodingUTF8) {
					t.Error("v2.3: the MBID frame is UTF-8, which v2.3 does not have")
				}
			case "Other":
				other++
			}
		}
		if version == 3 && tag.GetTextFrame("TYER").Text != "1999" {
			t.Error("v2.3: the year frame was lost")
		}
		tag.Close()
		if ours != 1 || other != 1 {
			t.Errorf("v2.%d: MBID frames %d, other TXXX frames %d, want 1 and 1", version, ours, other)
		}
		data, _ := os.ReadFile(p)
		start, _ := mp3AudioStart(bytes.NewReader(data))
		if !bytes.Equal(data[start:], mp3Audio) {
			t.Errorf("v2.%d: the audio after the tag changed", version)
		}
		if got := modeOf(t, p); got != 0o600 {
			t.Errorf("v2.%d: mode after write = %v, want -rw-------", version, got)
		}
	}
}

func TestMBIDWriteMP3WithNoTag(t *testing.T) {
	p := filepath.Join(t.TempDir(), "a.mp3")
	writeTestMP3(t, p, 0, 0o644)
	if err := writeMBIDTag(p, testMBID); err != nil {
		t.Fatal(err)
	}
	tags, err := readTags(p)
	if err != nil || tags.MBID != testMBID {
		t.Fatalf("tags after write = %+v, %v", tags, err)
	}
	data, _ := os.ReadFile(p)
	start, _ := mp3AudioStart(bytes.NewReader(data))
	if start == 0 || !bytes.Equal(data[start:], mp3Audio) {
		t.Error("the audio must follow the new tag unchanged")
	}
}

func TestMP3AudioStartCountsTheFooter(t *testing.T) {
	h := []byte{'I', 'D', '3', 4, 0, 0x10, 0, 0, 0x01, 0x00} // 128 bytes of frames + footer
	if got, _ := mp3AudioStart(bytes.NewReader(h)); got != 10+128+10 {
		t.Errorf("v2.4 with footer: audio starts at %d, want 148", got)
	}
	h[3], h[5] = 3, 0
	if got, _ := mp3AudioStart(bytes.NewReader(h)); got != 10+128 {
		t.Errorf("v2.3: audio starts at %d, want 138", got)
	}
	if got, _ := mp3AudioStart(bytes.NewReader([]byte{0xFF, 0xFB})); got != 0 {
		t.Errorf("no tag: audio starts at %d, want 0", got)
	}
}

// A song set read-only is never rewritten: the write is refused before anything
// is read, and the resolver holds the match instead.
func TestMBIDWriteRefusesReadOnlySong(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("read-only is a file attribute there")
	}
	dir := t.TempDir()
	for _, name := range []string{"a.flac", "a.mp3"} {
		p := filepath.Join(dir, name)
		if name == "a.flac" {
			writeTestFLAC(t, p, 0o444)
		} else {
			writeTestMP3(t, p, 3, 0o444)
		}
		before, _ := os.ReadFile(p)
		fi0, _ := os.Stat(p)
		err := writeMBIDTag(p, testMBID)
		if !errors.Is(err, errSongHeld) {
			t.Fatalf("%s: write on a read-only song = %v, want errSongHeld", name, err)
		}
		after, _ := os.ReadFile(p)
		fi1, _ := os.Stat(p)
		if !bytes.Equal(before, after) || !fi0.ModTime().Equal(fi1.ModTime()) || fi1.Mode() != 0o444 {
			t.Errorf("%s: the read-only song changed", name)
		}
		if !matchHeldOnHubSide(p) {
			t.Errorf("%s: a read-only song's match must be held on the hub side", name)
		}
	}
}

// A linked song is never written, not through the link to the file it points
// at (which may be outside the music folder) and not by replacing the link.
func TestMBIDWriteRefusesLinkedSong(t *testing.T) {
	music, elsewhere := t.TempDir(), t.TempDir()
	for _, name := range []string{"a.flac", "a.mp3"} {
		target := filepath.Join(elsewhere, name)
		if name == "a.flac" {
			writeTestFLAC(t, target, 0o644)
		} else {
			writeTestMP3(t, target, 4, 0o644)
		}
		link := filepath.Join(music, name)
		if err := os.Symlink(target, link); err != nil {
			t.Skipf("no symlinks here: %v", err)
		}
		before, _ := os.ReadFile(target)
		if err := writeMBIDTag(link, testMBID); !errors.Is(err, errSongHeld) {
			t.Fatalf("%s: write through a link = %v, want errSongHeld", name, err)
		}
		if modeOf(t, link)&os.ModeSymlink == 0 {
			t.Errorf("%s: the link was replaced", name)
		}
		if after, _ := os.ReadFile(target); !bytes.Equal(before, after) {
			t.Errorf("%s: the file the link points at changed", name)
		}
		if !matchHeldOnHubSide(link) {
			t.Errorf("%s: a linked song's match must be held on the hub side", name)
		}
	}
	plain := filepath.Join(music, "plain.flac")
	writeTestFLAC(t, plain, 0o644)
	if matchHeldOnHubSide(plain) {
		t.Error("an ordinary FLAC carries its match in its own tag")
	}
}

// A held FLAC match reaches the library sync like an M4A's, dated by the song
// the link points at.
func TestAttachHeldMBIDsForLinkedAndReadOnlySongs(t *testing.T) {
	music, elsewhere := t.TempDir(), t.TempDir()
	ro := filepath.Join(music, "ro.flac")
	writeTestFLAC(t, ro, 0o444)
	target := filepath.Join(elsewhere, "t.flac")
	writeTestFLAC(t, target, 0o644)
	link := filepath.Join(music, "link.flac")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("no symlinks here: %v", err)
	}
	mtime := func(p string) time.Time { fi, _ := os.Stat(p); return fi.ModTime() }
	state := &SidecarState{MBIDResolutionState: map[string]*MBIDFileState{
		ro:   {Resolved: true, MBID: "held-ro", FileModifiedAt: mtime(ro)},
		link: {Resolved: true, MBID: "held-link", FileModifiedAt: mtime(link)},
	}}
	tracks := []librarySyncTrack{{Path: ro}, {Path: link}}
	attachHeldMBIDs(tracks, state)
	for i, want := range []string{"held-ro", "held-link"} {
		if tracks[i].MusicBrainzRecordingID == nil || *tracks[i].MusicBrainzRecordingID != want {
			t.Errorf("%s: held match not attached", tracks[i].Path)
		}
	}
}
