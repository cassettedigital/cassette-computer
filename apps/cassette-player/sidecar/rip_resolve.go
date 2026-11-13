// Multi-signal disc identification — the confidence ladder.
//
// The old path was single-signal: exact Disc ID lookup, and a 404 was a brick
// wall ("Couldn't identify this disc"). This replaces that with a scored ladder
// whose result is always one of three NON-dead-end states:
//
//	confidence >= confidenceAutoSelect     → auto-select, tag, rip
//	0 < confidence < confidenceAutoSelect  → ask the user to confirm, then rip
//	no usable candidate                    → IMPORT ANYWAY with a local identity
//
// Identification is metadata; it NEVER gates getting the audio into the library
// (see rip.go's import-anyway terminal). resolveDisc only decides *what to call*
// the disc, never *whether* to rip it.
//
// Candidate sources (each independent, scored by the same scorer, deduped by
// identity key) — structured so a new source plugs in as one more collector:
//
//	rung 0.5 shared pool (fetchSharedPoolIdentity): other accounts' answer, a hint only,
//	                     never a pick on its own (BUG-1011, see mergeCandidate)
//	rung 1  exact MB disc ID   (lookupDiscID)          — confidence 1.0 on a track-count match
//	rung 2  gnudb              (gnudbLookup)           — dense TOC-keyed source; the workhorse for
//	                                                     commercial discs MB has no disc ID for
//	rung 3  MB fuzzy TOC       (fuzzyTOCLookup)        — no text seed needed
//	rung 4  CD-TEXT search     (searchReleasesByCDText)— when the disc carries CD-TEXT
//	rung 5  gnudb→MB rescue    (searchReleasesByCDText)— when only gnudb named the disc (an MB
//	                                                     TOC-coverage hole): search MB by gnudb's
//	                                                     own text so the clean, cover-art release
//	                                                     is offered instead of gnudb's messy one

package main

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"log"
	"math"
	"sort"
	"strings"
)

// Tunable ladder constants — the weights and the auto-select threshold are
// named here, never inline, so the policy is legible and adjustable in one spot.
const (
	// confidenceAutoSelect is the bar for tag-and-rip without asking. At or
	// above it we trust the match; below it (but > 0) we ask the user to confirm.
	confidenceAutoSelect = 0.80

	// Scoring weights when CD-TEXT track titles are available to compare. They
	// sum to 1.0. Track COUNT is a hard gate (handled in scoreCandidate), not a
	// weight; album/artist are the search seed, not double-counted here.
	weightDurationAlignment = 0.60
	weightTitleAgreement    = 0.40

	// Per-track duration credit curve (milliseconds). A track whose release
	// duration is within full-credit of the TOC earns 1.0; at/beyond zero-credit
	// it earns 0; linear in between. CD pressings vary a little, so the band is
	// generous but still discriminating.
	durationFullCreditMs = 1500
	durationZeroCreditMs = 12000

	// maxCandidates is how many scored candidates we keep for the confirm list.
	maxCandidates = 4

	// localMemoryConfidence is a rung-zero hit's confidence: a disc we've
	// confirmed before is trusted (auto-selects), but kept just shy of a live
	// exact disc-ID (1.0) so a genuine re-identification can still override it.
	localMemoryConfidence = 0.97

	// Shared-pool (P4) hint confidences. A pool answer is other accounts' word,
	// reported by their own copies of this app, so it can be planted (BUG-1011):
	// on its own it NEVER picks, whatever the cloud's consensus says. Both levels
	// stay below confidenceAutoSelect, so a pool answer alone is a confirm-me card
	// the person checks. It becomes a pick only when one of THIS computer's own
	// sources (MB disc id, gnudb by TOC, MB fuzzy TOC, CD-TEXT search) names the
	// same release: mergeCandidate then keeps that source's words and confidence,
	// and the pool adds just the corroboration boost. A strong consensus (>=2
	// agreeing accounts) only ranks a little above a single voice in the list.
	sharedPoolConsensusConfidence = 0.78
	sharedPoolSuggestConfidence   = 0.70

	// corroborationBoost lifts a candidate that two or more INDEPENDENT sources
	// propose, capped at 1.0 (JOB 4). Agreement is stronger evidence than any
	// single API's score, so confidence rises above what either source alone earns.
	corroborationBoost = 0.12

	// gnudbRescueConfirmCap bounds a rung-5 gnudb→MB name-rescue candidate below
	// confidenceAutoSelect. gnudb text is community-submitted and can be truncated
	// (the very bug this rung rescues), so a name-search hit it drives is only ever
	// a confirm-me card the user approves — never a silent auto-rip. Kept above
	// gnudbInexactWeight (0.62) so a well-aligning clean release outranks the messy
	// gnudb card and becomes the default pick.
	gnudbRescueConfirmCap = confidenceAutoSelect - 0.05 // 0.75
)

// RipScoredCandidate pairs a candidate release with its computed confidence and
// the sources that produced it. Sources holds EVERY independent source that
// proposed this release (deduped) — the basis for the corroboration boost; Source
// is the representative (best) one, kept for logs/diagnostics and the contribution
// vocabulary.
type RipScoredCandidate struct {
	Release      *MatchedRelease
	Confidence   float64
	Source       string   // representative source: "discid" | "gnudb" | "mb-toc" | "cdtext" | "gnudb_mb_rescue" | "local_memory"
	Sources      []string // all independent sources that proposed this release
	Corroborated bool     // true once the multi-source boost has been applied (idempotency guard)
	// Gaps + Flagged + DroppedReleaseTitles come from duration alignment (manual-
	// search path): Gaps are disc track positions the release had no slot for (the
	// name-first flow targets them); Flagged are tracks named by position but with a
	// loose duration (a second look); DroppedReleaseTitles are release tracks the
	// disc lacks (e.g. an omitted interlude) — informational.
	Gaps                 []int    `json:",omitempty"`
	Flagged              []int    `json:",omitempty"`
	DroppedReleaseTitles []string `json:",omitempty"`
}

// RipResolution is the ladder's result: { release?, confidence, candidates[] }.
// Release is the best pick (nil when nothing scored above zero). Candidates is
// the top few, score-sorted, for the confirm UI. Profile carries the intrinsic
// disc profile (JOB 1) forward to the confirm + persist steps.
type RipResolution struct {
	Release    *MatchedRelease
	Confidence float64
	Candidates []*RipScoredCandidate
	Profile    *DiscProfile
}

// Decision collapses the resolution into the three terminal routes. This is the
// single source of truth for JOB 2's branching.
func (r *RipResolution) Decision() string {
	switch {
	case r.Release != nil && r.Confidence >= confidenceAutoSelect:
		return "auto"
	case r.Release != nil && r.Confidence > 0 && len(r.Candidates) > 0:
		return "confirm"
	default:
		return "import"
	}
}

// resolveDisc runs the ladder for one disc and returns the scored resolution
// plus the CD-TEXT it actually read (nil on the happy path — see below). It
// performs MusicBrainz I/O (rate-limited via mbGet) but never errors: a miss at
// every rung is a valid outcome (→ import-anyway), not a failure. The only
// genuine failures (TOC read, permissions) are handled upstream in
// detectAndResolve.
//
// readCT is invoked lazily — ONLY after rung 1 misses — so the exact-disc-ID
// happy path neither re-reads the disc for CD-TEXT nor pays for it. The returned
// CDText is what later import-anyway steps reuse (it's read exactly when an
// import-anyway outcome is reachable, never when rung 1 already matched).
func resolveDisc(toc *TOC, discID string, readCT func() *CDText) (*RipResolution, *DiscProfile) {
	profile := buildDiscProfile(toc, discID)
	tocDur := profile.DurationsMs
	n := profile.TrackCount

	// Rung ZERO — local memory. Before any network call, a disc we have
	// identified before is known instantly and offline. This is the loop closing:
	// every confirmed disc makes the next insert of it free.
	if rec, via := lookupMemory(profile); rec != nil {
		rel := rec.toMatchedRelease(toc, nil)
		// Title enrichment (when the remembered record lacks titles but has an MBID)
		// happens centrally in detectAndResolve via ensureRealTitles, AFTER any
		// cross-resolve has attached an MBID — so it isn't gated on the memory
		// record alone. Here we just hand back what memory holds.
		log.Printf("resolve: rung-zero local_memory hit (%s) — %q — %q", via, rel.AlbumArtist, rel.Album)
		cand := &RipScoredCandidate{
			Release: rel, Confidence: localMemoryConfidence,
			Source: "local_memory", Sources: []string{"local_memory"},
		}
		return &RipResolution{
			Release: rel, Confidence: localMemoryConfidence,
			Candidates: []*RipScoredCandidate{cand}, Profile: profile,
		}, profile
	}

	// Rung 0.5: the SHARED POOL. Local memory missed, but another account may have
	// already identified this exact disc. Ask the cross-user pool (one bounded,
	// fail-soft call to our own backend). Its answer is only ever a HINT (BUG-1011):
	// it never short-circuits the ladder, because the pool is other people's word and
	// a modified app can plant it. The network rungs below always run, and the hint
	// becomes a pick only if one of them names the same release.
	poolCand := poolRungCandidate(
		fetchSharedPoolIdentity(profile.MBDiscID, profile.TrackCount, tocDur), toc)

	// Collect + score from every source into one shared pool, deduped by identity
	// key (release MBID when present, else normalized artist|album). Nothing is
	// discarded silently: a second source proposing a pooled release merges as
	// corroboration rather than being dropped.
	pool := map[string]*RipScoredCandidate{}
	add := func(rel *MatchedRelease, source string, confidence float64) {
		if rel == nil || confidence <= 0 {
			return
		}
		rel.DiscID = discID // stamp the physical disc ID for tagging
		mergeCandidate(pool, rel, source, confidence)
	}

	// Seed the shared-pool hint as a sub-threshold candidate, so it shows in the
	// confirm list AND an independent network rung that proposes the same release
	// corroborates it (source set grows to >=2 → boosted in finalize, on that
	// rung's own confidence and words). On its own it stays a confirm-me card.
	if poolCand != nil {
		add(poolCand.Release, sharedPoolSource, poolCand.Confidence)
	}

	// Rung 1 — exact MB Disc ID. A track-count match is ground truth, but it is
	// now RECORDED as a pool entry (not a silent short-circuit) so a corroborating
	// source is visible. It does let us skip the slower MB-text rungs (3-4), since
	// the disc's own registered ID needs no fuzzy confirmation.
	discIDHit := false
	if best, _, err := lookupDiscID(discID, n); err == nil && best != nil && best.TrackCount == n {
		add(best, "discid", 1.0)
		discIDHit = true
	} else {
		profile.recordNegative("mb_disc_id", "not_found")
	}

	// CD-TEXT (best-effort) — read once, seeds rung 4 and names the import-anyway
	// terminal. Carried on the profile so the confirm/import steps reuse it.
	ct := readCT()
	profile.CDText = ct
	if ct == nil || ct.Album == "" {
		profile.recordNegative("cd_text", "absent")
	}

	// Rung 2 — gnudb (the dense TOC-keyed source). ALWAYS runs (no short-circuit),
	// so even a confident gnudb hit can be corroborated by — or corroborate — the
	// MB rungs rather than suppressing them.
	gnudbHits := 0
	for _, hit := range gnudbLookup(toc) {
		add(hit.release, "gnudb", gnudbConfidence(hit, tocDur))
		gnudbHits++
	}
	if gnudbHits == 0 {
		profile.recordNegative("gnudb", "no_match")
	}

	// Rungs 3-4 — MB fuzzy TOC + CD-TEXT search. Run UNLESS rung 1 already nailed
	// the disc by its own registered ID. When rung 1 missed, they always run (the
	// gnudb short-circuit is gone), so gnudb gets corroborated instead of trusted
	// blindly.
	if !discIDHit {
		mbHits := 0
		for _, rel := range fuzzyTOCLookup(toc) {
			add(rel, "mb-toc", scoreCandidate(rel, tocDur, ct))
			mbHits++
		}
		if mbHits == 0 {
			profile.recordNegative("mb_fuzzy_toc", "no_match")
		}
		if ct != nil && ct.Album != "" {
			for _, rel := range searchReleasesByCDText(ct.AlbumArtist, ct.Album, n) {
				add(rel, "cdtext", scoreCandidate(rel, tocDur, ct))
			}
		}
	}

	// Rung 5 — gnudb→MB name rescue. If NO source produced a MusicBrainz identity
	// (exact disc-ID missed, fuzzy-TOC missed, and there was no CD-TEXT to drive
	// rung 4) yet gnudb named the disc, this disc is a MusicBrainz TOC-coverage
	// hole: gnudb has it — often with messy or truncated text — and MB simply does
	// not know its TOC. Feed gnudb's own title/artist into the same MB name search
	// rung 4 uses, so the clean, MBID-bearing, cover-art release surfaces as its own
	// pickable candidate instead of forcing the user to search by hand.
	//
	// Two properties keep this a pure net-add — it can only ever offer MORE, never
	// change an outcome we already get right:
	//   - it runs ONLY when the pool holds no MBID candidate, so it never competes
	//     with or overrides a verified match, and never fires on the confident paths
	//     (disc-ID, corroborated auto) at all;
	//   - its results are capped below confidenceAutoSelect, so a name-search hit
	//     driven by community-submitted gnudb text is always a confirm-me card — the
	//     user approves it — never a silent auto-rip.
	gnudbMBNameRescue(pool, tocDur, ct, n, searchReleasesByCDText, add)

	// Finalize: apply the corroboration boost to any release ≥2 sources agree on,
	// keep candidates that cleared the hard gate (score > 0), best first, capped.
	cands := rankCandidates(pool)

	res := &RipResolution{Candidates: cands, Profile: profile}
	if len(cands) > 0 {
		res.Release = cands[0].Release
		res.Confidence = cands[0].Confidence
	}
	// BUG-261: when a completed sibling disc of a multi-disc set is already in the
	// library, steer this disc onto that same release, so both discs share one
	// release id and consistent, non-colliding disc numbers.
	applySiblingSetBias(res, profile, tocDur, discID, ct)
	return res, profile
}

// applySiblingSetBias steers a disc of a multi-disc SET onto the SAME MusicBrainz
// release its already-ripped sibling resolved to (BUG-261). Without it, disc 1 of a
// deluxe set can match a coincidental STANDALONE single-disc release of the same
// album by its own registered disc id, while disc 2 matched the deluxe — two
// releases for one physical set, and disc numbers that don't line up.
//
// Evidence-gated and forward-only. It acts ONLY when a completed sibling disc (same
// album, different disc id) resolved to a MULTI-disc release R, AND this disc's TOC
// actually aligns to one of R's media. It overrides the current pick only to
// replace a SINGLE-disc match at auto-tier alignment; a weaker fit joins the confirm
// list as an alternative instead. A disc that aligns to no medium of R is left
// untouched — never misattached. It cannot re-tag a sibling ripped before this one
// (that disc's files are the user's — the library-ownership rule); it only shapes
// the disc being resolved now.
func applySiblingSetBias(res *RipResolution, profile *DiscProfile, tocDur []int, discID string, ct *CDText) {
	if res == nil || res.Release == nil || profile == nil {
		return // no presumptive album to identify the set with
	}
	target := siblingMultiDiscRelease(discID, res.Release.Album, res.Release.AlbumArtist)
	if target == "" || target == res.Release.ReleaseMBID {
		return // no multi-disc sibling, or we already resolved to it
	}
	// Reuse a pooled candidate for the sibling release if one exists, else fetch its
	// matching medium (one bounded MB call, only on this rare set-reinsert path).
	var sib *MatchedRelease
	for _, c := range res.Candidates {
		if c.Release != nil && c.Release.ReleaseMBID == target {
			sib = c.Release
			break
		}
	}
	if sib == nil {
		sib = fetchReleaseMedium(target, profile.MBDiscID, len(tocDur), tocDur)
	}
	if sib == nil {
		return // the sibling release has no medium matching this disc — don't force
	}
	sib.DiscID = discID
	score := scoreCandidate(sib, tocDur, ct)
	if score <= 0 {
		return // this disc doesn't actually align to the sibling release
	}
	// The sibling in the library is physical corroboration this disc belongs to the
	// set. Override a coincidental SINGLE-disc match only when the disc aligns to the
	// sibling's medium at auto-tier; a weaker fit is offered as a confirm alternative.
	override := score >= confidenceAutoSelect && res.Release.MediumCount <= 1
	promoteSiblingCandidate(res, sib, corroborate(score), override)
}

// promoteSiblingCandidate places the sibling-set release into the resolution:
// at the front (and as the winner) when override is set, else merged into the
// confirm list by confidence. Any existing candidate for the same release is pulled
// out and re-inserted, so the set match never appears twice, and the winner + top-N
// cap are recomputed from the reordered list.
func promoteSiblingCandidate(res *RipResolution, sib *MatchedRelease, conf float64, override bool) {
	var cand *RipScoredCandidate
	kept := res.Candidates[:0]
	for _, c := range res.Candidates {
		if c.Release != nil && c.Release.ReleaseMBID == sib.ReleaseMBID {
			cand = c // pull out; re-inserted at the chosen position below
			continue
		}
		kept = append(kept, c)
	}
	res.Candidates = kept
	if cand == nil {
		cand = &RipScoredCandidate{Release: sib, Sources: []string{"sibling_set"}}
	} else {
		cand.Release = sib
		cand.Sources = addSource(cand.Sources, "sibling_set")
	}
	cand.Source = "sibling_set"
	if conf > cand.Confidence {
		cand.Confidence = conf
	}
	if override {
		res.Candidates = append([]*RipScoredCandidate{cand}, res.Candidates...)
	} else {
		res.Candidates = append(res.Candidates, cand)
		sort.SliceStable(res.Candidates, func(i, j int) bool {
			return res.Candidates[i].Confidence > res.Candidates[j].Confidence
		})
	}
	if len(res.Candidates) > maxCandidates {
		res.Candidates = res.Candidates[:maxCandidates]
	}
	if len(res.Candidates) > 0 {
		res.Release = res.Candidates[0].Release
		res.Confidence = res.Candidates[0].Confidence
	}
}

// sharedPoolSource names the shared disc pool (rung 0.5) in a candidate's sources.
const sharedPoolSource = "shared_pool"

// mergeCandidate adds one source's proposal to the ladder's candidate pool, keyed
// by identity. A new identity gets its own entry; a repeat identity records the
// extra source (the basis for the corroboration boost) and keeps the better
// release by betterCandidate.
//
// The shared pool is the exception (BUG-1011). Its answer is other accounts' word,
// so it can vouch for an identity but never supply the words or the confidence of
// a pick: when it and one of this computer's own sources name the same release,
// that source's release (its titles, MBID, date) and its own confidence stand, and
// the pool only adds the corroboration boost in markCorroboration. So a pooled
// release reaches auto only if an independent source scores it within one boost of
// the bar, and what gets tagged is what that source said, never planted titles.
// Order-independent: the pool may arrive before or after the source it agrees with.
func mergeCandidate(pool map[string]*RipScoredCandidate, rel *MatchedRelease, source string, confidence float64) {
	if rel == nil || confidence <= 0 {
		return
	}
	key := candidateKey(rel)
	existing, seen := pool[key]
	if !seen {
		pool[key] = &RipScoredCandidate{
			Release: rel, Confidence: confidence, Source: source, Sources: []string{source},
		}
		return
	}
	poolOnly := existing.Source == sharedPoolSource // nothing independent has named it yet
	existing.Sources = addSource(existing.Sources, source)
	switch {
	case source == sharedPoolSource:
		// The pool agreeing with what this computer found: a vote, nothing more.
		return
	case poolOnly:
		// The first independent source to name the pooled release replaces the pool's
		// words and confidence with its own.
		existing.Release = rel
		existing.Confidence = confidence
		existing.Source = source
		return
	}
	if betterCandidate(rel, confidence, existing) {
		existing.Release = rel
		existing.Confidence = confidence
		existing.Source = source
	}
}

// rankCandidates is the ladder's finalize step: apply the corroboration boost to
// any release two or more sources agree on, keep candidates that cleared the hard
// gate (score > 0), best first, capped at maxCandidates.
func rankCandidates(pool map[string]*RipScoredCandidate) []*RipScoredCandidate {
	cands := make([]*RipScoredCandidate, 0, len(pool))
	for _, c := range pool {
		c.markCorroboration()
		if c.Confidence > 0 {
			cands = append(cands, c)
		}
	}
	sort.SliceStable(cands, func(i, j int) bool { return cands[i].Confidence > cands[j].Confidence })
	if len(cands) > maxCandidates {
		cands = cands[:maxCandidates]
	}
	return cands
}

// addSource appends a source to a candidate's source set, deduped — so two gnudb
// hits collapsing don't read as corroboration, but gnudb + MB agreeing does.
func addSource(ss []string, s string) []string {
	for _, x := range ss {
		if x == s {
			return ss
		}
	}
	return append(ss, s)
}

// corroborate lifts a confidence by corroborationBoost, capped at 1.0.
func corroborate(conf float64) float64 {
	if c := conf + corroborationBoost; c < 1.0 {
		return c
	}
	return 1.0
}

// markCorroboration applies the multi-source boost exactly once. Idempotent: a
// candidate that picks up a third source later (e.g. via mergeScored) is not
// boosted twice; the Corroborated flag guards it.
func (c *RipScoredCandidate) markCorroboration() {
	if c.Corroborated || len(c.Sources) < 2 {
		return
	}
	c.Confidence = corroborate(c.Confidence)
	c.Corroborated = true
}

// poolHasMBID reports whether any pooled candidate already carries a MusicBrainz
// release MBID — i.e. some source produced a catalog-linked identity. The rung-5
// rescue is gated on this being false so it never competes with a verified match.
func poolHasMBID(pool map[string]*RipScoredCandidate) bool {
	for _, c := range pool {
		if c.Release != nil && c.Release.ReleaseMBID != "" {
			return true
		}
	}
	return false
}

// bestMBIDlessSeed returns the highest-confidence pooled candidate that lacks an
// MBID but names an album — the gnudb/shared-pool text used to seed the rung-5 MB
// name rescue. Nil when nothing in the pool has a usable album title to search on.
func bestMBIDlessSeed(pool map[string]*RipScoredCandidate) *MatchedRelease {
	var best *MatchedRelease
	var bestConf float64
	for _, c := range pool {
		if c.Release == nil || c.Release.ReleaseMBID != "" || c.Release.Album == "" {
			continue
		}
		if best == nil || c.Confidence > bestConf {
			best, bestConf = c.Release, c.Confidence
		}
	}
	return best
}

// gnudbMBNameRescue is rung 5 (see resolveDisc). When the pool holds no MBID
// candidate, it seeds an MB name search from the best gnudb/shared-pool text and
// adds any results as capped, confirm-tier candidates via add. searchFn and add
// are injected so the gate + cap logic is unit-testable without network I/O;
// resolveDisc passes searchReleasesByCDText and its own pool-add closure. A no-op
// (adds nothing, no search) when an MBID candidate already exists or nothing in the
// pool has an album to search on.
func gnudbMBNameRescue(
	pool map[string]*RipScoredCandidate,
	tocDur []int, ct *CDText, n int,
	searchFn func(artist, album string, tocTrackCount int) []*MatchedRelease,
	add func(rel *MatchedRelease, source string, confidence float64),
) {
	if poolHasMBID(pool) {
		return
	}
	seed := bestMBIDlessSeed(pool)
	if seed == nil {
		return
	}
	rescue := searchFn(seed.AlbumArtist, seed.Album, n)
	if len(rescue) == 0 && seed.AlbumArtist != "" {
		// The seed artist may be the truncated field (the bug we rescue) — retry on
		// the album alone; scoreCandidate's track-count + duration gate still guards
		// against a same-titled wrong release.
		rescue = searchFn("", seed.Album, n)
	}
	for _, rel := range rescue {
		score := scoreCandidate(rel, tocDur, ct)
		if score > gnudbRescueConfirmCap {
			score = gnudbRescueConfirmCap
		}
		add(rel, "gnudb_mb_rescue", score)
	}
}

// crossResolveToMusicBrainz attaches a MusicBrainz identity to a winning
// candidate that has none (gnudb or manual search) so the ripped album still
// earns catalog enrichment + "artists like" treatment (JOB 2). It searches MB by
// the candidate's artist+album, scores results against the TOC (track-count hard
// gate + duration alignment), and on a confident match copies the release MBID
// and per-track recording MBIDs onto the candidate — keeping the candidate's own
// titles. A miss is a no-op: the album stays fully named, just MBID-less.
func crossResolveToMusicBrainz(rel *MatchedRelease, toc *TOC) {
	if rel == nil || rel.ReleaseMBID != "" || rel.Album == "" {
		return
	}
	tocDur := tocTrackDurationsMs(toc)
	var best *MatchedRelease
	var bestScore float64
	for _, c := range searchReleasesByCDText(rel.AlbumArtist, rel.Album, len(tocDur)) {
		if s := scoreCandidate(c, tocDur, nil); s > bestScore {
			best, bestScore = c, s
		}
	}
	if best == nil || bestScore < confidenceAutoSelect {
		return // keep the gnudb/manual identity; no confident MB release
	}
	rel.ReleaseMBID = best.ReleaseMBID
	if rel.Date == "" {
		rel.Date = best.Date
	}
	byPos := make(map[int]string, len(best.Tracks))
	for _, t := range best.Tracks {
		byPos[t.Position] = t.RecordingMBID
	}
	for i := range rel.Tracks {
		if mbid := byPos[rel.Tracks[i].Position]; mbid != "" {
			rel.Tracks[i].RecordingMBID = mbid
		}
	}
}

// backResolveTitles fills a release's per-track titles (and recording MBIDs) from
// its MusicBrainz release, by track position. Used when a remembered identity has
// an MBID but no stored titles. Returns the number of titles filled; a fetch miss
// is a no-op (the caller keeps whatever it had). The track's LocalID is recomputed
// from the real title so ownership keys line up with a fresh rip.
func backResolveTitles(rel *MatchedRelease) int {
	if rel == nil || rel.ReleaseMBID == "" {
		return 0
	}
	full := fetchReleaseTracklist(rel.ReleaseMBID, len(rel.Tracks))
	if full == nil {
		return 0
	}
	return mergeTitlesByPosition(rel, full)
}

// ensureRealTitles is the keystone (layer 1): whenever a chosen release carries
// an MBID but placeholder/empty titles, fetch its real tracklist from MusicBrainz
// and fill them. We hold the identity — we should never SHOW "Track NN". Called
// on the final winner at every finalize point (detect, AcoustID, manual search),
// so a remembered/cross-resolved disc displays + rips with real names. No-op when
// titles are already real or there's no MBID. Returns the count filled.
func ensureRealTitles(rel *MatchedRelease) int {
	if rel == nil || rel.ReleaseMBID == "" || !hasPlaceholderTitles(rel) {
		return 0
	}
	return backResolveTitles(rel)
}

// hasPlaceholderTitles reports whether any track is unnamed or a "Track NN"
// placeholder — the signal that an MBID-bearing release still needs real titles.
func hasPlaceholderTitles(rel *MatchedRelease) bool {
	for _, t := range rel.Tracks {
		if isGenericTitle(t.Title) {
			return true
		}
	}
	return false
}

// isGenericTitle matches the "" / "Track 01" placeholders localRelease and the
// memory rebuild emit, so we can tell a real title from a fallback.
func isGenericTitle(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return true
	}
	low := strings.ToLower(s)
	if !strings.HasPrefix(low, "track ") {
		return false
	}
	rest := strings.TrimSpace(low[len("track "):])
	if rest == "" {
		return false
	}
	for _, r := range rest {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// mergeTitlesByPosition copies titles (and recording MBIDs) from full into rel by
// track position, recomputing each track's LocalID from the real title so it
// matches a fresh rip. Returns how many titles were filled. Pure — unit-tested.
func mergeTitlesByPosition(rel, full *MatchedRelease) int {
	byPos := make(map[int]RippedTrackMeta, len(full.Tracks))
	for _, t := range full.Tracks {
		byPos[t.Position] = t
	}
	filled := 0
	for i := range rel.Tracks {
		ft, ok := byPos[rel.Tracks[i].Position]
		if !ok || ft.Title == "" {
			continue
		}
		rel.Tracks[i].Title = ft.Title
		if rel.Tracks[i].RecordingMBID == "" {
			rel.Tracks[i].RecordingMBID = ft.RecordingMBID
		}
		durSec := float64(rel.Tracks[i].LengthMs) / 1000
		rel.Tracks[i].LocalID = CassetteLocalID(rel.Tracks[i].Artist, ft.Title, durSec)
		filled++
	}
	if rel.Date == "" {
		rel.Date = full.Date
	}
	return filled
}

// poolRungCandidate maps a shared-pool hit (P4) to a scored HINT candidate. Pure:
// the network fetch is the caller's, so the mapping is unit-testable. A nil hit
// yields nil. It never short-circuits the ladder and never reaches the auto bar on
// its own (BUG-1011), whatever the cloud says:
//
//	consensus "auto" (>=2 agreeing accounts) → sharedPoolConsensusConfidence (< auto)
//	anything else, or a cross-pressing match → sharedPoolSuggestConfidence    (< auto)
//
// The cloud now sends the consensus strength as `consensus` and pins `decision` to
// "suggest" for already-installed apps that would short-circuit on "auto"; either
// field saying "auto" counts as a strong consensus here.
//
// The release is rebuilt from the hit's stored crosswalk against the live TOC, so
// titles/positions come from the pooled track_recordings (CD-TEXT not needed here).
func poolRungCandidate(hit *sharedPoolHit, toc *TOC) *RipScoredCandidate {
	if hit == nil || hit.MBDiscID == "" {
		return nil
	}
	rec := DiscIdentityRecord{
		MBDiscID:        hit.MBDiscID,
		ReleaseMBID:     hit.ReleaseMBID,
		Album:           hit.Album,
		AlbumArtist:     hit.AlbumArtist,
		Date:            hit.Date,
		GnudbID:         hit.GnudbID,
		CoverURL:        hit.CoverURL,
		MediumPos:       hit.MediumPos,
		MediumCount:     hit.MediumCount,
		MediumTitle:     hit.MediumTitle,
		TrackRecordings: hit.TrackRecordings,
	}
	rel := rec.toMatchedRelease(toc, nil)
	if rel == nil || rel.Album == "" {
		return nil
	}
	conf := sharedPoolSuggestConfidence
	// A cross-pressing match (P5) is a DIFFERENT pressing matched by duration — the
	// match is fuzzy, so it stays at the single-voice level even if the sibling's own
	// consensus is strong.
	if (hit.Consensus == "auto" || hit.Decision == "auto") && !hit.CrossPressing {
		conf = sharedPoolConsensusConfidence
	}
	return &RipScoredCandidate{
		Release: rel, Confidence: conf,
		Source: sharedPoolSource, Sources: []string{sharedPoolSource},
	}
}

// candidateKey dedupes candidates across sources: by release MBID when present
// (the canonical identity), else by normalized artist|album so an MBID-less
// gnudb candidate and its later MusicBrainz twin collapse to one pool entry.
func candidateKey(rel *MatchedRelease) string {
	if rel.ReleaseMBID != "" {
		return "mbid:" + rel.ReleaseMBID
	}
	return "name:" + normalizeForLocalID(rel.AlbumArtist) + "|" + normalizeForLocalID(rel.Album)
}

// releaseGroupKey collapses the many PRESSINGS of one album to a single picker
// entry — "pick the album, we resolve the pressing". The key is the normalized
// artist|album, NOT the release-group MBID: the MBID only exists on MusicBrainz
// results, so keying by it splits the SAME album across sources (the MB pressing
// keys one way, the MBID-less iTunes pressing another) and the user sees the
// album twice. The normalized name is the one identity stable across every
// source, so it's what actually makes "versions" disappear from the picker.
// (Release-group MBID is still carried on the chosen pressing for enrichment.)
func releaseGroupKey(rel *MatchedRelease) string {
	return foldGroupText(rel.AlbumArtist) + "|" + foldGroupText(rel.Album)
}

// foldGroupText normalizes a title/artist for GROUPING only (never the track-identity
// hash, which must stay stable). On top of the shared normalize it folds the many
// Unicode hyphen/dash variants to a plain "-", so "blink‐182" (U+2010, as one source
// spells it) and "blink-182" (ASCII, as another does) collapse to a single album.
func foldGroupText(s string) string {
	s = normalizeForLocalID(s)
	return hyphenFolder.Replace(s)
}

// hyphenFolder maps the Unicode hyphen/dash family to ASCII "-". Sources disagree on
// which codepoint they use for the same title, which silently splits a release group.
var hyphenFolder = strings.NewReplacer(
	"‐", "-", // hyphen
	"‑", "-", // non-breaking hyphen
	"‒", "-", // figure dash
	"–", "-", // en dash
	"—", "-", // em dash
	"―", "-", // horizontal bar
	"−", "-", // minus sign
	"﹣", "-", // small hyphen-minus
	"－", "-", // fullwidth hyphen-minus
)

// betterCandidate decides whether (rel, conf) should replace a pooled entry:
// higher confidence wins; at equal confidence an MBID-bearing candidate beats an
// MBID-less one (it can still earn catalog enrichment).
func betterCandidate(rel *MatchedRelease, conf float64, existing *RipScoredCandidate) bool {
	if conf > existing.Confidence {
		return true
	}
	if conf == existing.Confidence {
		return rel.ReleaseMBID != "" && existing.Release.ReleaseMBID == ""
	}
	return false
}

// scoreCandidate scores one candidate release against the disc's TOC (and
// CD-TEXT when present), normalized to 0..1.
//
//	Track count   — HARD GATE (exact) or 0.5× penalty (±tolerance). Score 0 if
//	               outside tolerance or candidate is nil.
//	Duration      — per-track alignment of release vs TOC durations.
//	CD-TEXT title — per-track title agreement, when CD-TEXT titles exist.
func scoreCandidate(c *MatchedRelease, tocDurMs []int, ct *CDText) float64 {
	return scoreCandidateTol(c, tocDurMs, ct, 0)
}

func scoreCandidateTol(c *MatchedRelease, tocDurMs []int, ct *CDText, tolerance int) float64 {
	if c == nil {
		return 0
	}
	trackDiff := c.TrackCount - len(tocDurMs)
	if trackDiff < 0 {
		trackDiff = -trackDiff
	}
	if trackDiff > tolerance {
		return 0
	}
	durScore := durationAlignment(c, tocDurMs)
	titleScore, haveTitles := titleAgreement(c, ct)
	var raw float64
	if haveTitles {
		raw = weightDurationAlignment*durScore + weightTitleAgreement*titleScore
	} else {
		// No CD-TEXT titles to compare (e.g. a fuzzy-TOC candidate on a text-less
		// disc) — duration alignment carries the full weight.
		raw = durScore
	}
	if trackDiff > 0 {
		// Near-miss track count: penalize but don't zero so the user can still
		// see and pick the result in the manual-search confirm list.
		raw *= 0.5
	}
	return raw
}

// durationAlignment is the mean per-track duration credit over tracks whose
// release length is known. Returns 0 when no track has a usable length.
func durationAlignment(c *MatchedRelease, tocDurMs []int) float64 {
	var sum float64
	var n int
	for i, tr := range c.Tracks {
		if tr.LengthMs <= 0 || i >= len(tocDurMs) {
			continue
		}
		diff := math.Abs(float64(tr.LengthMs - tocDurMs[i]))
		var credit float64
		switch {
		case diff <= durationFullCreditMs:
			credit = 1
		case diff >= durationZeroCreditMs:
			credit = 0
		default:
			credit = (durationZeroCreditMs - diff) / (durationZeroCreditMs - durationFullCreditMs)
		}
		sum += credit
		n++
	}
	if n == 0 {
		return 0
	}
	return sum / float64(n)
}

// titleAgreement is the mean per-track title similarity between CD-TEXT and the
// candidate. ok is false (caller reweights) when there are no CD-TEXT titles to
// compare against.
func titleAgreement(c *MatchedRelease, ct *CDText) (score float64, ok bool) {
	if ct == nil || len(ct.Tracks) == 0 {
		return 0, false
	}
	var sum float64
	var n int
	for _, tr := range c.Tracks {
		ctTitle := ct.TitleFor(tr.Position)
		if ctTitle == "" {
			continue
		}
		sum += titleSimilarity(ctTitle, tr.Title)
		n++
	}
	if n == 0 {
		return 0, false
	}
	return sum / float64(n), true
}

// titleSimilarity compares two titles after the local-ID normalization
// (NFKD + diacritic strip + lowercase + whitespace collapse). Exact match → 1;
// otherwise token-set Jaccard so minor punctuation/word differences degrade
// gracefully instead of dropping to zero.
func titleSimilarity(a, b string) float64 {
	na := normalizeForLocalID(a)
	nb := normalizeForLocalID(b)
	if na == "" || nb == "" {
		return 0
	}
	if na == nb {
		return 1
	}
	return tokenJaccard(na, nb)
}

func tokenJaccard(a, b string) float64 {
	setA := toSet(strings.Fields(a))
	setB := toSet(strings.Fields(b))
	if len(setA) == 0 || len(setB) == 0 {
		return 0
	}
	inter := 0
	for t := range setA {
		if setB[t] {
			inter++
		}
	}
	union := len(setA) + len(setB) - inter
	if union == 0 {
		return 0
	}
	return float64(inter) / float64(union)
}

func toSet(ss []string) map[string]bool {
	m := make(map[string]bool, len(ss))
	for _, s := range ss {
		m[s] = true
	}
	return m
}

// tocTrackDurationsMs derives per-track durations (ms) from the TOC: each
// track's length is the gap to the next track's offset (or the leadout for the
// last track), in CD frames at 75/sec. Index i corresponds to track
// FirstTrack+i.
func tocTrackDurationsMs(toc *TOC) []int {
	n := len(toc.TrackOffsets)
	// The LAST track ends at the AUDIO lead-out, not the disc-ID lead-out: on an
	// enhanced CD the latter is the trailing data track's start, which would inflate
	// the last track by the inter-session gap (e.g. a 6:21 song reading as 8:52).
	lastEnd := toc.AudioLeadout
	if lastEnd == 0 {
		lastEnd = toc.LeadoutOffset
	}
	out := make([]int, n)
	for i := 0; i < n; i++ {
		end := lastEnd
		if i+1 < n {
			end = toc.TrackOffsets[i+1]
		}
		frames := end - toc.TrackOffsets[i]
		if frames < 0 {
			frames = 0
		}
		out[i] = frames * 1000 / 75
	}
	return out
}

// ── IMPORT-ANYWAY: the always-importable local identity ──────────────────────

// localRelease builds a MatchedRelease from the physical disc alone, for the
// no-usable-match terminal. The computed Disc ID is the stable album key
// (so re-ripping the same disc lands in the same place); track titles come from
// CD-TEXT when present, else "Track N"; durations come from the TOC; each track
// gets a Cassette local ID. The album is named from CD-TEXT, or marked
// needs-naming with a disc-derived suffix so two different unknown discs never
// collapse into one "Unknown Album" in the library.
func localRelease(toc *TOC, discID string, ct *CDText) *MatchedRelease {
	tocDur := tocTrackDurationsMs(toc)

	albumArtist := strings.TrimSpace(ct.albumArtistOr(""))
	if albumArtist == "" {
		albumArtist = "Unknown Artist"
	}

	album := strings.TrimSpace(ct.albumOr(""))
	needsNaming := album == ""
	if needsNaming {
		// Unique-but-anonymous: a future edit feature renames via the marker, and
		// two distinct unknown discs stay distinct albums in Navidrome.
		album = "Unknown Album " + discFingerprint(discID)
	}

	m := &MatchedRelease{
		ReleaseMBID:  "",
		Album:        album,
		AlbumArtist:  albumArtist,
		Date:         "",
		DiscID:       discID,
		TrackCount:   len(tocDur),
		Unidentified: true,
		NeedsNaming:  needsNaming,
	}
	for i := 0; i < len(tocDur); i++ {
		pos := toc.FirstTrack + i
		title := ct.TitleFor(pos)
		if title == "" {
			title = fmt.Sprintf("Track %02d", pos)
		}
		artist := strings.TrimSpace(ct.ArtistFor(pos))
		if artist == "" {
			artist = albumArtist
		}
		durSec := float64(tocDur[i]) / 1000
		m.Tracks = append(m.Tracks, RippedTrackMeta{
			Position: pos,
			Title:    title,
			Artist:   artist,
			LengthMs: tocDur[i],
			LocalID:  CassetteLocalID(artist, title, durSec),
		})
	}
	return m
}

// discFingerprint is a short, stable, filename-safe tag derived from the Disc
// ID — used only to keep unnamed unknown albums distinct.
func discFingerprint(discID string) string {
	sum := sha1.Sum([]byte(discID))
	return strings.ToUpper(hex.EncodeToString(sum[:3])) // 6 hex chars
}

// nil-safe CD-TEXT accessors used by localRelease.
func (c *CDText) albumOr(def string) string {
	if c == nil || c.Album == "" {
		return def
	}
	return c.Album
}

func (c *CDText) albumArtistOr(def string) string {
	if c == nil || c.AlbumArtist == "" {
		return def
	}
	return c.AlbumArtist
}
