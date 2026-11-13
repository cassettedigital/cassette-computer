// Search-and-match (JOB 4).
//
// The import-as-unknown terminal must be the genuine LAST resort, reached only
// after the user has had a chance to find the album themselves. POST
// /api/rip/search runs a free-text search across MusicBrainz and the iTunes
// Search API, scores each candidate against the inserted disc's TOC, and surfaces
// a pick-list. Selection flows through the existing /api/rip/confirm (the
// candidates are merged into pendingResolution, so picking one neither re-reads
// the disc nor re-searches). gnudb has no text-search command over the CDDB
// protocol — it is keyed by disc ID, not words — so text search spans MB +
// iTunes; gnudb still covers the disc-ID path (rip_gnudb.go).

package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
)

// handleRipSearch searches for an album by text and republishes the confirm
// pick-list with the results. Body: {query}. Reuses the stashed TOC, so it
// requires a disc to have been detected.
func handleRipSearch(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if ripActive.Load() {
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok": false, "alreadyRipping": true, "error": "A rip is already in progress.",
		})
		return
	}

	var req struct {
		Query string `json:"query"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	dr := pendingResolution.Load()
	if dr == nil || dr.toc == nil {
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "No disc detected. Detect the disc first."})
		return
	}

	found := searchCandidates(dr.toc, dr.cdtext, req.Query)

	// Merge the search results into the stashed resolution (keeping any prior
	// candidates) so /api/rip/confirm can resolve the user's pick by id.
	merged := mergeScored(dr.res.Candidates, found)
	newRes := &RipResolution{Candidates: merged, Profile: dr.profile}
	if len(merged) > 0 {
		newRes.Release = merged[0].Release
		newRes.Confidence = merged[0].Confidence
	}
	// Layer 1 — fill real titles if the winner holds an MBID but placeholders.
	if newRes.Release != nil {
		ensureRealTitles(newRes.Release)
	}
	// Carry the ORIGINAL offered default forward: a search re-orders the list (the
	// found result may now be merged[0]), but was_override must still be measured
	// against what we first suggested — so picking a searched result reads as the
	// override it is.
	pendingResolution.Store(&detectResult{res: newRes, toc: dr.toc, discID: dr.discID, cdtext: dr.cdtext, profile: dr.profile, offeredDefaultKey: dr.offeredDefaultKey})

	// Flip the panel to the confirm pick-list with the results (or keep it
	// importable when the search found nothing).
	if len(found) > 0 {
		publishRip(confirmProgress(newRes))
	}
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":         true,
		"candidates": candidateList(found),
	})
}

// alignSearchTolerance is how far a manual-search result's track count may differ
// from the disc before we won't even fetch its tracklist. Alignment handles the
// actual insert/drop, but the fetch budget is small (cdtextFetchCap), so we only
// spend it on pressings within a couple of tracks of the disc.
const alignSearchTolerance = 2

// searchCandidates runs the text search across MusicBrainz + iTunes, ALIGNS each
// result to the disc (duration sequence alignment — tolerant of inserted/dropped
// tracks), collapses pressings to one entry per album (release group), and
// returns the best-aligned pressing of each, best-first. Each candidate's
// tracklist is re-expressed in DISC order, so confirming it rips with the right
// names and any unmatched disc track surfaces as a gap to name. Source is
// "manual" — a user-driven identification.
func searchCandidates(toc *TOC, ct *CDText, query string) []*RipScoredCandidate {
	tocDur := tocTrackDurationsMs(toc)
	n := len(tocDur)
	discID, _ := toc.DiscID()

	// One slot per album (release group): keep the pressing that aligns best.
	byGroup := map[string]*RipScoredCandidate{}
	consider := func(rel *MatchedRelease) {
		if rel == nil {
			return
		}
		aligned := alignReleaseToDisc(rel, tocDur, toc.FirstTrack, ct)
		if aligned.Score <= 0 {
			return
		}
		// Re-express the release in disc order so the confirm/rip uses the aligned
		// names (and blanks at the gaps), and stamp the disc ID for tagging.
		rel.DiscID = discID
		rel.Tracks = aligned.Tracks
		rel.TrackCount = len(aligned.Tracks)
		cand := &RipScoredCandidate{
			Release:              rel,
			Confidence:           aligned.Score,
			Source:               "manual",
			Gaps:                 aligned.Gaps,
			Flagged:              aligned.Flagged,
			DroppedReleaseTitles: aligned.DroppedReleaseTitles,
		}
		key := releaseGroupKey(rel)
		if existing, seen := byGroup[key]; seen && !betterPressing(cand, existing) {
			return // an equal-or-better pressing of this album already won the slot
		}
		byGroup[key] = cand
	}

	for _, rel := range searchReleasesByText(query, n, alignSearchTolerance) {
		consider(rel)
	}
	for _, rel := range itunesReleasesByText(query, n, alignSearchTolerance) {
		consider(rel)
	}

	out := make([]*RipScoredCandidate, 0, len(byGroup))
	for _, c := range byGroup {
		out = append(out, c)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Confidence > out[j].Confidence })
	if len(out) > maxCandidates {
		out = out[:maxCandidates]
	}
	return out
}

// betterPressing decides whether candidate a should take the album's picker slot
// from b. Higher alignment confidence wins; on a near-tie the MBID-bearing
// pressing wins, so collapsing an iTunes duplicate into a MusicBrainz album keeps
// the MB identity (release + release-group MBIDs) that drives later enrichment.
func betterPressing(a, b *RipScoredCandidate) bool {
	d := a.Confidence - b.Confidence
	if d < 0 {
		d = -d
	}
	if d < 0.02 {
		return a.Release.ReleaseMBID != "" && b.Release.ReleaseMBID == ""
	}
	return a.Confidence > b.Confidence
}

// mergeScored folds new candidates into the existing pool, deduped by identity
// key. A new source proposing an already-pooled release merges as CORROBORATION
// (its source joins the set, lifting confidence) rather than just replacing or
// being dropped — the same accumulator rule resolveDisc uses. Best-first.
func mergeScored(existing, found []*RipScoredCandidate) []*RipScoredCandidate {
	byKey := map[string]*RipScoredCandidate{}
	order := []string{}
	addOne := func(c *RipScoredCandidate) {
		if c == nil || c.Release == nil {
			return
		}
		k := candidateKey(c.Release)
		if prev, ok := byKey[k]; ok {
			for _, s := range sourcesOf(c) {
				prev.Sources = addSource(prev.Sources, s)
			}
			if betterCandidate(c.Release, c.Confidence, prev) {
				prev.Release = c.Release
				prev.Confidence = c.Confidence
				prev.Source = c.Source
				prev.Gaps = c.Gaps                                 // carry the aligned gap set with the winning pressing
				prev.Flagged = c.Flagged                           // …its flagged (loose-duration) tracks
				prev.DroppedReleaseTitles = c.DroppedReleaseTitles // …and what it dropped
				prev.Corroborated = false                          // re-evaluate the boost against the merged source set
			}
			return
		}
		// Copy so we never mutate the caller's candidate in place.
		cp := *c
		if len(cp.Sources) == 0 && cp.Source != "" {
			cp.Sources = []string{cp.Source}
		}
		byKey[k] = &cp
		order = append(order, k)
	}
	for _, c := range existing {
		addOne(c)
	}
	for _, c := range found {
		addOne(c)
	}
	out := make([]*RipScoredCandidate, 0, len(order))
	for _, k := range order {
		c := byKey[k]
		c.markCorroboration()
		out = append(out, c)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Confidence > out[j].Confidence })
	return out
}

// sourcesOf returns a candidate's source set, falling back to its representative
// Source when the set is empty (candidates built before this field existed).
func sourcesOf(c *RipScoredCandidate) []string {
	if len(c.Sources) > 0 {
		return c.Sources
	}
	if c.Source != "" {
		return []string{c.Source}
	}
	return nil
}

// applyGapNames fills the picked release's gap tracks (blank titles, left by
// duration alignment) with the user's names, keyed by disc track position. Any
// title still blank afterward (a skipped gap) falls back to "Track NN" so the
// tagger never writes an empty title. A named track also gets a stable Cassette
// local ID so it carries an identity into the library like any other track.
func applyGapNames(rel *MatchedRelease, names map[string]string) {
	if rel == nil {
		return
	}
	for i := range rel.Tracks {
		t := &rel.Tracks[i]
		if t.Title != "" {
			continue
		}
		if name := strings.TrimSpace(names[strconv.Itoa(t.Position)]); name != "" {
			t.Title = name
		} else {
			t.Title = fmt.Sprintf("Track %02d", t.Position)
		}
		if t.Artist == "" {
			t.Artist = rel.AlbumArtist
		}
		t.LocalID = CassetteLocalID(t.Artist, t.Title, float64(t.LengthMs)/1000)
	}
}

// sanityCheckTrackDurations flags (does not silently accept) tracks whose chosen
// release duration is wildly off the TOC — a sign the user picked the wrong
// album. Returns the flagged positions; logs each. Called when a search/confirm
// pick is committed to a rip.
func sanityCheckTrackDurations(rel *MatchedRelease, toc *TOC) []int {
	tocDur := tocTrackDurationsMs(toc)
	var flagged []int
	for i, tr := range rel.Tracks {
		if i >= len(tocDur) || tr.LengthMs <= 0 {
			continue
		}
		diff := tr.LengthMs - tocDur[i]
		if diff < 0 {
			diff = -diff
		}
		if diff > durationSanityMaxMs {
			flagged = append(flagged, tr.Position)
			log.Printf("rip: track %d %q duration %dms is %dms off the disc TOC (%dms) — flagged",
				tr.Position, tr.Title, tr.LengthMs, diff, tocDur[i])
		}
	}
	return flagged
}

// durationSanityMaxMs is how far a picked track's duration may stray from the
// disc before it's flagged (15s — generous enough for normal pressing variance,
// tight enough to catch a wrong-album pick).
const durationSanityMaxMs = 15000
