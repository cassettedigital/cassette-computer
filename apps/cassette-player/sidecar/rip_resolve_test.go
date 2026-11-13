package main

import (
	"strings"
	"testing"
)

var okComputerTitles = []string{
	"Airbag", "Paranoid Android", "Subterranean Homesick Alien",
	"Exit Music (For a Film)", "Let Down", "Karma Police", "Fitter Happier",
	"Electioneering", "Climbing Up the Walls", "No Surprises", "Lucky", "The Tourist",
}

// buildFixtureRelease constructs a MatchedRelease whose per-track durations
// equal the fixtureTOC's exactly — i.e. a perfect duration match — so the
// scorer's duration component is a clean 1.0 to reason against.
func buildFixtureRelease() *MatchedRelease {
	toc := fixtureTOC
	durs := tocTrackDurationsMs(&toc)
	rel := &MatchedRelease{
		ReleaseMBID: "rel-1", Album: "OK Computer", AlbumArtist: "Radiohead",
		TrackCount: len(durs),
	}
	for i, d := range durs {
		rel.Tracks = append(rel.Tracks, RippedTrackMeta{
			Position: i + 1, Title: okComputerTitles[i], LengthMs: d,
		})
	}
	return rel
}

func cdTextFor(rel *MatchedRelease) *CDText {
	ct := &CDText{Album: rel.Album, AlbumArtist: rel.AlbumArtist, Tracks: map[int]CDTextTrack{}}
	for _, tr := range rel.Tracks {
		ct.Tracks[tr.Position] = CDTextTrack{Title: tr.Title}
	}
	return ct
}

func TestScoreCandidate_ExactMatch(t *testing.T) {
	toc := fixtureTOC
	durs := tocTrackDurationsMs(&toc)
	rel := buildFixtureRelease()

	// Duration-only (no CD-TEXT): an exact alignment is full confidence.
	if got := scoreCandidate(rel, durs, nil); got < 0.99 {
		t.Errorf("exact duration match = %.3f, want ~1.0", got)
	}
	// With matching CD-TEXT titles: still full confidence.
	if got := scoreCandidate(rel, durs, cdTextFor(rel)); got < 0.99 {
		t.Errorf("exact match + matching titles = %.3f, want ~1.0", got)
	}
	// Both clear the auto-select bar.
	if scoreCandidate(rel, durs, nil) < confidenceAutoSelect {
		t.Errorf("exact match should clear the auto-select threshold")
	}
}

func TestScoreCandidate_TrackCountHardGate(t *testing.T) {
	toc := fixtureTOC
	durs := tocTrackDurationsMs(&toc)
	rel := buildFixtureRelease()
	rel.Tracks = rel.Tracks[:len(rel.Tracks)-1] // 11 vs the TOC's 12
	rel.TrackCount = len(rel.Tracks)

	if got := scoreCandidate(rel, durs, cdTextFor(buildFixtureRelease())); got != 0 {
		t.Errorf("track-count mismatch = %.3f, want 0 (hard gate disqualifies)", got)
	}
}

func TestScoreCandidate_DurationDriftZero(t *testing.T) {
	toc := fixtureTOC
	durs := tocTrackDurationsMs(&toc)
	rel := buildFixtureRelease()
	for i := range rel.Tracks {
		rel.Tracks[i].LengthMs += durationZeroCreditMs + 5000 // far beyond zero-credit
	}
	if got := scoreCandidate(rel, durs, nil); got != 0 {
		t.Errorf("fully-drifted durations = %.3f, want 0", got)
	}
}

func TestScoreCandidate_TitleLiftsBorderline(t *testing.T) {
	toc := fixtureTOC
	durs := tocTrackDurationsMs(&toc)
	rel := buildFixtureRelease()
	// Nudge every track just past full-credit so duration alone is < 1 but > 0.
	for i := range rel.Tracks {
		rel.Tracks[i].LengthMs += durationFullCreditMs + 1000
	}
	durOnly := scoreCandidate(rel, durs, nil)
	withTitles := scoreCandidate(rel, durs, cdTextFor(rel))
	if withTitles <= durOnly {
		t.Errorf("matching CD-TEXT titles should raise confidence: dur-only=%.3f with-titles=%.3f", durOnly, withTitles)
	}
}

func TestResolutionDecision(t *testing.T) {
	rel := buildFixtureRelease()
	cands := []*RipScoredCandidate{{Release: rel, Confidence: 0.9}}
	cases := []struct {
		name string
		res  *RipResolution
		want string
	}{
		{"auto", &RipResolution{Release: rel, Confidence: 0.9, Candidates: cands}, "auto"},
		{"threshold", &RipResolution{Release: rel, Confidence: confidenceAutoSelect, Candidates: cands}, "auto"},
		{"confirm", &RipResolution{Release: rel, Confidence: 0.5, Candidates: cands}, "confirm"},
		{"import-no-release", &RipResolution{}, "import"},
		{"import-zero-confidence", &RipResolution{Release: rel, Confidence: 0, Candidates: cands}, "import"},
	}
	for _, c := range cases {
		if got := c.res.Decision(); got != c.want {
			t.Errorf("%s: Decision() = %q, want %q", c.name, got, c.want)
		}
	}
}

func TestLocalRelease_NoCDText(t *testing.T) {
	toc := fixtureTOC
	durs := tocTrackDurationsMs(&toc)
	rel := localRelease(&toc, fixtureDiscID, nil)

	if !rel.Unidentified || !rel.NeedsNaming {
		t.Fatalf("want Unidentified+NeedsNaming, got %+v", rel)
	}
	if rel.AlbumArtist != "Unknown Artist" {
		t.Errorf("album artist = %q, want Unknown Artist", rel.AlbumArtist)
	}
	if !strings.HasPrefix(rel.Album, "Unknown Album ") {
		t.Errorf("album = %q, want a disc-suffixed Unknown Album", rel.Album)
	}
	if rel.DiscID != fixtureDiscID {
		t.Errorf("disc id = %q, want the computed disc ID as the stable key", rel.DiscID)
	}
	if len(rel.Tracks) != len(durs) {
		t.Fatalf("track count = %d, want %d", len(rel.Tracks), len(durs))
	}
	if rel.Tracks[0].Title != "Track 01" {
		t.Errorf("track 1 title = %q, want Track 01", rel.Tracks[0].Title)
	}
	if rel.Tracks[0].LengthMs != durs[0] {
		t.Errorf("track 1 duration = %d, want %d (from TOC)", rel.Tracks[0].LengthMs, durs[0])
	}
	for i, tr := range rel.Tracks {
		if tr.LocalID == "" {
			t.Fatalf("track %d missing Cassette local id", i+1)
		}
	}
}

func TestLocalRelease_WithCDText(t *testing.T) {
	toc := fixtureTOC
	ct := &CDText{
		Album: "My Album", AlbumArtist: "My Artist",
		Tracks: map[int]CDTextTrack{1: {Title: "Opener", Artist: "Guest"}},
	}
	rel := localRelease(&toc, fixtureDiscID, ct)

	if rel.NeedsNaming {
		t.Errorf("a CD-TEXT-named album should not need naming")
	}
	if !rel.Unidentified {
		t.Errorf("a no-MBID rip is still unidentified even when CD-TEXT named it")
	}
	if rel.Album != "My Album" || rel.AlbumArtist != "My Artist" {
		t.Errorf("got %q / %q, want My Album / My Artist", rel.Album, rel.AlbumArtist)
	}
	if rel.Tracks[0].Title != "Opener" || rel.Tracks[0].Artist != "Guest" {
		t.Errorf("track 1 = %q / %q, want Opener / Guest", rel.Tracks[0].Title, rel.Tracks[0].Artist)
	}
	if rel.Tracks[1].Title != "Track 02" {
		t.Errorf("track 2 title = %q, want Track 02 (no CD-TEXT for it)", rel.Tracks[1].Title)
	}
}

func TestDiscFingerprint(t *testing.T) {
	a := discFingerprint(fixtureDiscID)
	if len(a) != 6 {
		t.Errorf("fingerprint %q length = %d, want 6", a, len(a))
	}
	if discFingerprint(fixtureDiscID) != a {
		t.Errorf("fingerprint not stable for the same disc id")
	}
	if discFingerprint("some-other-disc-id") == a {
		t.Errorf("different disc ids should not collide")
	}
}
