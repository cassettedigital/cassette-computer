package main

import "testing"

// J2 — a remembered record with no titles but an MBID gets its tracklist filled
// in by position from the resolved release; generic names are replaced.
func TestMergeTitlesByPosition(t *testing.T) {
	rel := &MatchedRelease{
		ReleaseMBID: "rel-x", Album: "A", AlbumArtist: "Eve 6", TrackCount: 3,
		Tracks: []RippedTrackMeta{
			{Position: 1, Title: "Track 01", Artist: "Eve 6", LengthMs: 200000},
			{Position: 2, Title: "Track 02", Artist: "Eve 6", LengthMs: 210000},
			{Position: 3, Title: "Track 03", Artist: "Eve 6", LengthMs: 220000},
		},
	}
	full := &MatchedRelease{
		Date: "2003",
		Tracks: []RippedTrackMeta{
			{Position: 1, Title: "Promise", RecordingMBID: "rec-1"},
			{Position: 2, Title: "Think Twice", RecordingMBID: "rec-2"},
			// position 3 intentionally missing from the resolved release
		},
	}

	beforeLocalID := rel.Tracks[0].LocalID
	n := mergeTitlesByPosition(rel, full)
	if n != 2 {
		t.Fatalf("filled %d titles, want 2", n)
	}
	if rel.Tracks[0].Title != "Promise" || rel.Tracks[1].Title != "Think Twice" {
		t.Errorf("titles not merged: %q, %q", rel.Tracks[0].Title, rel.Tracks[1].Title)
	}
	if rel.Tracks[0].RecordingMBID != "rec-1" {
		t.Errorf("recording MBID not merged: %q", rel.Tracks[0].RecordingMBID)
	}
	if rel.Tracks[0].LocalID == beforeLocalID {
		t.Error("LocalID should be recomputed from the real title")
	}
	if rel.Tracks[2].Title != "Track 03" {
		t.Errorf("a position absent from the release must keep its fallback, got %q", rel.Tracks[2].Title)
	}
	if rel.Date != "2003" {
		t.Errorf("date should fill from the release when empty, got %q", rel.Date)
	}
}

// isGenericTitle / hasPlaceholderTitles drive the keystone (only fetch real
// titles when what we hold is a placeholder).
func TestIsGenericTitle(t *testing.T) {
	generic := []string{"", "Track 01", "Track 1", "track 12", "  Track 07  "}
	real := []string{"Without You Here", "Track Star", "12", "Untitled", "Intro"}
	for _, s := range generic {
		if !isGenericTitle(s) {
			t.Errorf("isGenericTitle(%q) = false, want true", s)
		}
	}
	for _, s := range real {
		if isGenericTitle(s) {
			t.Errorf("isGenericTitle(%q) = true, want false", s)
		}
	}

	// ensureRealTitles is a no-op without an MBID or when titles are already real.
	noMBID := &MatchedRelease{Tracks: []RippedTrackMeta{{Position: 1, Title: "Track 01"}}}
	if ensureRealTitles(noMBID) != 0 {
		t.Error("ensureRealTitles must no-op without an MBID")
	}
	realTitles := &MatchedRelease{ReleaseMBID: "m", Tracks: []RippedTrackMeta{{Position: 1, Title: "Promise"}}}
	if hasPlaceholderTitles(realTitles) || ensureRealTitles(realTitles) != 0 {
		t.Error("ensureRealTitles must no-op when titles are already real")
	}
}

// recordHasTitles distinguishes a rich record (offline-ready) from a lean
// backfilled one (needs a title back-resolve).
func TestRecordHasTitles(t *testing.T) {
	lean := &DiscIdentityRecord{TrackRecordings: []TrackRecording{{Position: 1, RecordingMBID: "r"}}}
	if recordHasTitles(lean) {
		t.Error("a record with no titles must report false")
	}
	rich := &DiscIdentityRecord{TrackRecordings: []TrackRecording{{Position: 1, Title: "Promise"}}}
	if !recordHasTitles(rich) {
		t.Error("a record with a title must report true")
	}
	if recordHasTitles(&DiscIdentityRecord{}) {
		t.Error("an empty record must report false")
	}
}
