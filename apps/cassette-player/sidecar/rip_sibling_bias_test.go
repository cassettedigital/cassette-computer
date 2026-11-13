package main

import (
	"encoding/json"
	"fmt"
	"testing"
)

// The multi-disc SIBLING BIAS (BUG-261): when a completed disc of a multi-disc set
// is already in the library, a later disc of that set is steered onto the SAME
// MusicBrainz release, so both discs share one release id and get consistent,
// non-colliding disc numbers — instead of one disc matching a coincidental
// standalone single-disc release of the same album.

func siblingRel(mbid string, mediumCount, mediumPos int, durs []int) *MatchedRelease {
	m := &MatchedRelease{
		ReleaseMBID: mbid, Album: "Song Machine", AlbumArtist: "Gorillaz",
		MediumCount: mediumCount, MediumPos: mediumPos, TrackCount: len(durs),
	}
	for i, d := range durs {
		m.Tracks = append(m.Tracks, RippedTrackMeta{Position: i + 1, Title: fmt.Sprintf("T%d", i+1), LengthMs: d})
	}
	return m
}

func cand(rel *MatchedRelease, conf float64, source string) *RipScoredCandidate {
	return &RipScoredCandidate{Release: rel, Confidence: conf, Source: source, Sources: []string{source}}
}

// siblingMultiDiscRelease returns the release a COMPLETED, MULTI-disc sibling of
// this album resolved to — the anchor for the set. It excludes this disc, an
// unfinished rip, a single-disc sibling, and a different album.
func TestSiblingMultiDiscRelease(t *testing.T) {
	t.Cleanup(resetDiscMemory)
	seed := func(recs ...*DiscIdentityRecord) {
		discMemory.mu.Lock()
		discMemory.loaded = true
		discMemory.all = append([]*DiscIdentityRecord(nil), recs...)
		discMemory.mu.Unlock()
	}
	multi := &DiscIdentityRecord{MBDiscID: "discOTHER", Album: "Song Machine", AlbumArtist: "Gorillaz",
		ReleaseMBID: "DELUXE", MediumCount: 2, RipComplete: true}

	// Empty ledger — no anchor.
	seed()
	if got := siblingMultiDiscRelease("discTHIS", "Song Machine", "Gorillaz"); got != "" {
		t.Errorf("empty ledger: got %q, want \"\"", got)
	}
	// A completed multi-disc sibling → its release is the anchor.
	seed(multi)
	if got := siblingMultiDiscRelease("discTHIS", "Song Machine", "Gorillaz"); got != "DELUXE" {
		t.Errorf("multi-disc sibling: got %q, want DELUXE", got)
	}
	// The same physical disc is not its own sibling.
	if got := siblingMultiDiscRelease("discOTHER", "Song Machine", "Gorillaz"); got != "" {
		t.Errorf("same disc id must be excluded: got %q, want \"\"", got)
	}
	// A single-disc sibling is not a set anchor.
	seed(&DiscIdentityRecord{MBDiscID: "discOTHER", Album: "Song Machine", AlbumArtist: "Gorillaz",
		ReleaseMBID: "STANDALONE", MediumCount: 1, RipComplete: true})
	if got := siblingMultiDiscRelease("discTHIS", "Song Machine", "Gorillaz"); got != "" {
		t.Errorf("single-disc sibling must not anchor: got %q, want \"\"", got)
	}
	// An unfinished multi-disc sibling does not yet count.
	seed(&DiscIdentityRecord{MBDiscID: "discOTHER", Album: "Song Machine", AlbumArtist: "Gorillaz",
		ReleaseMBID: "DELUXE", MediumCount: 2, RipComplete: false})
	if got := siblingMultiDiscRelease("discTHIS", "Song Machine", "Gorillaz"); got != "" {
		t.Errorf("incomplete sibling must not anchor: got %q, want \"\"", got)
	}
	// A different album is not this set.
	seed(multi)
	if got := siblingMultiDiscRelease("discTHIS", "Demon Days", "Gorillaz"); got != "" {
		t.Errorf("different album must not anchor: got %q, want \"\"", got)
	}
}

// The reported failure: disc 1 matched a STANDALONE single-disc release by its own
// disc id (confidence 1.0), while disc 2 (ripped first) resolved to the DELUXE
// 2-disc release. With disc 2 in the library, disc 1 must be steered onto the
// DELUXE so the set shares one identity — overriding even the 1.0 standalone match.
func TestApplySiblingSetBiasPromotesSetRelease(t *testing.T) {
	t.Cleanup(resetDiscMemory)
	discMemory.mu.Lock()
	discMemory.loaded = true
	discMemory.all = []*DiscIdentityRecord{{
		MBDiscID: "disc2", Album: "Song Machine", AlbumArtist: "Gorillaz",
		ReleaseMBID: "DELUXE", MediumCount: 2, MediumPos: 2, RipComplete: true,
	}}
	discMemory.mu.Unlock()

	toc := []int{200000, 210000, 220000}
	standalone := siblingRel("STANDALONE", 1, 1, toc) // disc-1 audio, single-disc release
	deluxe := siblingRel("DELUXE", 2, 1, toc)         // same audio as medium 1 of the set
	res := &RipResolution{
		Release: standalone, Confidence: 1.0,
		Candidates: []*RipScoredCandidate{cand(standalone, 1.0, "discid"), cand(deluxe, 0.85, "gnudb")},
	}
	profile := &DiscProfile{MBDiscID: "disc1", TrackCount: len(toc), DurationsMs: toc}

	applySiblingSetBias(res, profile, toc, "disc1", nil)

	if res.Release == nil || res.Release.ReleaseMBID != "DELUXE" {
		t.Fatalf("winner should be steered to the set release DELUXE, got %+v", res.Release)
	}
	if res.Candidates[0].Release.ReleaseMBID != "DELUXE" || res.Candidates[0].Source != "sibling_set" {
		t.Errorf("top candidate should be the sibling_set DELUXE, got source=%q mbid=%q",
			res.Candidates[0].Source, res.Candidates[0].Release.ReleaseMBID)
	}
	// The standalone is not lost — it stays available as an alternative, once.
	seen := map[string]int{}
	for _, c := range res.Candidates {
		seen[c.Release.ReleaseMBID]++
	}
	if seen["STANDALONE"] != 1 || seen["DELUXE"] != 1 {
		t.Errorf("each release should appear exactly once, got %v", seen)
	}
}

// No multi-disc sibling in the library → the resolution is left exactly as it was
// (the common single-disc case pays nothing and changes nothing).
func TestApplySiblingSetBiasNoSiblingIsNoop(t *testing.T) {
	t.Cleanup(resetDiscMemory)
	resetDiscMemory()
	discMemory.mu.Lock()
	discMemory.loaded = true
	discMemory.mu.Unlock()

	toc := []int{200000, 210000, 220000}
	standalone := siblingRel("STANDALONE", 1, 1, toc)
	res := &RipResolution{Release: standalone, Confidence: 1.0,
		Candidates: []*RipScoredCandidate{cand(standalone, 1.0, "discid")}}
	applySiblingSetBias(res, &DiscProfile{MBDiscID: "disc1", DurationsMs: toc}, toc, "disc1", nil)

	if res.Release.ReleaseMBID != "STANDALONE" || len(res.Candidates) != 1 {
		t.Errorf("no sibling should leave the resolution untouched, got %+v", res)
	}
}

// A multi-disc sibling exists, but THIS disc's durations don't align to the pooled
// set release — so the bias refuses to force it (no misattachment); the original
// winner stands.
func TestApplySiblingSetBiasWeakAlignDoesNotOverride(t *testing.T) {
	t.Cleanup(resetDiscMemory)
	discMemory.mu.Lock()
	discMemory.loaded = true
	discMemory.all = []*DiscIdentityRecord{{
		MBDiscID: "disc2", Album: "Song Machine", AlbumArtist: "Gorillaz",
		ReleaseMBID: "DELUXE", MediumCount: 2, RipComplete: true,
	}}
	discMemory.mu.Unlock()

	toc := []int{200000, 210000, 220000}
	standalone := siblingRel("STANDALONE", 1, 1, toc)
	// Pooled DELUXE candidate whose durations are wildly off this disc (> zero-credit).
	deluxeOff := siblingRel("DELUXE", 2, 1, []int{500000, 510000, 520000})
	res := &RipResolution{Release: standalone, Confidence: 1.0,
		Candidates: []*RipScoredCandidate{cand(standalone, 1.0, "discid"), cand(deluxeOff, 0.4, "gnudb")}}
	applySiblingSetBias(res, &DiscProfile{MBDiscID: "disc1", DurationsMs: toc}, toc, "disc1", nil)

	if res.Release.ReleaseMBID != "STANDALONE" {
		t.Errorf("a disc that doesn't align to the set release must not be steered onto it, got %q",
			res.Release.ReleaseMBID)
	}
}

// bestMediumForDisc picks the medium that IS this disc: the disc-id medium when R
// lists it, else the track-count match with the best duration fit; nil when no
// medium matches the track count (so the caller refuses rather than forcing one).
func TestBestMediumForDisc(t *testing.T) {
	var rel mbRelease
	if err := json.Unmarshal([]byte(`{
		"id":"DELUXE","title":"Song Machine","artist-credit":[{"name":"Gorillaz"}],
		"media":[
			{"position":1,"discs":[{"id":"dX"}],"tracks":[
				{"position":1,"length":200000},{"position":2,"length":210000},{"position":3,"length":220000}]},
			{"position":2,"tracks":[{"position":1,"length":180000},{"position":2,"length":190000}]},
			{"position":3,"tracks":[
				{"position":1,"length":600000},{"position":2,"length":610000},{"position":3,"length":620000}]}
		]}`), &rel); err != nil {
		t.Fatal(err)
	}
	toc3 := []int{200000, 210000, 220000}

	// Track-count match, best duration fit — medium 1 aligns, medium 3 (same count) doesn't.
	if med := bestMediumForDisc(rel, "", 3, toc3); med == nil || med.Position != 1 {
		t.Errorf("3-track disc should pick medium 1 (best duration fit), got %+v", med)
	}
	// A different track count picks the other disc.
	if med := bestMediumForDisc(rel, "", 2, []int{180000, 190000}); med == nil || med.Position != 2 {
		t.Errorf("2-track disc should pick medium 2, got %+v", med)
	}
	// No medium has this track count → refuse.
	if med := bestMediumForDisc(rel, "", 5, []int{1, 2, 3, 4, 5}); med != nil {
		t.Errorf("no 5-track medium should return nil, got %+v", med)
	}
	// Disc id is unambiguous even when the track count would point elsewhere.
	if med := bestMediumForDisc(rel, "dX", 2, []int{180000, 190000}); med == nil || med.Position != 1 {
		t.Errorf("disc id dX should force medium 1 regardless of track count, got %+v", med)
	}
}
