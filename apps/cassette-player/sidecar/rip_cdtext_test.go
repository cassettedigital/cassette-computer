package main

import "testing"

// A representative cd-info dump: a CD-TEXT block (disc + two tracks) wrapped in
// the other column-0 sections cd-info prints. Validates that we pull artist/
// album/track titles AND that stray "Key: value" lines from other sections
// (which are NOT indented under a CD-TEXT header) never leak in.
const sampleCDInfo = `CD-ROM Track List (1 - 12)
  #:  MSF       LSN    Type   Green?
CD-TEXT for Disc:
	TITLE: OK Computer
	PERFORMER: Radiohead
CD-TEXT for Track  1:
	TITLE: Airbag
	PERFORMER: Radiohead
CD-TEXT for Track  2:
	TITLE: Paranoid Android
	PERFORMER: Radiohead
Disc mode: CD-DA
Media Catalog Number (MCN): 0000000000000
`

func TestParseCDText(t *testing.T) {
	ct := parseCDText(sampleCDInfo)
	if !ct.HasAny() {
		t.Fatal("expected CD-TEXT to be detected")
	}
	if ct.Album != "OK Computer" {
		t.Errorf("disc title = %q, want %q", ct.Album, "OK Computer")
	}
	if ct.AlbumArtist != "Radiohead" {
		t.Errorf("disc performer = %q, want %q", ct.AlbumArtist, "Radiohead")
	}
	if got := ct.TitleFor(1); got != "Airbag" {
		t.Errorf("track 1 title = %q, want %q", got, "Airbag")
	}
	if got := ct.TitleFor(2); got != "Paranoid Android" {
		t.Errorf("track 2 title = %q, want %q", got, "Paranoid Android")
	}
	if got := ct.ArtistFor(1); got != "Radiohead" {
		t.Errorf("track 1 artist = %q, want %q", got, "Radiohead")
	}
	// The "Media Catalog Number (MCN): ..." line is at column 0 after the CD-TEXT
	// block, so it must NOT have been parsed as a track-3 field.
	if _, ok := ct.Tracks[3]; ok {
		t.Errorf("leaked a phantom track from a non-CD-TEXT line: %+v", ct.Tracks)
	}
}

func TestParseCDText_None(t *testing.T) {
	noText := `CD-ROM Track List (1 - 12)
  #:  MSF       LSN    Type   Green?
Disc mode: CD-DA
`
	ct := parseCDText(noText)
	if ct.HasAny() {
		t.Errorf("expected no CD-TEXT, got %+v", ct)
	}
	// nil-safe accessors on an empty (but non-nil) result.
	if ct.TitleFor(1) != "" || ct.ArtistFor(1) != "" {
		t.Errorf("expected empty accessors on text-less disc")
	}
}

func TestParseCDText_NilSafe(t *testing.T) {
	var ct *CDText
	if ct.HasAny() || ct.TitleFor(1) != "" || ct.ArtistFor(1) != "" {
		t.Errorf("nil CDText accessors should be empty/false")
	}
}

func TestFirstIntIn(t *testing.T) {
	cases := map[string]int{
		"CD-TEXT for Track  3:": 3,
		"CD-TEXT for Track 12:": 12,
		"CD-TEXT for Disc:":     0,
		"no digits here":        0,
	}
	for in, want := range cases {
		if got := firstIntIn(in); got != want {
			t.Errorf("firstIntIn(%q) = %d, want %d", in, got, want)
		}
	}
}
