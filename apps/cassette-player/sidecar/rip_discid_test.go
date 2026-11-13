package main

import "testing"

// Ground-truth fixture pulled from MusicBrainz: Radiohead — OK Computer, the
// 12-track CD whose disc carries these exact offsets + Disc ID (release
// 4b3d18cc-8937-36f4-8de0-481088be58e6, medium 1, disc 1zOfzhFgYPD05pEMZa8j5o.dR.g-).
// Lets us validate the whole TOC → Disc ID → MusicBrainz lookup → tracklist
// chain WITHOUT a physical disc.
var fixtureTOC = TOC{
	FirstTrack:    1,
	LastTrack:     12,
	LeadoutOffset: 242041,
	TrackOffsets: []int{
		150, 21632, 50476, 70697, 90709, 113245,
		133019, 141971, 159413, 180955, 198196, 217701,
	},
}

const fixtureDiscID = "1zOfzhFgYPD05pEMZa8j5o.dR.g-"

func TestDiscIDComputation(t *testing.T) {
	got, err := fixtureTOC.DiscID()
	if err != nil {
		t.Fatalf("DiscID() error: %v", err)
	}
	if got != fixtureDiscID {
		t.Fatalf("Disc ID mismatch:\n  got  %s\n  want %s", got, fixtureDiscID)
	}
	t.Logf("Disc ID computed correctly: %s", got)
}

// Live: confirm the computed Disc ID resolves on MusicBrainz to a real release
// with the right track count and a usable per-track tag mapping. Skips (does
// not fail) if the network is unavailable.
func TestDiscIDLiveLookup(t *testing.T) {
	discID, err := fixtureTOC.DiscID()
	if err != nil {
		t.Fatal(err)
	}
	n := fixtureTOC.LastTrack - fixtureTOC.FirstTrack + 1
	best, candidates, err := lookupDiscID(discID, n)
	if err != nil {
		t.Skipf("live MusicBrainz lookup unavailable: %v", err)
	}
	if best.TrackCount != n {
		t.Errorf("matched release track count = %d, TOC has %d", best.TrackCount, n)
	}
	if len(best.Tracks) == 0 || best.Tracks[0].RecordingMBID == "" {
		t.Errorf("expected per-track recording MBIDs, got %+v", best.Tracks)
	}
	t.Logf("MB matched %d release candidate(s)", len(candidates))
	t.Logf("best: %q by %q (%s) — %d tracks, release %s",
		best.Album, best.AlbumArtist, best.Date, best.TrackCount, best.ReleaseMBID)
	for _, tr := range best.Tracks {
		t.Logf("  %2d. %-40s  %s  [%s]", tr.Position, tr.Title, tr.Artist, tr.RecordingMBID)
	}
}
