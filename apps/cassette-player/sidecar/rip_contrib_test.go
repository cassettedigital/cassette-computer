package main

import (
	"strings"
	"testing"
)

func TestDeriveContributionType(t *testing.T) {
	cases := []struct {
		source  string
		hasMBID bool
		want    string
	}{
		{"mb_disc_id", true, "none"},          // MB already has the disc ID for this TOC
		{"mb_fuzzy_toc", true, "musicbrainz_disc_id"}, // MB release known, no disc ID
		{"cd_text", true, "musicbrainz_disc_id"},
		{"gnudb", true, "musicbrainz_disc_id"}, // gnudb named it AND we cross-resolved an MBID
		{"gnudb", false, "none"},               // gnudb has it; no MB release to attach an ID to
		{"manual_search", false, "gnudb_submission"},
		{"cd_text", false, "gnudb_submission"},
	}
	for _, c := range cases {
		if got := deriveContributionType(c.source, c.hasMBID); got != c.want {
			t.Errorf("deriveContributionType(%q, %v) = %q, want %q", c.source, c.hasMBID, got, c.want)
		}
	}
}

func TestIdentitySourceLabel(t *testing.T) {
	cases := map[string]string{
		"discid": "mb_disc_id", "mb-toc": "mb_fuzzy_toc", "cdtext": "cd_text",
		"gnudb": "gnudb", "manual": "manual_search",
	}
	for in, want := range cases {
		if got := identitySourceLabel(in); got != want {
			t.Errorf("identitySourceLabel(%q) = %q, want %q", in, got, want)
		}
	}
}

// Capture writes a well-formed record to the local JSONL store, and a signed-out
// session yields a null attribution. Roundtrips through load.
func TestCaptureContribution_Roundtrip(t *testing.T) {
	oldDir, oldState := sidecarDataDir, liveState
	t.Cleanup(func() { sidecarDataDir, liveState = oldDir, oldState })
	sidecarDataDir = t.TempDir()
	liveState = &SidecarState{SubsonicUsername: "founder"}

	toc := fixtureTOC
	dr := &detectResult{
		toc:    &toc,
		discID: fixtureDiscID,
		res:    &RipResolution{},
	}
	chosen := &MatchedRelease{
		ReleaseMBID: "rel-xyz", Album: "OK Computer", AlbumArtist: "Radiohead", TrackCount: 12,
	}
	captureMatchContribution(dr, chosen, "gnudb", 0.95)

	recs, err := loadContributions()
	if err != nil {
		t.Fatal(err)
	}
	if len(recs) != 1 {
		t.Fatalf("got %d records, want 1", len(recs))
	}
	r := recs[0]
	if r.IdentitySource != "gnudb" {
		t.Errorf("identity_source = %q", r.IdentitySource)
	}
	if r.ContributionType != "musicbrainz_disc_id" { // gnudb hit + cross-resolved MBID
		t.Errorf("contribution_type = %q, want musicbrainz_disc_id", r.ContributionType)
	}
	if r.ComputedMBDiscID != fixtureDiscID {
		t.Errorf("computed_mb_disc_id = %q", r.ComputedMBDiscID)
	}
	if r.FreedbDiscID == "" || len(r.FreedbDiscID) != 8 {
		t.Errorf("freedb_disc_id = %q, want 8 hex", r.FreedbDiscID)
	}
	if r.TOCRaw.LastTrack != 12 || len(r.TOCRaw.TrackOffsets) != 12 {
		t.Errorf("toc_raw not captured: %+v", r.TOCRaw)
	}
	if r.Attribution == nil || *r.Attribution != "founder" {
		t.Errorf("attribution = %v, want founder", r.Attribution)
	}

	// Signed out → null attribution.
	liveState = &SidecarState{}
	captureMatchContribution(dr, chosen, "mb-toc", 0.82)
	recs, _ = loadContributions()
	if len(recs) != 2 {
		t.Fatalf("got %d records, want 2", len(recs))
	}
	if recs[1].Attribution != nil {
		t.Errorf("signed-out attribution = %v, want nil", recs[1].Attribution)
	}
	if recs[1].IdentitySource != "mb_fuzzy_toc" {
		t.Errorf("identity_source = %q, want mb_fuzzy_toc", recs[1].IdentitySource)
	}
}

func TestCaptureContribution_PrivacyBoundary(t *testing.T) {
	oldDir, oldState := sidecarDataDir, liveState
	t.Cleanup(func() { sidecarDataDir, liveState = oldDir, oldState })
	sidecarDataDir = t.TempDir()
	liveState = &SidecarState{SubsonicUsername: "founder"}

	toc := fixtureTOC
	dr := &detectResult{toc: &toc, discID: fixtureDiscID, res: &RipResolution{}}
	captureMatchContribution(dr, &MatchedRelease{Album: "A", AlbumArtist: "B", ReleaseMBID: "m"}, "mb-toc", 0.9)

	data, err := readFileString(contributionsPath())
	if err != nil {
		t.Fatal(err)
	}
	// Only public disc/release identifiers may appear — never local paths.
	for _, banned := range []string{sidecarDataDir, "/Users/", ".flac", "library", "Music/"} {
		if strings.Contains(data, banned) {
			t.Errorf("record leaked non-public data %q: %s", banned, data)
		}
	}
}

func readFileString(p string) (string, error) {
	recs, err := loadContributions()
	if err != nil {
		return "", err
	}
	var b strings.Builder
	for _, r := range recs {
		b.WriteString(r.MatchedAlbum + "|" + r.MatchedArtist + "|" + r.ComputedMBDiscID + "|" + r.FreedbDiscID)
		if r.Attribution != nil {
			b.WriteString("|" + *r.Attribution)
		}
	}
	return b.String(), nil
}
