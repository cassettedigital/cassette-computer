package main

import (
	"reflect"
	"testing"
)

func progWith(trackCount int, states ...string) *RipProgress {
	p := &RipProgress{TrackCount: trackCount}
	for i, st := range states {
		p.Tracks = append(p.Tracks, TrackRipStatus{Position: i + 1, Title: "Track " + string(rune('A'+i)), State: st})
	}
	p.CompletedTracks = countTracksInState(p, "done")
	return p
}

func TestTrackStateHelpers(t *testing.T) {
	p := progWith(4, "done", "error", "done", "error")
	if got := countTracksInState(p, "done"); got != 2 {
		t.Errorf("done count = %d, want 2", got)
	}
	if got := trackIndicesInState(p, "error"); !reflect.DeepEqual(got, []int{1, 3}) {
		t.Errorf("error indices = %v, want [1 3]", got)
	}
	rel := &MatchedRelease{Tracks: []RippedTrackMeta{{Position: 10}, {Position: 20}, {Position: 30}, {Position: 40}}}
	if got := trackPositions(rel, []int{1, 3}); !reflect.DeepEqual(got, []int{20, 40}) {
		t.Errorf("positions = %v, want [20 40]", got)
	}
	if got := allTrackIndices(rel); !reflect.DeepEqual(got, []int{0, 1, 2, 3}) {
		t.Errorf("allTrackIndices = %v", got)
	}
}

// The completeness gate's message names exactly what's missing.
func TestIncompleteMessage(t *testing.T) {
	// Single missing track — the Arch Drive Goodbye case.
	p := &RipProgress{TrackCount: 12, CompletedTracks: 11}
	for i := 1; i <= 12; i++ {
		st := "done"
		title := "t"
		if i == 12 {
			st = "error"
			title = "Arch Drive Goodbye"
		}
		p.Tracks = append(p.Tracks, TrackRipStatus{Position: i, Title: title, State: st})
	}
	got := incompleteMessage(p)
	want := "Ripped 11 of 12 — track 12 (Arch Drive Goodbye) couldn't be read."
	if got != want {
		t.Errorf("incompleteMessage = %q, want %q", got, want)
	}

	// Multiple missing.
	p2 := progWith(5, "done", "error", "done", "error", "done")
	if got := incompleteMessage(p2); got != "Ripped 3 of 5 — tracks 2, 4 couldn't be read." {
		t.Errorf("multi incompleteMessage = %q", got)
	}
}

// The completeness record captures expected vs landed and every failed position.
func TestBuildCompletenessRecord(t *testing.T) {
	oldNow := nowFn
	t.Cleanup(func() { nowFn = oldNow })

	p := &RipProgress{TrackCount: 3, CompletedTracks: 2}
	p.Tracks = []TrackRipStatus{
		{Position: 1, Title: "One", State: "done"},
		{Position: 2, Title: "Two", State: "done"},
		{Position: 3, Title: "Three", State: "error", Attempts: 3, Error: "cd-paranoia: read error"},
	}
	rel := &MatchedRelease{Album: "OK Computer", AlbumArtist: "Radiohead", ReleaseMBID: "rel-1", DiscID: "disc-1"}

	rec := buildCompletenessRecord(p, rel, true)
	if rec.ExpectedTracks != 3 || rec.LandedTracks != 2 {
		t.Errorf("expected/landed = %d/%d, want 3/2", rec.ExpectedTracks, rec.LandedTracks)
	}
	if rec.Album != "OK Computer" || rec.AlbumArtist != "Radiohead" || rec.ReleaseMBID != "rel-1" {
		t.Errorf("identity not captured: %+v", rec)
	}
	if len(rec.FailedPositions) != 1 {
		t.Fatalf("failed positions = %d, want 1", len(rec.FailedPositions))
	}
	f := rec.FailedPositions[0]
	if f.Position != 3 || f.Title != "Three" || f.Attempts != 3 || f.Error == "" {
		t.Errorf("failed track not captured: %+v", f)
	}
	if !rec.Registered {
		t.Errorf("registered flag lost")
	}

	// A complete rip records no failures.
	full := progWith(2, "done", "done")
	if rec := buildCompletenessRecord(full, rel, true); len(rec.FailedPositions) != 0 || rec.LandedTracks != rec.ExpectedTracks {
		t.Errorf("complete rip should have no failures: %+v", rec)
	}
}
