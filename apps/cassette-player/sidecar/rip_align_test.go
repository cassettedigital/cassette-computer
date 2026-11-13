package main

import "testing"

func relFromDurs(durs []int, titles []string) *MatchedRelease {
	r := &MatchedRelease{TrackCount: len(durs)}
	for i, d := range durs {
		title := ""
		if i < len(titles) {
			title = titles[i]
		}
		r.Tracks = append(r.Tracks, RippedTrackMeta{Position: i + 1, Title: title, LengthMs: d})
	}
	return r
}

// The motivating bug: the disc has NO interlude, but the only documented release
// HAS one. Position-locked matching mis-names every track after the seam.
// Alignment must drop the interlude on the release side and name the disc's real
// tracks correctly — with NO gaps on the disc side.
func TestAlignDropsReleaseInterlude(t *testing.T) {
	sec := func(s int) int { return s * 1000 }
	// Disc: four songs, then straight into the rest — no interlude.
	disc := []int{sec(173), sec(164), sec(227), sec(320), sec(161), sec(184), sec(252)}
	// Release: same songs, but an extra ~24s interlude inserted at position 5.
	relDurs := []int{sec(173), sec(164), sec(227), sec(320), sec(24), sec(161), sec(184), sec(252)}
	relTitles := []string{"Feeling This", "Obvious", "I Miss You", "Violence",
		"Stockholm Syndrome Interlude", "Stockholm Syndrome", "Down", "Asthenia"}
	rel := relFromDurs(relDurs, relTitles)

	got := alignReleaseToDisc(rel, disc, 1, nil)

	if len(got.Gaps) != 0 {
		t.Fatalf("expected no disc-side gaps, got %v", got.Gaps)
	}
	if got.MatchedCount != len(disc) {
		t.Fatalf("matched %d of %d disc tracks, want all", got.MatchedCount, len(disc))
	}
	// The interlude is the one release track the disc lacks.
	if len(got.DroppedReleaseTitles) != 1 || got.DroppedReleaseTitles[0] != "Stockholm Syndrome Interlude" {
		t.Fatalf("dropped release titles = %v, want [Stockholm Syndrome Interlude]", got.DroppedReleaseTitles)
	}
	// Disc track 5 must be "Stockholm Syndrome" (the SONG), not the interlude —
	// this is exactly the name that was wrong before.
	if got.Tracks[4].Title != "Stockholm Syndrome" {
		t.Errorf("disc track 5 = %q, want Stockholm Syndrome (the seam track)", got.Tracks[4].Title)
	}
	if got.Tracks[6].Title != "Asthenia" {
		t.Errorf("disc track 7 = %q, want Asthenia (post-seam stays aligned)", got.Tracks[6].Title)
	}
	if got.Score < confidenceAutoSelect {
		t.Errorf("score %.3f below auto-select bar %.2f — should confidently auto-pick", got.Score, confidenceAutoSelect)
	}
}

// A track the alignment can place by POSITION (between confident matches) but
// whose duration is well off — a longer pressing of the same song — must be
// NAMED from the release and FLAGGED, never blanked into a gap. This is the
// "Violence runs 5:20 on my disc, 4:06 on the reference" case.
func TestAlignNamesLooseTrackAndFlags(t *testing.T) {
	sec := func(s int) int { return s * 1000 }
	disc := []int{sec(180), sec(320), sec(200)}    // middle track runs long (5:20)
	relDurs := []int{sec(180), sec(246), sec(200)} // reference has it at 4:06
	rel := relFromDurs(relDurs, []string{"Opener", "Violence", "Closer"})

	got := alignReleaseToDisc(rel, disc, 1, nil)

	if len(got.Gaps) != 0 {
		t.Fatalf("loose-but-positioned track must not become a gap; gaps=%v", got.Gaps)
	}
	if got.Tracks[1].Title != "Violence" {
		t.Errorf("middle track = %q, want Violence (named by position despite loose duration)", got.Tracks[1].Title)
	}
	if len(got.Flagged) != 1 || got.Flagged[0] != 2 {
		t.Errorf("flagged = %v, want [2] (the loose track marked for a second look)", got.Flagged)
	}
}

// A disc with a genuine bonus track the release does NOT have must surface that
// track as a GAP (name-first), while everything else aligns and stays confident.
func TestAlignSurfacesDiscBonusGap(t *testing.T) {
	sec := func(s int) int { return s * 1000 }
	disc := []int{sec(180), sec(200), sec(220), sec(150)} // 4th is a bonus cut
	relDurs := []int{sec(180), sec(200), sec(220)}        // release has only 3
	rel := relFromDurs(relDurs, []string{"One", "Two", "Three"})

	got := alignReleaseToDisc(rel, disc, 1, nil)

	if len(got.Gaps) != 1 || got.Gaps[0] != 4 {
		t.Fatalf("gaps = %v, want [4] (the bonus track)", got.Gaps)
	}
	if got.Tracks[3].Title != "" {
		t.Errorf("bonus track title = %q, want blank (awaiting a name)", got.Tracks[3].Title)
	}
	if got.Tracks[0].Title != "One" || got.Tracks[2].Title != "Three" {
		t.Error("the three real tracks should still be named correctly")
	}
}

// applyGapNames: a named gap takes the user's name; a skipped gap falls back to
// "Track NN"; an already-named track is left untouched.
func TestApplyGapNames(t *testing.T) {
	rel := &MatchedRelease{AlbumArtist: "Blink-182", Tracks: []RippedTrackMeta{
		{Position: 1, Title: "Feeling This", LengthMs: 173000},
		{Position: 2, Title: "", LengthMs: 200000}, // gap — user will name
		{Position: 3, Title: "", LengthMs: 150000}, // gap — user will skip
	}}
	applyGapNames(rel, map[string]string{"2": "  Not Now  "}) // whitespace trimmed; pos 3 absent

	if rel.Tracks[0].Title != "Feeling This" {
		t.Errorf("named track was altered: %q", rel.Tracks[0].Title)
	}
	if rel.Tracks[1].Title != "Not Now" {
		t.Errorf("gap track 2 = %q, want %q", rel.Tracks[1].Title, "Not Now")
	}
	if rel.Tracks[2].Title != "Track 03" {
		t.Errorf("skipped gap track 3 = %q, want fallback Track 03", rel.Tracks[2].Title)
	}
	if rel.Tracks[1].Artist != "Blink-182" || rel.Tracks[1].LocalID == "" {
		t.Error("named gap should inherit album artist and get a local ID")
	}
}

// End-to-end heal-and-remember: a disc WITHOUT the interlude is matched to the
// only documented release (WITH it). Alignment corrects the seam, the pick is
// persisted, and the NEXT insert of this exact disc rebuilds the corrected
// edition from local memory — names and all. This is the whole point.
func TestHealAndRememberCorrectedEdition(t *testing.T) {
	oldDir, oldState := sidecarDataDir, liveState
	t.Cleanup(func() { sidecarDataDir, liveState = oldDir, oldState })
	sidecarDataDir = t.TempDir()
	liveState = &SidecarState{SubsonicUsername: "founder"}
	resetDiscMemory()

	toc := fixtureTOC // 12-track disc, no interlude
	disc := tocTrackDurationsMs(&toc)
	profile := buildDiscProfile(&toc, fixtureDiscID)

	// The documented release: the same 12 songs, plus a ~20s interlude inserted at
	// position 5 — exactly the shape that used to mis-name every later track.
	relDurs := make([]int, 0, len(disc)+1)
	relTitles := make([]string, 0, len(disc)+1)
	for i, d := range disc {
		if i == 4 {
			relDurs = append(relDurs, 20000)
			relTitles = append(relTitles, "Interlude")
		}
		relDurs = append(relDurs, d)
		relTitles = append(relTitles, "Song "+itoa(i+1))
	}
	rel := relFromDurs(relDurs, relTitles)
	rel.ReleaseMBID = "rel-selftitled"
	rel.Album = "Self-Titled"
	rel.AlbumArtist = "The Band"

	// Confirm-time: align to the disc, then persist exactly what we'd rip.
	aligned := alignReleaseToDisc(rel, disc, toc.FirstTrack, nil)
	rel.Tracks = aligned.Tracks
	rel.TrackCount = len(aligned.Tracks)
	applyGapNames(rel, nil) // no disc-side gaps in this scenario
	persistDiscIdentity(profile, rel, []string{"manual"}, false, aligned.Score, "user_pick", crosswalk{}, false)

	// Next insert of THIS disc → resolves from local memory, offline.
	rec, _ := lookupMemory(profile)
	if rec == nil {
		t.Fatal("the corrected edition wasn't remembered")
	}
	got := rec.toMatchedRelease(&toc, nil)
	if len(got.Tracks) != len(disc) {
		t.Fatalf("rebuilt %d tracks, want %d (the disc's count, not the release's)", len(got.Tracks), len(disc))
	}
	// The seam: disc track 5 must be the real song, NEVER the interlude.
	if got.Tracks[4].Title != "Song 5" {
		t.Errorf("remembered disc track 5 = %q, want Song 5 (the interlude must not creep back)", got.Tracks[4].Title)
	}
	if got.Tracks[11].Title != "Song 12" {
		t.Errorf("remembered last track = %q, want Song 12 (post-seam stays aligned)", got.Tracks[11].Title)
	}
}

// Exact 1:1 match (no inserts/drops) must align perfectly and score ~1.
func TestAlignExactMatch(t *testing.T) {
	tocDur := tocTrackDurationsMs(&fixtureTOC)
	rel := relFromDurs(tocDur, nil)
	got := alignReleaseToDisc(rel, tocDur, fixtureTOC.FirstTrack, nil)
	if len(got.Gaps) != 0 || got.MatchedCount != len(tocDur) {
		t.Fatalf("exact match should have no gaps; gaps=%v matched=%d", got.Gaps, got.MatchedCount)
	}
	if got.Score < 0.99 {
		t.Errorf("exact match score = %.3f, want ~1.0", got.Score)
	}
}
