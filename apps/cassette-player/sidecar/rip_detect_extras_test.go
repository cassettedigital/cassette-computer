package main

import "testing"

// applyOwnership flags exactly the detected tracks the user already owns — by
// recording MBID or by cassette-local-id — so the detect card shows "In your
// library" instead of "Queued".
func TestApplyOwnership(t *testing.T) {
	owned := &ownedSet{
		mbid:    map[string]bool{"rec-2": true},
		localID: map[string]bool{"lid-3": true},
	}
	rel := &MatchedRelease{Tracks: []RippedTrackMeta{
		{Position: 1, RecordingMBID: "rec-1", LocalID: "lid-1"}, // owned by neither
		{Position: 2, RecordingMBID: "rec-2", LocalID: "lid-2"}, // owned by MBID
		{Position: 3, RecordingMBID: "rec-x", LocalID: "lid-3"}, // owned by local-id
	}}
	p := &RipProgress{Tracks: []TrackRipStatus{{Position: 1}, {Position: 2}, {Position: 3}}}

	applyOwnership(p, rel, owned)

	for i, want := range []bool{false, true, true} {
		if p.Tracks[i].InLibrary != want {
			t.Errorf("track %d: InLibrary=%v, want %v", i+1, p.Tracks[i].InLibrary, want)
		}
	}
	// Album-level aggregate: 2 of 3 owned, and not the whole album → partial.
	if p.OwnedTrackCount != 2 {
		t.Errorf("OwnedTrackCount=%d, want 2", p.OwnedTrackCount)
	}
	if p.AlreadyInLibrary {
		t.Error("AlreadyInLibrary=true for a partially-owned, unmatched album, want false")
	}
}

// A compilation the user re-inserts reads as already-owned at the ALBUM level even
// when none of its per-track recording MBIDs match the library copy — the album
// key (normalized name+artist) carries the signal the per-track count misses.
func TestApplyOwnershipCompilationByAlbumKey(t *testing.T) {
	owned := &ownedSet{
		mbid:        map[string]bool{},
		localID:     map[string]bool{},
		releaseMBID: map[string]bool{},
		albumKey:    map[string]bool{albumKey("The Best of David Bowie 1980/1987", "David Bowie"): true},
	}
	rel := &MatchedRelease{
		Album:       "The Best of David Bowie 1980/1987",
		AlbumArtist: "David Bowie",
		Tracks: []RippedTrackMeta{
			{Position: 1, RecordingMBID: "disc-rec-1"}, // different pressing → no MBID match
			{Position: 2, RecordingMBID: "disc-rec-2"},
		},
	}
	p := &RipProgress{Tracks: []TrackRipStatus{{Position: 1}, {Position: 2}}}

	applyOwnership(p, rel, owned)

	if p.OwnedTrackCount != 0 {
		t.Errorf("OwnedTrackCount=%d, want 0 (no per-track MBID match)", p.OwnedTrackCount)
	}
	if !p.AlreadyInLibrary {
		t.Error("AlreadyInLibrary=false, want true (album key matches the library)")
	}
}

// A fresh SIBLING disc of a multi-disc set must NOT read as already-ripped just
// because another disc of the same set is already in the library — both discs share
// one album name, so the album-level match alone would falsely flag it. Regression
// for the reported multi-disc "already ripped" bug (rip disc 2, insert disc 1).
func TestApplyOwnershipMultiDiscSiblingIsFresh(t *testing.T) {
	t.Cleanup(resetDiscMemory)
	discMemory.mu.Lock()
	discMemory.loaded = true // populate the ledger in-memory; skip the disk load
	discMemory.all = []*DiscIdentityRecord{
		{MBDiscID: "discA", Album: "Song Machine", AlbumArtist: "Gorillaz", RipComplete: true},
	}
	discMemory.mu.Unlock()

	// The set's album is owned (via disc A), but none of disc B's own tracks match.
	owned := &ownedSet{
		mbid: map[string]bool{}, localID: map[string]bool{}, releaseMBID: map[string]bool{},
		albumKey: map[string]bool{albumKey("Song Machine", "Gorillaz"): true},
	}
	relB := &MatchedRelease{
		DiscID: "discB", Album: "Song Machine", AlbumArtist: "Gorillaz",
		Tracks: []RippedTrackMeta{{Position: 1, RecordingMBID: "b-rec-1"}, {Position: 2, RecordingMBID: "b-rec-2"}},
	}
	pB := &RipProgress{Tracks: []TrackRipStatus{{Position: 1}, {Position: 2}}}
	applyOwnership(pB, relB, owned)

	if pB.OwnedTrackCount != 0 {
		t.Errorf("OwnedTrackCount=%d, want 0 (disc B's own tracks aren't owned)", pB.OwnedTrackCount)
	}
	if !pB.OtherDiscInLibrary {
		t.Error("OtherDiscInLibrary=false, want true (disc A of the set is ripped)")
	}
	if pB.AlreadyInLibrary {
		t.Error("AlreadyInLibrary=true for a fresh sibling disc — the reported multi-disc bug; want false")
	}

	// Re-inserting the SAME ripped disc A still reads as already-ripped (thisDiscRipped).
	relA := &MatchedRelease{
		DiscID: "discA", Album: "Song Machine", AlbumArtist: "Gorillaz",
		Tracks: []RippedTrackMeta{{Position: 1, RecordingMBID: "a-rec-1"}},
	}
	pA := &RipProgress{Tracks: []TrackRipStatus{{Position: 1}}}
	applyOwnership(pA, relA, owned)
	if !pA.AlreadyInLibrary {
		t.Error("AlreadyInLibrary=false for a re-inserted already-ripped disc, want true")
	}
}

// otherDiscOfAlbumRipped is the "part of a set" signal behind the detect card's disc
// label (shown only once a sibling disc exists) and the ownership disambiguation (a new
// disc of a partially-owned set must not read as "already owned"). It counts a DIFFERENT
// completed disc of the same album — never the disc itself, never an unfinished rip.
func TestOtherDiscOfAlbumRipped(t *testing.T) {
	t.Cleanup(resetDiscMemory)
	seed := func(recs ...*DiscIdentityRecord) {
		discMemory.mu.Lock()
		discMemory.loaded = true // skip the disk load; populate the ledger in-memory
		discMemory.all = nil
		discMemory.all = append(discMemory.all, recs...)
		discMemory.mu.Unlock()
	}
	discA := &DiscIdentityRecord{MBDiscID: "discA", Album: "Hozier", AlbumArtist: "Hozier", RipComplete: true}
	discB := &DiscIdentityRecord{MBDiscID: "discB", Album: "Hozier", AlbumArtist: "Hozier", RipComplete: true}

	// A lone ripped disc has no sibling — the label stays hidden.
	seed(discA)
	if otherDiscOfAlbumRipped("discA", "Hozier", "Hozier") {
		t.Error("a lone ripped disc has no sibling in the set, want false")
	}
	// A second, different disc of the same album → each is the other's sibling.
	seed(discA, discB)
	if !otherDiscOfAlbumRipped("discA", "Hozier", "Hozier") {
		t.Error("disc B completes the set for A, want true")
	}
	if !otherDiscOfAlbumRipped("discB", "Hozier", "Hozier") {
		t.Error("disc A completes the set for B, want true")
	}
	// A different album is not this set.
	if otherDiscOfAlbumRipped("discA", "Unreal Unearth", "Hozier") {
		t.Error("a different album is not a sibling disc, want false")
	}
	// An unfinished sibling rip does not count until it completes.
	seed(discA, &DiscIdentityRecord{MBDiscID: "discB", Album: "Hozier", AlbumArtist: "Hozier", RipComplete: false})
	if otherDiscOfAlbumRipped("discA", "Hozier", "Hozier") {
		t.Error("an incomplete sibling rip does not yet count, want false")
	}
}

// The interrupted-rip marker is written when a rip starts and cleared when it
// finalizes; only a marker that outlives its rip (a kill before finalize) surfaces
// as a notice on the next startup, and a dismiss makes it stay gone.
func TestInterruptedRipMarkerLifecycle(t *testing.T) {
	old := sidecarDataDir
	t.Cleanup(func() { sidecarDataDir = old; interruptedNotice.Store(nil) })
	sidecarDataDir = t.TempDir()
	interruptedNotice.Store(nil)

	rel := &MatchedRelease{Album: "Z Album", AlbumArtist: "Z Artist", TrackCount: 12}

	// No marker → nothing surfaced.
	detectInterruptedRip()
	if interruptedNotice.Load() != nil {
		t.Fatal("no marker should yield no notice")
	}

	// Rip starts (marker), then dies before finalize → next startup surfaces it.
	writeRipMarker(rel)
	detectInterruptedRip()
	n := interruptedNotice.Load()
	if n == nil || n.Album != "Z Album" || n.TrackCount != 12 {
		t.Fatalf("interrupted rip not surfaced: %+v", n)
	}

	// Dismiss clears it for good.
	dismissInterruptedRip()
	detectInterruptedRip()
	if interruptedNotice.Load() != nil {
		t.Fatal("dismissed marker must not resurface")
	}

	// A finalized rip (clearRipMarker) never looks interrupted.
	writeRipMarker(rel)
	clearRipMarker()
	interruptedNotice.Store(nil)
	detectInterruptedRip()
	if interruptedNotice.Load() != nil {
		t.Fatal("a finalized rip must not look interrupted")
	}
}
