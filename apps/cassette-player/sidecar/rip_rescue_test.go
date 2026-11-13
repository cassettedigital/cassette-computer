package main

import "testing"

// buildBleedAmericanRelease is the clean MusicBrainz release as an MB *name* search
// would return it: a real release MBID, the correct (untruncated) artist, and
// per-track durations that align exactly with the disc — so scoreCandidate credits
// a full duration match (which rung 5 then caps into the confirm band).
func buildBleedAmericanRelease(toc *TOC) *MatchedRelease {
	durs := tocTrackDurationsMs(toc)
	rel := &MatchedRelease{
		ReleaseMBID: "21030f55-e616-466a-a3d5-16c9817bca81",
		Album:       "Bleed American",
		AlbumArtist: "Jimmy Eat World",
		TrackCount:  len(durs),
	}
	for i, d := range durs {
		rel.Tracks = append(rel.Tracks, RippedTrackMeta{Position: i + 1, LengthMs: d})
	}
	return rel
}

// TestGnudbMBNameRescue_JimmyEatWorld replays the real "Bleed American" mislabel:
// MusicBrainz matched neither the disc ID nor the fuzzy TOC, and the disc carried
// no CD-TEXT — so the ONLY automatic candidate was gnudb's truncated, MBID-less
// "Jimmy Eat Worl" / "Bleed American". Rung 5 should search MB by that text and
// offer the clean, MBID-bearing release as a capped, confirm-tier candidate that
// outranks the messy gnudb card.
func TestGnudbMBNameRescue_JimmyEatWorld(t *testing.T) {
	toc := fixtureTOC
	tocDur := tocTrackDurationsMs(&toc)
	n := len(tocDur)

	// The pool as the earlier rungs left it: one gnudb hit, no MBID, artist truncated,
	// scored in the confirm band (which is why the picker showed at all).
	gnudbConf := gnudbInexactWeight // ~0.62
	gnudbRel := &MatchedRelease{Album: "Bleed American", AlbumArtist: "Jimmy Eat Worl", TrackCount: n}
	pool := map[string]*RipScoredCandidate{
		candidateKey(gnudbRel): {
			Release: gnudbRel, Confidence: gnudbConf, Source: "gnudb", Sources: []string{"gnudb"},
		},
	}

	clean := buildBleedAmericanRelease(&toc)

	// Stub the MB name search: the truncated artist whiffs (as MB's quoted-phrase
	// artist clause would), and the album-only fallback finds the release — exercising
	// exactly the fallback that rescues a truncated-artist disc.
	type call struct{ artist, album string }
	var calls []call
	searchFn := func(artist, album string, _ int) []*MatchedRelease {
		calls = append(calls, call{artist, album})
		if artist == "" && album == "Bleed American" {
			return []*MatchedRelease{clean}
		}
		return nil
	}

	var added []*RipScoredCandidate
	add := func(rel *MatchedRelease, source string, conf float64) {
		added = append(added, &RipScoredCandidate{Release: rel, Confidence: conf, Source: source})
	}

	gnudbMBNameRescue(pool, tocDur, nil, n, searchFn, add)

	// It tried the full (artist, album) query first, then the album-only fallback.
	if len(calls) != 2 || calls[0].artist != "Jimmy Eat Worl" || calls[1].artist != "" {
		t.Fatalf("want full search then album-only fallback, got %+v", calls)
	}
	if len(added) != 1 {
		t.Fatalf("want exactly one rescue candidate, got %d", len(added))
	}
	got := added[0]
	if got.Release.ReleaseMBID == "" || got.Release.AlbumArtist != "Jimmy Eat World" {
		t.Errorf("rescue should be the clean MBID-bearing release, got %q / mbid=%q",
			got.Release.AlbumArtist, got.Release.ReleaseMBID)
	}
	if got.Source != "gnudb_mb_rescue" {
		t.Errorf("source = %q, want gnudb_mb_rescue", got.Source)
	}
	// Capped below the auto bar — never a silent rip — yet above the gnudb card, so
	// the clean release becomes the default the user confirms with one tap.
	if got.Confidence > gnudbRescueConfirmCap {
		t.Errorf("confidence %.3f exceeds the confirm-tier cap %.3f", got.Confidence, gnudbRescueConfirmCap)
	}
	if got.Confidence >= confidenceAutoSelect {
		t.Errorf("confidence %.3f must stay below the auto-select bar %.3f", got.Confidence, confidenceAutoSelect)
	}
	if got.Confidence <= gnudbConf {
		t.Errorf("clean release (%.3f) should outrank the gnudb card (%.3f)", got.Confidence, gnudbConf)
	}
}

// TestGnudbMBNameRescue_SkippedWhenMBIDPresent proves the gate: a verified MBID
// candidate already in the pool means rung 5 does not fire — no search, nothing
// added. It only ever supplements a gnudb-only pool, never competes with a match.
func TestGnudbMBNameRescue_SkippedWhenMBIDPresent(t *testing.T) {
	toc := fixtureTOC
	tocDur := tocTrackDurationsMs(&toc)
	n := len(tocDur)
	pool := map[string]*RipScoredCandidate{
		"rel-x": {
			Release:    &MatchedRelease{ReleaseMBID: "rel-x", Album: "X", TrackCount: n},
			Confidence: 0.9,
		},
	}
	searched := false
	searchFn := func(_, _ string, _ int) []*MatchedRelease { searched = true; return nil }
	added := 0
	add := func(_ *MatchedRelease, _ string, _ float64) { added++ }

	gnudbMBNameRescue(pool, tocDur, nil, n, searchFn, add)

	if searched || added != 0 {
		t.Errorf("rung 5 fired despite an MBID candidate present (searched=%v added=%d)", searched, added)
	}
}

// TestGnudbMBNameRescue_NoSeed proves it is a clean no-op when nothing in the pool
// has an album to search on (e.g. an empty gnudb miss) — no search, nothing added.
func TestGnudbMBNameRescue_NoSeed(t *testing.T) {
	toc := fixtureTOC
	tocDur := tocTrackDurationsMs(&toc)
	n := len(tocDur)
	pool := map[string]*RipScoredCandidate{}
	searched := false
	searchFn := func(_, _ string, _ int) []*MatchedRelease { searched = true; return nil }
	added := 0
	add := func(_ *MatchedRelease, _ string, _ float64) { added++ }

	gnudbMBNameRescue(pool, tocDur, nil, n, searchFn, add)

	if searched || added != 0 {
		t.Errorf("rung 5 fired with an empty pool (searched=%v added=%d)", searched, added)
	}
}
