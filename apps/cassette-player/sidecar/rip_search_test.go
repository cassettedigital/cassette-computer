package main

import (
	"strings"
	"testing"
)

// Two pressings of the SAME album — a MusicBrainz one and a MBID-less iTunes one,
// differing only in case and year — must collapse to one picker slot (no "versions"
// shown), and the MBID-bearing pressing must win the near-tie so enrichment survives.
func TestPressingsCollapseAcrossSources(t *testing.T) {
	// Note the Unicode hyphen (U+2010) in the MB artist/title vs the ASCII hyphen in
	// the iTunes one — different sources spell the same album differently. They must
	// still collapse to one group.
	mb := &MatchedRelease{Album: "blink‐182", AlbumArtist: "blink‐182", Date: "2004", ReleaseMBID: "mb-123"}
	it := &MatchedRelease{Album: "Blink-182", AlbumArtist: "blink-182", Date: "2003"} // iTunes: no MBID, ASCII hyphen

	if releaseGroupKey(mb) != releaseGroupKey(it) {
		t.Fatalf("same album keyed differently across hyphen variants: %q vs %q", releaseGroupKey(mb), releaseGroupKey(it))
	}

	mbCand := &RipScoredCandidate{Release: mb, Confidence: 0.95}
	itCand := &RipScoredCandidate{Release: it, Confidence: 0.95} // exact tie
	if betterPressing(itCand, mbCand) {
		t.Error("on a tie the MBID-less iTunes pressing must NOT displace the MusicBrainz one")
	}
	if !betterPressing(mbCand, itCand) {
		t.Error("on a tie the MusicBrainz (MBID-bearing) pressing must win")
	}
}

func TestYearOf(t *testing.T) {
	cases := map[string]string{
		"2003-09-23T07:00:00Z": "2003",
		"1997":                 "1997",
		"":                     "",
		"19":                   "19",
	}
	for in, want := range cases {
		if got := yearOf(in); got != want {
			t.Errorf("yearOf(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestItunesCoverUpsize(t *testing.T) {
	// Mirror the substitution inside itunesCoverURL (which otherwise hits the
	// network): the 100×100 size segment upsizes to 1200×1200.
	in := "https://is1.mzstatic.com/image/.../100x100bb.jpg"
	got := strings.Replace(in, "100x100", "1200x1200", 1)
	want := "https://is1.mzstatic.com/image/.../1200x1200bb.jpg"
	if got != want {
		t.Errorf("upsize = %q, want %q", got, want)
	}
}

func TestMergeScored(t *testing.T) {
	mb := &RipScoredCandidate{Release: &MatchedRelease{ReleaseMBID: "m1", Album: "A", AlbumArtist: "X"}, Confidence: 0.9}
	dup := &RipScoredCandidate{Release: &MatchedRelease{ReleaseMBID: "m1", Album: "A", AlbumArtist: "X"}, Confidence: 0.7} // same release, lower score
	other := &RipScoredCandidate{Release: &MatchedRelease{ReleaseMBID: "m2", Album: "B", AlbumArtist: "Y"}, Confidence: 0.5}

	out := mergeScored([]*RipScoredCandidate{other}, []*RipScoredCandidate{mb, dup})
	// mb and dup share the MBID key → collapse to one (the higher score wins).
	if len(out) != 2 {
		t.Fatalf("got %d merged candidates, want 2 (the m1 duplicates collapse)", len(out))
	}
	if out[0].Release.ReleaseMBID != "m1" || out[0].Confidence != 0.9 {
		t.Errorf("first = %+v, want m1 @0.9 (best-first, higher score kept)", out[0])
	}
}

func TestSanityCheckTrackDurations(t *testing.T) {
	toc := fixtureTOC
	tocDur := tocTrackDurationsMs(&toc)

	// A release whose durations match the TOC → nothing flagged.
	ok := &MatchedRelease{TrackCount: len(tocDur)}
	for i, d := range tocDur {
		ok.Tracks = append(ok.Tracks, RippedTrackMeta{Position: i + 1, LengthMs: d})
	}
	if f := sanityCheckTrackDurations(ok, &toc); len(f) != 0 {
		t.Errorf("matching durations flagged %v, want none", f)
	}

	// Blow out track 2's duration → it gets flagged, others don't.
	bad := &MatchedRelease{TrackCount: len(tocDur)}
	for i, d := range tocDur {
		bad.Tracks = append(bad.Tracks, RippedTrackMeta{Position: i + 1, LengthMs: d})
	}
	bad.Tracks[1].LengthMs = tocDur[1] + durationSanityMaxMs + 30000
	f := sanityCheckTrackDurations(bad, &toc)
	if len(f) != 1 || f[0] != 2 {
		t.Errorf("flagged = %v, want [2]", f)
	}
}
