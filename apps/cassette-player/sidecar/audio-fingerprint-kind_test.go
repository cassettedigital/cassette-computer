package main

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func flacFile(comment, audio string) []byte {
	var b bytes.Buffer
	b.WriteString("fLaC")
	b.Write([]byte{0x00, 0, 0, 34}) // STREAMINFO, not last
	b.Write(make([]byte, 34))
	b.Write([]byte{0x84, 0, 0, byte(len(comment))}) // VORBIS_COMMENT, last
	b.WriteString(comment)
	b.WriteString(audio)
	return b.Bytes()
}

func mp3File(tag, audio string) []byte {
	var b bytes.Buffer
	n := len(tag)
	b.Write([]byte{'I', 'D', '3', 3, 0, 0, byte(n >> 21 & 0x7f), byte(n >> 14 & 0x7f), byte(n >> 7 & 0x7f), byte(n & 0x7f)})
	b.WriteString(tag)
	b.WriteString(audio)
	v1 := make([]byte, 128)
	copy(v1, "TAG"+tag)
	b.Write(v1)
	return b.Bytes()
}

func box(kind string, body []byte) []byte {
	h := make([]byte, 8)
	binary.BigEndian.PutUint32(h, uint32(8+len(body)))
	copy(h[4:], kind)
	return append(h, body...)
}

func m4aFile(meta, audio string) []byte {
	var b bytes.Buffer
	b.Write(box("ftyp", []byte("M4A ")))
	b.Write(box("moov", []byte(meta)))
	b.Write(box("mdat", []byte(audio)))
	return b.Bytes()
}

func fingerprintOf(t *testing.T, name string, data []byte) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(p, data, 0o644); err != nil {
		t.Fatal(err)
	}
	fp, ok := hashTrackFile(p)
	if !ok {
		t.Fatalf("%s: no fingerprint", name)
	}
	return fp
}

// BUG-882: a tag edit (the hub's own MusicBrainz ID write) never reads as a changed song; a change to the music does.
func TestFingerprintMeasuresTheAudioAlone(t *testing.T) {
	cases := []struct {
		name  string
		make  func(tags, audio string) []byte
		tagsA string
		tagsB string
	}{
		{"song.flac", flacFile, "ARTIST=X", "ARTIST=X\nMUSICBRAINZ_TRACKID=abc-123-and-a-longer-tag"},
		{"song.mp3", mp3File, "TIT2 one", "TIT2 one, now with a much longer frame"},
		{"song.m4a", m4aFile, "udta old", "udta new and longer"},
	}
	for _, c := range cases {
		a := fingerprintOf(t, c.name, c.make(c.tagsA, "the music itself"))
		b := fingerprintOf(t, c.name, c.make(c.tagsB, "the music itself"))
		d := fingerprintOf(t, c.name, c.make(c.tagsA, "the music, re-ripped"))
		if !strings.HasPrefix(a, audioOnlyKind) {
			t.Fatalf("%s: %q isn't measured as audio only", c.name, a)
		}
		if a != b {
			t.Fatalf("%s: a tag edit changed the fingerprint (%s → %s)", c.name, a, b)
		}
		if a == d {
			t.Fatalf("%s: a change to the music left the fingerprint as it was", c.name)
		}
	}
}

func TestOtherFilesAreMeasuredWhole(t *testing.T) {
	if fp := fingerprintOf(t, "song.wav", []byte("RIFF....WAVE")); !strings.HasPrefix(fp, wholeFileKind) {
		t.Fatalf("wav = %q, want the whole-file kind", fp)
	}
	if fp := fingerprintOf(t, "broken.flac", []byte("not a flac at all")); !strings.HasPrefix(fp, wholeFileKind) {
		t.Fatalf("a FLAC that doesn't parse = %q, want the whole-file kind", fp)
	}
	if fingerprintKind("a1:3f9c") != "a1" || fingerprintKind("3f9c0011") != "" || fingerprintKind("f1:00") != "f1" {
		t.Fatal("fingerprintKind")
	}
}

// A fingerprint measured before kinds is measured again even though the file hasn't changed.
func TestOldFingerprintsAreMeasuredAgain(t *testing.T) {
	p := filepath.Join(t.TempDir(), "song.flac")
	if err := os.WriteFile(p, flacFile("ARTIST=X", "music"), 0o644); err != nil {
		t.Fatal(err)
	}
	fi, _ := os.Stat(p)
	state := &SidecarState{AudioObservations: map[string]trackObservation{
		"id1": {Fingerprint: "0123456789abcdef", Size: fi.Size(), ModTimeUnix: fi.ModTime().Unix(), HashedAtUnix: fi.ModTime().Unix()},
	}}
	tracks := []librarySyncTrack{{Path: p, CassetteLocalID: "id1"}}
	attachAudioFingerprints(tracks, state)
	if tracks[0].AudioFingerprint == nil || !strings.HasPrefix(*tracks[0].AudioFingerprint, audioOnlyKind) {
		t.Fatalf("got %v, want the old fingerprint measured again as audio only", tracks[0].AudioFingerprint)
	}
}
