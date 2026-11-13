package main

import "testing"

// A partial rip (fewer tracks than the disc — e.g. an interrupted rip) must STILL
// carry correct disc positions for the tracks it managed to rip, so the cloud
// orders them by disc position instead of falling back to alphabetical-by-title.
func TestCarryDiscIdentity_PartialRipCarriesOrder(t *testing.T) {
	loadDiscMemoryFixture(&DiscIdentityRecord{
		MBDiscID: "DISC_P", Album: "P", AlbumArtist: "Z",
		TOCRaw: tocForDurations(180, 200, 220, 240, 260), // 5-track disc
		TrackRecordings: []TrackRecording{
			{Position: 1, RecordingMBID: "rec-1"},
			{Position: 2, RecordingMBID: "rec-2"},
			{Position: 3, RecordingMBID: "rec-3"},
			{Position: 4, RecordingMBID: "rec-4"},
			{Position: 5, RecordingMBID: "rec-5"},
		},
	})
	// Only 3 of 5 tracks ripped, correctly tagged + MBID'd.
	group := []librarySyncTrack{
		{SubsonicTrackID: "1", AlbumName: "P", DurationSeconds: 180, MusicBrainzRecordingID: carryStrPtr("rec-1")},
		{SubsonicTrackID: "2", AlbumName: "P", DurationSeconds: 200, MusicBrainzRecordingID: carryStrPtr("rec-2")},
		{SubsonicTrackID: "3", AlbumName: "P", DurationSeconds: 220, MusicBrainzRecordingID: carryStrPtr("rec-3")},
	}
	carryDiscIdentity(group)
	for i, want := range []int{1, 2, 3} {
		if group[i].MBDiscID == nil || *group[i].MBDiscID != "DISC_P" {
			t.Fatalf("partial track %d: mb_disc_id not carried: %v", i, group[i].MBDiscID)
		}
		if group[i].DiscTrackIndex == nil || *group[i].DiscTrackIndex != want {
			t.Fatalf("partial track %d: disc position = %v, want %d", i, group[i].DiscTrackIndex, want)
		}
	}
}

// The partial path is GATED on identity: a short, garbage-tagged group with no
// album/MBID link must NOT latch onto a longer record just because durations line
// up (that would over-suppress a different disc on delete).
func TestCarryDiscIdentity_PartialNoIdentityNoCarry(t *testing.T) {
	loadDiscMemoryFixture(&DiscIdentityRecord{
		MBDiscID: "DISC_P", Album: "P", AlbumArtist: "Z",
		TOCRaw:          tocForDurations(180, 200, 220, 240, 260),
		TrackRecordings: []TrackRecording{{Position: 1, RecordingMBID: "rec-1"}},
	})
	group := []librarySyncTrack{
		{SubsonicTrackID: "9", AlbumName: "garbage", DurationSeconds: 180},
		{SubsonicTrackID: "10", AlbumName: "garbage", DurationSeconds: 200},
	}
	carryDiscIdentity(group)
	if group[0].MBDiscID != nil {
		t.Fatalf("garbage partial must not latch onto a longer record: %v", *group[0].MBDiscID)
	}
}
