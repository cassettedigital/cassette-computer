package main

import "math"

// ── Duration sequence alignment (the matching primitive) ─────────────────────
//
// The disc's TOC gives an exact per-track duration. A candidate release gives a
// per-track duration too. The earlier scorer compared them POSITION-LOCKED (disc
// track i vs release track i), which breaks the instant a pressing inserts or
// drops a track — a bonus cut, a hidden track, an interlude one edition omits.
// Every track after the seam then mis-names. alignReleaseToDisc instead finds the
// best monotonic correspondence between the two duration sequences
// (Needleman-Wunsch), so an inserted/dropped track falls out as a GAP and
// everything else stays correctly aligned. The disc with no interlude vs a
// release that has one: the interlude is dropped on the release side, and the
// disc's real tracks all line up.

const (
	// alignGapPenalty is the score for leaving a track unaligned (on either side),
	// in the same [-1,+1] space as the per-pair duration credit. Tuned so a track
	// the alignment can place by SEQUENCE POSITION stays paired (and gets named)
	// even when its duration is loose — a longer pressing of the same song — while
	// a disc track the release genuinely has no slot for still falls out as a gap.
	alignGapPenalty = -0.7

	// alignGapDeviationMs: a track the alignment paired by POSITION but whose duration
	// is off by more than this is treated as UNNAMED (a gap) rather than confidently
	// mislabeled — beyond ~1.5 min apart it's almost certainly a different song (a
	// hidden-track tail, a swapped edition), so we ask rather than guess. Between
	// durationSanityMaxMs (15s) and this, the track is named but FLAGGED.
	alignGapDeviationMs = 90_000
)

// AlignedRelease is a candidate release re-expressed in DISC order via duration
// alignment. Tracks has exactly len(disc) entries — one per disc audio track, in
// disc order. A matched entry carries the release track's title/artist/MBID and
// the disc's true length; a gap entry (the disc has a track this release can't
// name) is blank and listed in Gaps. DroppedReleaseTitles names the release
// tracks the disc LACKS (e.g. an omitted interlude) — informational for the UI.
type AlignedRelease struct {
	Tracks               []RippedTrackMeta
	Score                float64 // 0..1 alignment quality (gaps count as 0)
	Gaps                 []int   // disc track numbers (positions) the release had no slot for — named by the user
	Flagged              []int   // disc track numbers named by position but with a loose duration — worth a second look
	DroppedReleaseTitles []string
	MatchedCount         int
}

// durationPairCredit maps a |disc-release| duration difference to a [-1,+1]
// alignment credit, reusing the resolver's full/zero-credit thresholds: +1 for a
// tight match, decaying linearly through 0 to -1 once the gap is large.
func durationPairCredit(discMs, relMs int) float64 {
	if discMs <= 0 || relMs <= 0 {
		return 0 // unknown length on either side — neutral, neither rewards nor punishes
	}
	diff := math.Abs(float64(discMs - relMs))
	switch {
	case diff <= durationFullCreditMs:
		return 1
	case diff >= durationZeroCreditMs:
		return -1
	default:
		return 1 - 2*(diff-durationFullCreditMs)/(durationZeroCreditMs-durationFullCreditMs)
	}
}

// alignDurations runs Needleman-Wunsch over disc vs release durations and returns
// discMap (length len(disc)): discMap[i] is the aligned release-track index, or
// -1 when disc track i is a gap (no release track aligns to it).
func alignDurations(disc, rel []int) []int {
	n, m := len(disc), len(rel)
	discMap := make([]int, n)
	for i := range discMap {
		discMap[i] = -1
	}
	if n == 0 || m == 0 {
		return discMap
	}

	// score[i][j] = best score aligning disc[:i] with rel[:j].
	// back[i][j]: 0=diagonal (match), 1=up (disc-side gap), 2=left (rel-side gap).
	score := make([][]float64, n+1)
	back := make([][]byte, n+1)
	for i := range score {
		score[i] = make([]float64, m+1)
		back[i] = make([]byte, m+1)
	}
	for i := 1; i <= n; i++ {
		score[i][0] = float64(i) * alignGapPenalty
		back[i][0] = 1
	}
	for j := 1; j <= m; j++ {
		score[0][j] = float64(j) * alignGapPenalty
		back[0][j] = 2
	}
	for i := 1; i <= n; i++ {
		for j := 1; j <= m; j++ {
			best := score[i-1][j-1] + durationPairCredit(disc[i-1], rel[j-1])
			b := byte(0)
			if up := score[i-1][j] + alignGapPenalty; up > best {
				best, b = up, 1
			}
			if left := score[i][j-1] + alignGapPenalty; left > best {
				best, b = left, 2
			}
			score[i][j], back[i][j] = best, b
		}
	}

	// Traceback from (n, m) to the origin.
	i, j := n, m
	for i > 0 || j > 0 {
		switch {
		case i > 0 && j > 0 && back[i][j] == 0:
			discMap[i-1] = j - 1
			i--
			j--
		case i > 0 && (j == 0 || back[i][j] == 1):
			i-- // disc-side gap
		default:
			j-- // rel-side gap
		}
	}
	return discMap
}

// alignReleaseToDisc projects a release's tracklist onto the disc via duration
// alignment. firstTrack is the disc's first audio track number (TOC.FirstTrack)
// so output positions match the physical disc. ct, when present, blends CD-TEXT
// title agreement into the per-track credit (duration still drives the alignment
// itself — it's the always-available signal).
func alignReleaseToDisc(rel *MatchedRelease, discDurMs []int, firstTrack int, ct *CDText) *AlignedRelease {
	n := len(discDurMs)
	out := &AlignedRelease{Tracks: make([]RippedTrackMeta, n)}
	if rel == nil || n == 0 {
		return out
	}

	relDur := make([]int, len(rel.Tracks))
	for i, t := range rel.Tracks {
		relDur[i] = t.LengthMs
	}
	discMap := alignDurations(discDurMs, relDur)
	relUsed := make([]bool, len(rel.Tracks))

	var creditSum float64
	for i := 0; i < n; i++ {
		pos := firstTrack + i
		j := discMap[i]

		if j < 0 {
			// The alignment left this disc track unpaired — the release genuinely has
			// no slot for it (a bonus or hidden cut). This is the ONLY true gap:
			// blank, carrying the disc's length, for the name-first flow.
			out.Tracks[i] = RippedTrackMeta{Position: pos, LengthMs: discDurMs[i]}
			out.Gaps = append(out.Gaps, pos)
			continue
		}

		// The alignment paired this disc track to a release track by position. How far
		// the durations agree decides how much we trust that name:
		dev := absInt(discDurMs[i] - relDur[j])
		if dev > alignGapDeviationMs {
			// So far off it's almost certainly a DIFFERENT song (a hidden-track tail,
			// a swapped edition). Don't apply a name we don't trust — surface it to be
			// named instead of mislabeling it. The release track stays "dropped".
			out.Tracks[i] = RippedTrackMeta{Position: pos, LengthMs: discDurMs[i]}
			out.Gaps = append(out.Gaps, pos)
			continue
		}
		// Close enough to name from the release. A loose-but-plausible duration (a
		// longer pressing of the same song) is FLAGGED for a second look, never
		// blanked. CD-TEXT title agreement lifts the credit when the disc carries it.
		credit := (durationPairCredit(discDurMs[i], relDur[j]) + 1) / 2 // → [0,1]
		if ct != nil {
			if ctTitle := ct.TitleFor(pos); ctTitle != "" {
				credit = weightDurationAlignment*credit + weightTitleAgreement*titleSimilarity(ctTitle, rel.Tracks[j].Title)
			}
		}
		src := rel.Tracks[j]
		relUsed[j] = true
		out.Tracks[i] = RippedTrackMeta{
			Position:      pos,
			Title:         src.Title,
			Artist:        src.Artist,
			RecordingMBID: src.RecordingMBID,
			LengthMs:      discDurMs[i], // the disc's true length, not the release's
		}
		creditSum += credit
		out.MatchedCount++
		if dev > durationSanityMaxMs {
			out.Flagged = append(out.Flagged, pos)
		}
	}

	for j, used := range relUsed {
		if !used {
			out.DroppedReleaseTitles = append(out.DroppedReleaseTitles, rel.Tracks[j].Title)
		}
	}
	out.Score = creditSum / float64(n) // unmatched disc tracks count as 0 credit
	return out
}
