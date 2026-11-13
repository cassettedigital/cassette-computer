package main

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func mp4Box(typ string, body ...[]byte) []byte {
	n := 8
	for _, b := range body {
		n += len(b)
	}
	out := make([]byte, 8, n)
	binary.BigEndian.PutUint32(out[:4], uint32(n))
	copy(out[4:8], typ)
	for _, b := range body {
		out = append(out, b...)
	}
	return out
}

func mp4Text(typ, s string) []byte {
	return mp4Box(typ, mp4Box("data", []byte{0, 0, 0, 1, 0, 0, 0, 0}, []byte(s)))
}

func mp4Freeform(name, value string) []byte {
	return mp4Box("----",
		mp4Box("mean", []byte{0, 0, 0, 0}, []byte(mp4FreeformMean)),
		mp4Box("name", []byte{0, 0, 0, 0}, []byte(name)),
		mp4Box("data", []byte{0, 0, 0, 1, 0, 0, 0, 0}, []byte(value)),
	)
}

// buildM4A assembles a minimal iTunes-style file: ftyp, mdat BEFORE moov (so the
// reader has to seek past audio), mvhd v0 at 44.1k timescale, ISO full-box meta.
func buildM4A(withMBID bool) []byte {
	mvhd := make([]byte, 100)
	binary.BigEndian.PutUint32(mvhd[12:16], 44100)
	binary.BigEndian.PutUint32(mvhd[16:20], 44100*215+1234) // 215.03s
	items := [][]byte{
		mp4Text("\xa9nam", "Re: Stacks"),
		mp4Text("\xa9ART", "Bon Iver"),
		mp4Text("\xa9alb", "For Emma, Forever Ago"),
		mp4Freeform("iTunNORM", "ignored"),
	}
	if withMBID {
		items = append(items, mp4Freeform("MusicBrainz Track Id", "0c3dbd4e-2b5c-4c1f-9b1a-8b8f6c7e0a11"))
	}
	ilst := mp4Box("ilst", items...)
	meta := mp4Box("meta", []byte{0, 0, 0, 0}, mp4Box("hdlr", make([]byte, 25)), ilst)
	moov := mp4Box("moov", mp4Box("mvhd", mvhd), mp4Box("udta", meta))
	var out []byte
	out = append(out, mp4Box("ftyp", []byte("M4A "), []byte{0, 0, 0, 0}, []byte("M4A mp42isom"))...)
	out = append(out, mp4Box("mdat", make([]byte, 4096))...)
	out = append(out, moov...)
	return out
}

func writeTemp(t *testing.T, name string, data []byte) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(p, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestReadM4ATags(t *testing.T) {
	p := writeTemp(t, "03 - Re- Stacks.m4a", buildM4A(true))
	tags, err := readTags(p)
	if err != nil {
		t.Fatalf("readTags: %v", err)
	}
	if tags.Title != "Re: Stacks" || tags.Artist != "Bon Iver" || tags.Album != "For Emma, Forever Ago" {
		t.Errorf("text tags = %+v", tags)
	}
	if tags.DurationSeconds != 215 {
		t.Errorf("duration = %d, want 215", tags.DurationSeconds)
	}
	if tags.MBID != "0c3dbd4e-2b5c-4c1f-9b1a-8b8f6c7e0a11" {
		t.Errorf("MBID = %q (the iTunNORM freeform must not be mistaken for it)", tags.MBID)
	}

	plain, err := readTags(writeTemp(t, "plain.m4a", buildM4A(false)))
	if err != nil || plain.MBID != "" || plain.Title != "Re: Stacks" {
		t.Errorf("untagged-MBID file = (%+v, %v)", plain, err)
	}
}

func TestReadM4ATags_NeverWrites(t *testing.T) {
	p := writeTemp(t, "a.m4a", buildM4A(false))
	before, _ := os.ReadFile(p)
	fi0, _ := os.Stat(p)
	if _, err := readTags(p); err != nil {
		t.Fatal(err)
	}
	if err := writeMBIDTag(p, "0c3dbd4e-2b5c-4c1f-9b1a-8b8f6c7e0a11"); err != errUnsupportedFormat {
		t.Errorf("writeMBIDTag on m4a = %v, want errUnsupportedFormat", err)
	}
	after, _ := os.ReadFile(p)
	fi1, _ := os.Stat(p)
	if string(before) != string(after) || !fi0.ModTime().Equal(fi1.ModTime()) {
		t.Error("the m4a file changed")
	}
}

func TestReadM4ATags_Malformed(t *testing.T) {
	cases := map[string][]byte{
		"empty":       {},
		"not mp4":     []byte("fLaC and some more bytes"),
		"no moov":     mp4Box("ftyp", []byte("M4A ")),
		"huge size":   {0xFF, 0xFF, 0xFF, 0xFF, 'm', 'o', 'o', 'v'},
		"cut-off box": mp4Box("moov", mp4Box("mvhd", make([]byte, 100)))[:40],
	}
	for name, data := range cases {
		if _, err := readTags(writeTemp(t, "x.m4a", data)); err == nil && name != "cut-off box" {
			t.Errorf("%s: want an error, got nil", name)
		}
	}
}

func TestLibraryAudioClasses(t *testing.T) {
	for p, want := range map[string][3]bool{ // supported(writable), readOnly, library
		"a/b.flac": {true, false, true},
		"a/b.MP3":  {true, false, true},
		"a/b.m4a":  {false, true, true},
		"a/b.aac":  {false, true, true},
		"a/b.m4p":  {false, false, false},
		"a/b.wav":  {false, false, false},
	} {
		got := [3]bool{isSupportedAudio(p), isReadOnlyAudio(p), isLibraryAudio(p)}
		if got != want {
			t.Errorf("%s: (writable, readOnly, library) = %v, want %v", p, got, want)
		}
	}
}

func TestAttachHeldMBIDs(t *testing.T) {
	dir := t.TempDir()
	m4a := filepath.Join(dir, "a.m4a")
	stale := filepath.Join(dir, "b.m4a")
	flacPath := filepath.Join(dir, "c.flac")
	for _, p := range []string{m4a, stale, flacPath} {
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	mtime := func(p string) time.Time { fi, _ := os.Stat(p); return fi.ModTime() }
	state := &SidecarState{MBIDResolutionState: map[string]*MBIDFileState{
		m4a:      {Resolved: true, MBID: "held-a", FileModifiedAt: mtime(m4a)},
		stale:    {Resolved: true, MBID: "held-b", FileModifiedAt: mtime(stale).Add(-time.Hour)},
		flacPath: {Resolved: true, MBID: "held-c", FileModifiedAt: mtime(flacPath)},
	}}
	own := "from-tag"
	tracks := []librarySyncTrack{
		{Path: m4a},
		{Path: stale},
		{Path: flacPath},
		{Path: m4a, MusicBrainzRecordingID: &own},
	}
	attachHeldMBIDs(tracks, state)

	get := func(i int) string {
		if tracks[i].MusicBrainzRecordingID == nil {
			return ""
		}
		return *tracks[i].MusicBrainzRecordingID
	}
	if get(0) != "held-a" {
		t.Errorf("unchanged m4a: got %q, want held-a", get(0))
	}
	if get(1) != "" {
		t.Errorf("m4a changed since the match: got %q, want nothing", get(1))
	}
	if get(2) != "" {
		t.Errorf("flac must rely on its own tag: got %q", get(2))
	}
	if get(3) != "from-tag" {
		t.Errorf("a tag in the file must win: got %q", get(3))
	}
	attachHeldMBIDs(tracks, nil) // nil state is a no-op
}
