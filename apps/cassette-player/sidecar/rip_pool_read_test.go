package main

import "testing"

// A 3-track TOC for building the pooled release.
func poolTestTOC() *TOC {
	return &TOC{
		FirstTrack:    1,
		LastTrack:     3,
		LeadoutOffset: 150 + 3*180*75,
		TrackOffsets:  []int{150, 150 + 180*75, 150 + 360*75},
	}
}

func poolHit(decision string) *sharedPoolHit {
	return &sharedPoolHit{
		Found:       true,
		MBDiscID:    "DISC_POOL",
		ReleaseMBID: "REL_POOL",
		Album:       "Pooled Album",
		AlbumArtist: "Pooled Artist",
		Decision:    decision,
		Confidence:  0.95,
		TrackRecordings: []TrackRecording{
			{Position: 1, Title: "One", RecordingMBID: "r1"},
			{Position: 2, Title: "Two", RecordingMBID: "r2"},
			{Position: 3, Title: "Three", RecordingMBID: "r3"},
		},
	}
}

// BUG-1011: a strong consensus ('auto', >=2 agreeing accounts) is still only a
// hint. It ranks above a single voice but stays below the auto-select bar, so the
// pool alone can never pick; the release is rebuilt from the pooled crosswalk.
func TestPoolRungCandidate_ConsensusIsHintNotPick(t *testing.T) {
	cand := poolRungCandidate(poolHit("auto"), poolTestTOC())
	if cand == nil {
		t.Fatal("consensus hit must yield a hint candidate")
	}
	if cand.Confidence != sharedPoolConsensusConfidence {
		t.Errorf("consensus confidence = %v, want %v", cand.Confidence, sharedPoolConsensusConfidence)
	}
	if cand.Confidence >= confidenceAutoSelect {
		t.Errorf("a pool answer must stay below auto-select (%v): got %v", confidenceAutoSelect, cand.Confidence)
	}
	if cand.Confidence <= sharedPoolSuggestConfidence {
		t.Errorf("a strong consensus should rank above a single voice: %v <= %v", cand.Confidence, sharedPoolSuggestConfidence)
	}
	if cand.Source != sharedPoolSource {
		t.Errorf("source = %q, want shared_pool", cand.Source)
	}
	if cand.Release == nil || cand.Release.Album != "Pooled Album" || cand.Release.ReleaseMBID != "REL_POOL" {
		t.Errorf("release not rebuilt from hit: %+v", cand.Release)
	}
	if len(cand.Release.Tracks) != 3 || cand.Release.Tracks[0].Title != "One" {
		t.Errorf("tracks not rebuilt from TOC + crosswalk: %+v", cand.Release.Tracks)
	}
}

// The cloud pins `decision` to "suggest" and sends the strength as `consensus`;
// a strong consensus read from either field ranks the same, and neither picks.
func TestPoolRungCandidate_ConsensusFieldRanksStrong(t *testing.T) {
	hit := poolHit("suggest")
	hit.Consensus = "auto"
	cand := poolRungCandidate(hit, poolTestTOC())
	if cand == nil || cand.Confidence != sharedPoolConsensusConfidence {
		t.Fatalf("consensus field must rank as strong: %+v", cand)
	}
}

// A 'suggest' consensus (one voice) is a sub-threshold hint.
func TestPoolRungCandidate_SuggestIsHint(t *testing.T) {
	cand := poolRungCandidate(poolHit("suggest"), poolTestTOC())
	if cand == nil {
		t.Fatal("suggest hit must yield a hint candidate")
	}
	if cand.Confidence != sharedPoolSuggestConfidence {
		t.Errorf("suggest confidence = %v, want %v", cand.Confidence, sharedPoolSuggestConfidence)
	}
	if cand.Confidence >= confidenceAutoSelect {
		t.Errorf("suggest hint must stay below auto-select (%v): got %v", confidenceAutoSelect, cand.Confidence)
	}
}

// An unknown/empty decision is treated as the single-voice level.
func TestPoolRungCandidate_UnknownDecisionIsSuggest(t *testing.T) {
	cand := poolRungCandidate(poolHit(""), poolTestTOC())
	if cand == nil || cand.Confidence != sharedPoolSuggestConfidence {
		t.Fatalf("unknown decision must be a suggest-level hint: cand=%v", cand)
	}
}

// A cross-pressing match (P5) is fuzzy (matched by duration, different pressing),
// so it stays at the single-voice level even when the sibling's consensus is strong.
func TestPoolRungCandidate_CrossPressingStaysSuggest(t *testing.T) {
	hit := poolHit("auto")
	hit.Consensus = "auto"
	hit.CrossPressing = true
	cand := poolRungCandidate(hit, poolTestTOC())
	if cand == nil {
		t.Fatal("cross-pressing hit must yield a hint candidate")
	}
	if cand.Confidence != sharedPoolSuggestConfidence {
		t.Errorf("cross-pressing confidence = %v, want suggest level %v", cand.Confidence, sharedPoolSuggestConfidence)
	}
}

// nil / empty-id hits yield no candidate (the ladder falls through to the network).
func TestPoolRungCandidate_NoHit(t *testing.T) {
	if cand := poolRungCandidate(nil, poolTestTOC()); cand != nil {
		t.Errorf("nil hit must yield nil, got %v", cand)
	}
	if cand := poolRungCandidate(&sharedPoolHit{Found: true, Decision: "auto"}, poolTestTOC()); cand != nil {
		t.Errorf("empty mb_disc_id must yield nil, got %v", cand)
	}
}

// ── BUG-1011: the pool vouches, this computer's own sources decide ───────────

// resolutionFrom runs the ladder's finalize step over a candidate pool and wraps
// it the way resolveDisc does, so Decision() reads as the person would see it.
func resolutionFrom(pool map[string]*RipScoredCandidate) *RipResolution {
	res := &RipResolution{Candidates: rankCandidates(pool)}
	if len(res.Candidates) > 0 {
		res.Release = res.Candidates[0].Release
		res.Confidence = res.Candidates[0].Confidence
	}
	return res
}

// The real release for the pooled disc, as one of the ladder's own sources would
// return it: the same MBID as the pool claims, but its own track titles.
func independentRelease() *MatchedRelease {
	return &MatchedRelease{
		ReleaseMBID: "REL_POOL", Album: "Pooled Album", AlbumArtist: "Pooled Artist", TrackCount: 3,
		Tracks: []RippedTrackMeta{
			{Position: 1, Title: "Real One"}, {Position: 2, Title: "Real Two"}, {Position: 3, Title: "Real Three"},
		},
	}
}

// A planted pool answer with nothing else naming the disc is a confirm card the
// person checks, never an auto-rip, even at the strongest consensus.
func TestPoolAnswerAloneNeverPicks(t *testing.T) {
	pool := map[string]*RipScoredCandidate{}
	cand := poolRungCandidate(poolHit("auto"), poolTestTOC())
	mergeCandidate(pool, cand.Release, sharedPoolSource, cand.Confidence)

	res := resolutionFrom(pool)
	if got := res.Decision(); got != "confirm" {
		t.Fatalf("a pool answer alone must be a confirm card, got %q at %v", got, res.Confidence)
	}
	if res.Release.Album != "Pooled Album" {
		t.Errorf("the pool answer should still be offered as the suggestion: %+v", res.Release)
	}
}

// When the disc's own MB disc id names the same release, it picks, and what gets
// tagged is MusicBrainz's titles, not the pool's.
func TestPoolAnswerPicksWithIndependentAgreement_IndependentWords(t *testing.T) {
	pool := map[string]*RipScoredCandidate{}
	cand := poolRungCandidate(poolHit("auto"), poolTestTOC())
	mergeCandidate(pool, cand.Release, sharedPoolSource, cand.Confidence)
	mergeCandidate(pool, independentRelease(), "discid", 1.0)

	res := resolutionFrom(pool)
	if got := res.Decision(); got != "auto" {
		t.Fatalf("pool + exact disc id should pick, got %q at %v", got, res.Confidence)
	}
	if res.Release.Tracks[0].Title != "Real One" {
		t.Errorf("titles must come from the independent source, got %q", res.Release.Tracks[0].Title)
	}
	if res.Candidates[0].Source != "discid" {
		t.Errorf("representative source = %q, want discid", res.Candidates[0].Source)
	}
}

// The pool cannot carry a weak independent match over the bar with its own
// confidence: the merged candidate stands on the independent score plus one boost.
func TestPoolCannotLiftWeakIndependentMatch(t *testing.T) {
	pool := map[string]*RipScoredCandidate{}
	cand := poolRungCandidate(poolHit("auto"), poolTestTOC())
	mergeCandidate(pool, cand.Release, sharedPoolSource, cand.Confidence)
	mergeCandidate(pool, independentRelease(), "mb-toc", 0.40)

	res := resolutionFrom(pool)
	if got := res.Decision(); got != "confirm" {
		t.Fatalf("pool + a weak match must stay a confirm card, got %q at %v", got, res.Confidence)
	}
	if want := corroborate(0.40); res.Confidence != want {
		t.Errorf("merged confidence = %v, want the independent score plus one boost (%v)", res.Confidence, want)
	}
	if res.Release.Tracks[0].Title != "Real One" {
		t.Errorf("titles must come from the independent source, got %q", res.Release.Tracks[0].Title)
	}
}

// Order does not matter: the pool arriving after the source it agrees with adds
// its vote but never its words or a higher confidence.
func TestPoolAgreementIsOrderIndependent(t *testing.T) {
	for _, poolFirst := range []bool{true, false} {
		pool := map[string]*RipScoredCandidate{}
		cand := poolRungCandidate(poolHit("auto"), poolTestTOC())
		addPool := func() { mergeCandidate(pool, cand.Release, sharedPoolSource, cand.Confidence) }
		if poolFirst {
			addPool()
		}
		mergeCandidate(pool, independentRelease(), "mb-toc", 0.72)
		if !poolFirst {
			addPool()
		}

		res := resolutionFrom(pool)
		if got := res.Decision(); got != "auto" {
			t.Fatalf("poolFirst=%v: a 0.72 match the pool agrees with should pick, got %q at %v", poolFirst, got, res.Confidence)
		}
		if want := corroborate(0.72); res.Confidence != want {
			t.Errorf("poolFirst=%v: confidence = %v, want %v", poolFirst, res.Confidence, want)
		}
		if res.Release.Tracks[0].Title != "Real One" || res.Candidates[0].Source != "mb-toc" {
			t.Errorf("poolFirst=%v: words/source must be mb-toc's, got %q from %q",
				poolFirst, res.Release.Tracks[0].Title, res.Candidates[0].Source)
		}
	}
}

// Two of this computer's own sources agreeing behave exactly as before: the
// better release stands and the pair is boosted.
func TestMergeCandidate_IndependentSourcesUnchanged(t *testing.T) {
	pool := map[string]*RipScoredCandidate{}
	gnudbRel := &MatchedRelease{Album: "Pooled Album", AlbumArtist: "Pooled Artist", TrackCount: 3}
	mbRel := &MatchedRelease{Album: "Pooled Album", AlbumArtist: "Pooled Artist", TrackCount: 3, Date: "2001"}
	mergeCandidate(pool, gnudbRel, "gnudb", 0.62)
	mergeCandidate(pool, mbRel, "cdtext", 0.70)

	res := resolutionFrom(pool)
	if res.Release != mbRel || res.Confidence != corroborate(0.70) || res.Decision() != "auto" {
		t.Fatalf("independent corroboration changed: rel=%+v conf=%v decision=%q", res.Release, res.Confidence, res.Decision())
	}
}
