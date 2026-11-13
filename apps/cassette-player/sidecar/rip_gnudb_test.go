package main

import (
	"reflect"
	"testing"
)

func TestCddbSum(t *testing.T) {
	cases := map[int]int{0: 0, 2: 2, 102: 3, 12345: 15, 999: 27}
	for in, want := range cases {
		if got := cddbSum(in); got != want {
			t.Errorf("cddbSum(%d) = %d, want %d", in, got, want)
		}
	}
}

// Hand-verified freedb disc ID for a 2-track TOC:
//   t1 @150f → 2s (digitsum 2); t2 @7650f → 102s (digitsum 3); checksum=5.
//   total = 15150/75 − 150/75 = 202 − 2 = 200s; ntracks=2.
//   id = (5<<24)|(200<<8)|2 = 0x0500c802.
func TestFreedbDiscID(t *testing.T) {
	toc := &TOC{FirstTrack: 1, LastTrack: 2, TrackOffsets: []int{150, 7650}, LeadoutOffset: 15150}
	if got := freedbDiscIDHex(toc); got != "0500c802" {
		t.Fatalf("freedbDiscIDHex = %s, want 0500c802", got)
	}
	if got := cddbQueryArgs(toc); got != "0500c802 2 150 7650 202" {
		t.Errorf("cddbQueryArgs = %q, want %q", got, "0500c802 2 150 7650 202")
	}
}

// A real TOC produces a stable, well-formed 8-hex id (regression guard).
func TestFreedbDiscID_Fixture(t *testing.T) {
	toc := fixtureTOC
	id := freedbDiscIDHex(&toc)
	if len(id) != 8 {
		t.Fatalf("freedb id %q is not 8 hex chars", id)
	}
	// freedb encodes ntracks (12) in the low byte.
	if id[6:] != "0c" {
		t.Errorf("low byte = %s, want 0c (12 tracks)", id[6:])
	}
}

func TestParseGnudbQuery_ExactSingle(t *testing.T) {
	got := parseGnudbQuery("200 rock abcd1234 Eve 6 / It's All in Your Head\n")
	want := []gnudbMatch{{category: "rock", discID: "abcd1234", dtitle: "Eve 6 / It's All in Your Head", exact: true}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

func TestParseGnudbQuery_InexactMultiple(t *testing.T) {
	resp := "211 close matches found\n" +
		"rock abcd1234 Artist A / Album A\n" +
		"misc deadbeef Artist B / Album B\n" +
		".\n"
	got := parseGnudbQuery(resp)
	if len(got) != 2 {
		t.Fatalf("got %d matches, want 2", len(got))
	}
	if got[0].exact || got[1].exact {
		t.Errorf("211 matches must be inexact")
	}
	if got[1].category != "misc" || got[1].discID != "deadbeef" {
		t.Errorf("second match = %+v", got[1])
	}
}

func TestParseGnudbQuery_NoMatch(t *testing.T) {
	if got := parseGnudbQuery("202 no match\n"); got != nil {
		t.Errorf("202 should yield no matches, got %+v", got)
	}
}

func TestParseGnudbRead(t *testing.T) {
	resp := "# xmcd CD database file\n" +
		"#\n" +
		"DISCID=0500c802\n" +
		"DTITLE=Eve 6 / It's All in Your Head\n" +
		"DYEAR=2003\n" +
		"TTITLE0=Without You Here\n" +
		"TTITLE1=Think Twice\n" +
		"TTITLE2=At Least We're Dreaming\n" +
		".\n"
	e := parseGnudbRead(resp)
	if e.artist != "Eve 6" {
		t.Errorf("artist = %q, want Eve 6", e.artist)
	}
	if e.album != "It's All in Your Head" {
		t.Errorf("album = %q, want It's All in Your Head", e.album)
	}
	if e.year != "2003" {
		t.Errorf("year = %q, want 2003", e.year)
	}
	want := []string{"Without You Here", "Think Twice", "At Least We're Dreaming"}
	if !reflect.DeepEqual(e.titles, want) {
		t.Errorf("titles = %v, want %v", e.titles, want)
	}
}

// gnudb wraps long DTITLE/TTITLE values across multiple lines with the same key;
// the parser must concatenate them in order.
func TestParseGnudbRead_WrappedValues(t *testing.T) {
	resp := "DTITLE=Some Very Long Artist Name / The Exceptionally Lo\n" +
		"DTITLE=ng Album Title That Wrapped\n" +
		"TTITLE0=A track whose title also kept go\n" +
		"TTITLE0=ing past the line limit\n" +
		".\n"
	e := parseGnudbRead(resp)
	if e.artist != "Some Very Long Artist Name" {
		t.Errorf("artist = %q", e.artist)
	}
	if e.album != "The Exceptionally Long Album Title That Wrapped" {
		t.Errorf("album = %q", e.album)
	}
	if len(e.titles) != 1 || e.titles[0] != "A track whose title also kept going past the line limit" {
		t.Errorf("titles = %v", e.titles)
	}
}

// A gnudb hit with a matching track count clears the auto-select threshold;
// a wrong track count is disqualified by the scorer's hard gate.
func TestGnudbConfidence(t *testing.T) {
	toc := fixtureTOC
	tocDur := tocTrackDurationsMs(&toc)

	good := &MatchedRelease{Album: "OK Computer", AlbumArtist: "Radiohead", TrackCount: len(tocDur)}
	for i, d := range tocDur {
		good.Tracks = append(good.Tracks, RippedTrackMeta{Position: i + 1, Title: "t", LengthMs: d})
	}
	if c := gnudbConfidence(gnudbHit{release: good, exact: true}, tocDur); c < confidenceAutoSelect {
		t.Errorf("exact gnudb hit confidence = %.3f, want ≥ %.2f (auto-select)", c, confidenceAutoSelect)
	}
	if c := gnudbConfidence(gnudbHit{release: good, exact: false}, tocDur); c >= confidenceAutoSelect || c <= 0 {
		t.Errorf("inexact gnudb hit confidence = %.3f, want in the confirm band (0, %.2f)", c, confidenceAutoSelect)
	}

	wrongCount := &MatchedRelease{Album: "X", TrackCount: 2,
		Tracks: []RippedTrackMeta{{Position: 1, LengthMs: 1000}, {Position: 2, LengthMs: 1000}}}
	if c := gnudbConfidence(gnudbHit{release: wrongCount, exact: true}, tocDur); c != 0 {
		t.Errorf("track-count mismatch confidence = %.3f, want 0 (hard gate)", c)
	}
}
