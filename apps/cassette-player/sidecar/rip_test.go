package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	flacvorbis "github.com/go-flac/flacvorbis/v2"
	flac "github.com/go-flac/go-flac/v2"
)

// Validates the cd-paranoia -Q parser AND the +150 offset convention together,
// against MusicBrainz ground truth: build a -Q table whose begin sectors are
// (fixture MB offset − 150); parsing it back must reproduce the exact fixture
// Disc ID. This collapses most of the disc-pending risk — only the literal
// drive read of begin/length numbers stays unverified until a disc is present.
func TestParseParanoiaTOC_MatchesFixture(t *testing.T) {
	offs := fixtureTOC.TrackOffsets
	leadoutBegin := fixtureTOC.LeadoutOffset - leadInFrames
	var b strings.Builder
	b.WriteString("track        length               begin        copy pre ch\n")
	b.WriteString("===========================================================\n")
	for i, off := range offs {
		begin := off - leadInFrames
		end := leadoutBegin
		if i+1 < len(offs) {
			end = offs[i+1] - leadInFrames
		}
		fmt.Fprintf(&b, "%3d. %8d [00:00.00] %8d [00:00.00]    no   no  2\n", i+1, end-begin, begin)
	}
	toc, _, err := parseParanoiaTOC(b.String())
	if err != nil {
		t.Fatal(err)
	}
	if toc.FirstTrack != 1 || toc.LastTrack != 12 {
		t.Fatalf("track range %d..%d, want 1..12", toc.FirstTrack, toc.LastTrack)
	}
	id, err := toc.DiscID()
	if err != nil {
		t.Fatal(err)
	}
	if id != fixtureDiscID {
		t.Fatalf("parsed-TOC Disc ID = %s, want %s (parser or +150 convention wrong)", id, fixtureDiscID)
	}
	t.Logf("cd-paranoia parser + offset convention validated vs MB ground truth: %s", id)
}

// BUG-252: a NUL byte (the realistic vector is a MusicBrainz title decoded
// from a NUL Unicode escape sequence in a JSON string, but any NUL works)
// must never reach a filename - it's illegal in a POSIX path and would fail
// the track's land step outright.
func TestSanitizeFilenameStripsNulByte(t *testing.T) {
	got := sanitizeFilename("Kid A\x00 (Bonus)")
	if strings.ContainsRune(got, 0) {
		t.Fatalf("sanitizeFilename left a NUL byte in %q", got)
	}
	if want := "Kid A (Bonus)"; got != want {
		t.Errorf("sanitizeFilename(%q) = %q, want %q", "Kid A\x00 (Bonus)", got, want)
	}
}

// Every other C0 control character (tab, newline, ESC, ...) and DEL should be
// stripped the same way, not just NUL specifically.
func TestSanitizeFilenameStripsOtherControlChars(t *testing.T) {
	in := "A\x01B\tC\nD\x1bE\x7fF"
	got := sanitizeFilename(in)
	if want := "ABCDEF"; got != want {
		t.Errorf("sanitizeFilename(%q) = %q, want %q", in, got, want)
	}
}

// The existing illegal-character handling (the reason this sanitizer exists
// in the first place) must be unaffected by the new control-char stripping.
func TestSanitizeFilenamePreservesExistingBehavior(t *testing.T) {
	got := sanitizeFilename(`AC/DC: Live?`)
	if want := "AC-DC- Live"; got != want {
		t.Errorf("sanitizeFilename(%q) = %q, want %q", `AC/DC: Live?`, got, want)
	}
}

// BUG-245: on Windows an artist or album folder never takes a device name (CON, NUL, COM1, ...), which
// Windows can't make; anywhere else the name is left as it was, so folders already ripped stay put.
func TestFolderNameAvoidsWindowsDeviceNames(t *testing.T) {
	was := guardWindowsNames
	defer func() { guardWindowsNames = was }()

	guardWindowsNames = true
	for in, want := range map[string]string{
		"Con":          "Con_",
		"NUL":          "NUL_",
		"aux.":         "aux_", // trailing dot trimmed first, then it's AUX
		"Nul.Live":     "Nul_.Live",
		"COM1":         "COM1_",
		"lpt9":         "lpt9_",
		"COM¹":         "COM¹_",
		"CONOUT$":      "CONOUT$_",
		"PRN .2":       "PRN_.2",
		"Conor Oberst": "Conor Oberst",
		"COM10":        "COM10",
		"Nullsleep":    "Nullsleep",
		"The Aux":      "The Aux",
		"COMA":         "COMA",
		"":             "",
	} {
		if got := folderName(in); got != want {
			t.Errorf("Windows: folderName(%q) = %q, want %q", in, got, want)
		}
	}
	rel := &MatchedRelease{AlbumArtist: "Con", Album: "Nul"}
	if got, want := albumDir(rel), filepath.Join(sidecarMusicDir, "Con_", "Nul_"); got != want {
		t.Errorf("Windows: albumDir = %q, want %q", got, want)
	}
	// a song's own name is never a device name ("01 - CON.flac"), so titles are left alone
	if got := filepath.Base(landedPath("/x", nil, RippedTrackMeta{Position: 1, Title: "CON"})); got != "01 - CON.flac" {
		t.Errorf("Windows: landedPath = %q, want 01 - CON.flac", got)
	}

	guardWindowsNames = false
	if got := folderName("Con"); got != "Con" {
		t.Errorf("macOS/Linux: folderName(Con) = %q, want it unchanged", got)
	}
}

// Gate (b): a sample WAV through encode → verify → tag → land, with tag readback.
func TestEncodeTagLand(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not on PATH")
	}
	if _, err := exec.LookPath("flac"); err != nil {
		t.Skip("flac not on PATH")
	}
	tmp := t.TempDir()
	wav := filepath.Join(tmp, "in.wav")
	if out, err := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi",
		"-i", "sine=frequency=440:duration=1", "-ac", "2", "-ar", "44100", wav).CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg synth: %v %s", err, out)
	}

	rel := &MatchedRelease{
		ReleaseMBID: "rel-mbid-abc", Album: "Gate B Album", AlbumArtist: "Gate B Artist",
		Date: "2026", DiscID: "disc-xyz", TrackCount: 1,
	}
	tr := RippedTrackMeta{Position: 1, Title: "Sample/Track: One", Artist: "Gate B Artist", RecordingMBID: "rec-mbid-123"}

	dest := filepath.Join(tmp, "music")
	if err := os.MkdirAll(dest, 0o755); err != nil {
		t.Fatal(err)
	}
	final, err := encodeTagLand(wav, rel, tr, dest)
	if err != nil {
		t.Fatal(err)
	}
	if base := filepath.Base(final); base != "01 - Sample-Track- One.flac" {
		t.Errorf("landed filename = %q", base)
	}
	if _, err := os.Stat(final); err != nil {
		t.Fatalf("landed file missing: %v", err)
	}
	if out, err := exec.Command("flac", "-t", "-s", final).CombinedOutput(); err != nil {
		t.Errorf("flac verify failed: %v %s", err, out)
	}

	tags := readFlacTags(t, final)
	want := map[string]string{
		"TITLE": "Sample/Track: One", "ARTIST": "Gate B Artist", "ALBUM": "Gate B Album",
		"ALBUMARTIST": "Gate B Artist", "TRACKNUMBER": "1", "DATE": "2026",
		"MUSICBRAINZ_TRACKID": "rec-mbid-123", "MUSICBRAINZ_ALBUMID": "rel-mbid-abc",
	}
	for k, v := range want {
		if tags[k] != v {
			t.Errorf("tag %s = %q, want %q", k, tags[k], v)
		}
	}
	t.Logf("encode→verify→tag→land OK: %s", final)
	t.Logf("tags: %v", tags)
}

func readFlacTags(t *testing.T, path string) map[string]string {
	f, err := flac.ParseFile(path)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	for _, blk := range f.Meta {
		if blk.Type != flac.VorbisComment {
			continue
		}
		c, err := flacvorbis.ParseFromMetaDataBlock(*blk)
		if err != nil {
			continue
		}
		for _, e := range c.Comments {
			if i := strings.IndexByte(e, '='); i > 0 {
				out[strings.ToUpper(e[:i])] = e[i+1:]
			}
		}
	}
	return out
}
