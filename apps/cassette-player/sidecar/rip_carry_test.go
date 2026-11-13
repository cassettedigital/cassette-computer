package main

import "testing"

// tocForDurations builds a tocRaw whose per-track durations (seconds) are exactly
// `durs`, using a 150-frame lead-in and 75 frames/sec.
func tocForDurations(durs ...int) tocRaw {
	offsets := make([]int, len(durs))
	cur := 150
	for i, d := range durs {
		offsets[i] = cur
		cur += d * 75
	}
	return tocRaw{FirstTrack: 1, LastTrack: len(durs), LeadoutOffset: cur, TrackOffsets: offsets}
}

func loadDiscMemoryFixture(recs ...*DiscIdentityRecord) {
	discMemory.mu.Lock()
	defer discMemory.mu.Unlock()
	discMemory.loaded = true
	discMemory.byMBDisc = map[string]*DiscIdentityRecord{}
	discMemory.byFreedb = map[string]*DiscIdentityRecord{}
	discMemory.byTOCSig = map[string]*DiscIdentityRecord{}
	discMemory.byRecording = map[string][]*DiscIdentityRecord{}
	discMemory.all = nil
	for _, r := range recs {
		discMemory.indexRecord(r)
	}
}

func carryStrPtr(s string) *string { return &s }

// Good tags: the album name matches a record → identity + per-track disc position.
func TestCarryDiscIdentity_AlbumMatch(t *testing.T) {
	loadDiscMemoryFixture(&DiscIdentityRecord{
		MBDiscID: "DISC_EVE6", ReleaseMBID: "REL_EVE6",
		Album: "It's All in Your Head", AlbumArtist: "Eve 6",
		TOCRaw: tocForDurations(180, 200, 220),
	})
	tracks := []librarySyncTrack{
		{SubsonicTrackID: "1", TrackTitle: "A", ArtistName: "Eve 6", AlbumName: "It's All in Your Head", AlbumArtist: carryStrPtr("Eve 6"), DurationSeconds: 180},
		{SubsonicTrackID: "2", TrackTitle: "B", ArtistName: "Eve 6", AlbumName: "It's All in Your Head", AlbumArtist: carryStrPtr("Eve 6"), DurationSeconds: 200},
		{SubsonicTrackID: "3", TrackTitle: "C", ArtistName: "Eve 6", AlbumName: "It's All in Your Head", AlbumArtist: carryStrPtr("Eve 6"), DurationSeconds: 220},
	}
	carryDiscIdentity(tracks)
	for i, want := range []int{1, 2, 3} {
		if tracks[i].MBDiscID == nil || *tracks[i].MBDiscID != "DISC_EVE6" {
			t.Fatalf("track %d: mb_disc_id not attached (%v)", i, tracks[i].MBDiscID)
		}
		if tracks[i].DiscTrackIndex == nil || *tracks[i].DiscTrackIndex != want {
			t.Fatalf("track %d: disc position = %v, want %d", i, tracks[i].DiscTrackIndex, want)
		}
	}
}

// The Stage-2 criterion: re-rip with PLACEHOLDER tags (garbage album/artist, no
// MBID). Only duration survives → the duration-vector fallback must still attach
// the correct disc id + positions, so the tombstone re-keys correctly.
func TestCarryDiscIdentity_PlaceholderTagsDurationFallback(t *testing.T) {
	loadDiscMemoryFixture(&DiscIdentityRecord{
		MBDiscID: "DISC_EVE6", ReleaseMBID: "REL_EVE6",
		Album: "It's All in Your Head", AlbumArtist: "Eve 6",
		TOCRaw: tocForDurations(180, 200, 220),
	})
	tracks := []librarySyncTrack{
		{SubsonicTrackID: "1", TrackTitle: "Track 01", ArtistName: "Unknown Artist", AlbumName: "Unknown Album", DurationSeconds: 180},
		{SubsonicTrackID: "2", TrackTitle: "Track 02", ArtistName: "Unknown Artist", AlbumName: "Unknown Album", DurationSeconds: 200},
		{SubsonicTrackID: "3", TrackTitle: "Track 03", ArtistName: "Unknown Artist", AlbumName: "Unknown Album", DurationSeconds: 220},
	}
	carryDiscIdentity(tracks)
	for i, want := range []int{1, 2, 3} {
		if tracks[i].MBDiscID == nil || *tracks[i].MBDiscID != "DISC_EVE6" {
			t.Fatalf("placeholder track %d: mb_disc_id not attached via duration fallback (%v)", i, tracks[i].MBDiscID)
		}
		if tracks[i].DiscTrackIndex == nil || *tracks[i].DiscTrackIndex != want {
			t.Fatalf("placeholder track %d: disc position = %v, want %d", i, tracks[i].DiscTrackIndex, want)
		}
	}
}

// Two albums with different TOCs: a garbage-tagged group must receive the disc id
// of the album whose DURATIONS align — never the other (no over-suppression) —
// and a group that aligns with nothing must receive no identity at all.
func TestCarryDiscIdentity_NoOverSuppression(t *testing.T) {
	loadDiscMemoryFixture(
		&DiscIdentityRecord{MBDiscID: "DISC_A", Album: "A", AlbumArtist: "X", TOCRaw: tocForDurations(180, 200, 220)},
		&DiscIdentityRecord{MBDiscID: "DISC_B", Album: "B", AlbumArtist: "Y", TOCRaw: tocForDurations(100, 110, 120)},
	)
	groupB := []librarySyncTrack{
		{SubsonicTrackID: "1", AlbumName: "garbage", DurationSeconds: 100},
		{SubsonicTrackID: "2", AlbumName: "garbage", DurationSeconds: 110},
		{SubsonicTrackID: "3", AlbumName: "garbage", DurationSeconds: 120},
	}
	carryDiscIdentity(groupB)
	for i := range groupB {
		if groupB[i].MBDiscID == nil || *groupB[i].MBDiscID != "DISC_B" {
			t.Fatalf("track %d: want DISC_B via duration, got %v", i, groupB[i].MBDiscID)
		}
	}

	noMatch := []librarySyncTrack{{SubsonicTrackID: "9", AlbumName: "garbage", DurationSeconds: 999}}
	carryDiscIdentity(noMatch)
	if noMatch[0].MBDiscID != nil {
		t.Fatalf("unmatched track wrongly got mb_disc_id %v", *noMatch[0].MBDiscID)
	}
}

// A disc whose last physical track is much longer than the song (a silent
// hidden-track tail). The rip captures only the song, so its duration is SHORTER
// than the TOC position. The carry must still link (forgiving ONE contained
// track), and map the song to its real position via the recording MBID — not to
// a closer-duration position.
func TestCarryDiscIdentity_HiddenTrackTail(t *testing.T) {
	loadDiscMemoryFixture(&DiscIdentityRecord{
		MBDiscID: "DISC_H", Album: "H", AlbumArtist: "Z",
		TOCRaw: tocForDurations(180, 200, 420), // track 3 physical = 7:00
		TrackRecordings: []TrackRecording{
			{Position: 1, RecordingMBID: "rec-1"},
			{Position: 2, RecordingMBID: "rec-2"},
			{Position: 3, RecordingMBID: "rec-3"},
		},
	})
	group := []librarySyncTrack{
		{SubsonicTrackID: "1", AlbumName: "H", DurationSeconds: 180, MusicBrainzRecordingID: carryStrPtr("rec-1")},
		{SubsonicTrackID: "2", AlbumName: "H", DurationSeconds: 200, MusicBrainzRecordingID: carryStrPtr("rec-2")},
		{SubsonicTrackID: "3", AlbumName: "H", DurationSeconds: 260, MusicBrainzRecordingID: carryStrPtr("rec-3")}, // song 4:20, physical 7:00
	}
	carryDiscIdentity(group)
	for i := range group {
		if group[i].MBDiscID == nil || *group[i].MBDiscID != "DISC_H" {
			t.Fatalf("track %d: hidden-track album should carry DISC_H, got %v", i, group[i].MBDiscID)
		}
	}
	if group[2].DiscTrackIndex == nil || *group[2].DiscTrackIndex != 3 {
		t.Fatalf("hidden-track song should map to disc position 3 via MBID, got %v", group[2].DiscTrackIndex)
	}
}
