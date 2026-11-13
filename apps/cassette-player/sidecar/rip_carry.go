// Carry the rip's confirmed identity across the library-sync seam.
//
// At sync time we know each Navidrome track's tags + duration, but NOT which
// physical disc it came from. carryDiscIdentity links every track back to a
// disc_identity.jsonl record (rung-zero memory) and attaches that disc's stable
// identity — mb_disc_id (TOC-derived), release_mbid, and the track's disc
// position — to the sync payload. The cloud then REUSES this instead of
// re-deriving it, and the Stage-2 tombstone keys on (mb_disc_id, disc position)
// so a deleted album stays deleted after a re-rip whose tags (hence
// cassette_local_id) changed.
//
// Linking is best-effort and tag-robust. Recording-MBID overlap and album-name
// match only NARROW the candidate records; a link is confirmed only when the
// candidate's TOC per-track duration vector ALIGNS with the track group. That
// duration gate does double duty: it survives placeholder/garbage tags (durations
// don't change) and it disambiguates two pressings of the same album, so we never
// attach one disc's id to another disc's tracks (which would over-suppress).
//
// All local. No network.

package main

import "strconv"

// carryDiscIdentity mutates `tracks` in place, attaching disc identity where a
// confident link exists. Tracks with no link keep nil identity (carried as null).
func carryDiscIdentity(tracks []librarySyncTrack) {
	if len(tracks) == 0 {
		return
	}
	discMemory.ensureLoaded()
	discMemory.mu.RLock()
	defer discMemory.mu.RUnlock()
	if len(discMemory.all) == 0 {
		return
	}

	// Group by album tag AND disc number. The ripper writes one album value per
	// disc, but a MULTI-DISC set shares that album name across all its discs — so
	// grouping by album alone lumps both discs into one group (e.g. 12 tracks), and
	// no single disc's 6-track TOC can align to it, leaving the whole set with null
	// identity (BUG-261). The DISCNUMBER tag splits them, so each disc's tracks
	// align to its own record. Single-disc albums are unaffected (one disc, one
	// group); a missing disc tag falls back to album-only grouping as before.
	groups := map[string][]int{}
	order := []string{}
	for i := range tracks {
		k := albumTagKey(&tracks[i])
		if d := tracks[i].DiscNumber; d != nil && *d > 0 {
			k += "\x1fd" + strconv.Itoa(*d)
		}
		if _, ok := groups[k]; !ok {
			order = append(order, k)
		}
		groups[k] = append(groups[k], i)
	}

	for _, k := range order {
		idxs := groups[k]
		rec := bestRecordForGroup(tracks, idxs)
		if rec == nil || rec.MBDiscID == "" {
			continue
		}
		for _, i := range idxs {
			applyDiscIdentity(&tracks[i], rec, discPosition(rec, &tracks[i]))
		}
	}
}

// bestRecordForGroup picks the disc record that matches a group of tracks sharing
// an album tag. Recording-MBID overlap and album-name match gather candidates;
// the TOC duration vector must align for a confident link (disambiguates
// pressings + survives garbage tags). Returns nil when nothing aligns.
func bestRecordForGroup(tracks []librarySyncTrack, idxs []int) *DiscIdentityRecord {
	seen := map[*DiscIdentityRecord]bool{}
	var cands []*DiscIdentityRecord
	add := func(r *DiscIdentityRecord) {
		if r != nil && !seen[r] {
			seen[r] = true
			cands = append(cands, r)
		}
	}

	// 1. Records sharing any recording MBID with a track in the group.
	for _, i := range idxs {
		t := &tracks[i]
		if t.MusicBrainzRecordingID != nil && *t.MusicBrainzRecordingID != "" {
			for _, r := range discMemory.byRecording[*t.MusicBrainzRecordingID] {
				add(r)
			}
		}
	}
	// 2. Records whose album key matches the group's album tag.
	gk := albumTagKey(&tracks[idxs[0]])
	if gk != "" {
		for _, r := range discMemory.all {
			if albumKey(r.Album, r.AlbumArtist) == gk {
				add(r)
			}
		}
	}
	// 3. Fallback (placeholder/garbage tags): every record with a usable TOC, to
	//    be filtered by the duration gate below.
	if len(cands) == 0 {
		for _, r := range discMemory.all {
			if len(r.TOCRaw.TrackOffsets) > 0 {
				add(r)
			}
		}
	}

	// Confirm by duration-vector alignment (the gate).
	for _, r := range cands {
		if len(r.TOCRaw.TrackOffsets) == 0 {
			continue
		}
		durs := tocTrackDurationsMs(recordTOC(r))
		if len(durs) == len(idxs) && durationsAlign(tracks, idxs, durs) {
			return r
		}
		// Partial rip (fewer tracks than the disc — e.g. an interrupted rip): still
		// carry positions when the group has a STRONG identity link (album key or a
		// shared recording MBID) AND every track maps to a DISTINCT disc position.
		// Gated on identity so a short, garbage-tagged group can't latch onto a
		// longer record (no over-suppression), while a clean partial still orders.
		if len(idxs) < len(durs) && groupSharesIdentity(tracks, idxs, r) && subsetAligns(tracks, idxs, r) {
			return r
		}
	}
	return nil
}

// groupSharesIdentity reports a strong link between the group and record r — a
// matching album key, or any shared recording MBID. It gates the partial-rip
// subset path so a short group never latches onto an unrelated longer record.
func groupSharesIdentity(tracks []librarySyncTrack, idxs []int, r *DiscIdentityRecord) bool {
	if gk := albumTagKey(&tracks[idxs[0]]); gk != "" && albumKey(r.Album, r.AlbumArtist) == gk {
		return true
	}
	rec := map[string]bool{}
	for _, tr := range r.TrackRecordings {
		if tr.RecordingMBID != "" {
			rec[tr.RecordingMBID] = true
		}
	}
	for _, i := range idxs {
		if m := tracks[i].MusicBrainzRecordingID; m != nil && *m != "" && rec[*m] {
			return true
		}
	}
	return false
}

// subsetAligns reports whether every track in a partial group maps to a DISTINCT
// position of record r (recording-MBID preferred, else closest duration). This is
// what lets a partial rip carry correct positions for the tracks it did rip,
// instead of falling back to an alphabetical tracklist in the cloud.
func subsetAligns(tracks []librarySyncTrack, idxs []int, r *DiscIdentityRecord) bool {
	used := map[int]bool{}
	for _, i := range idxs {
		pos := discPosition(r, &tracks[i])
		if pos <= 0 || used[pos] {
			return false
		}
		used[pos] = true
	}
	return true
}

// durationsAlign greedily pairs each group track to a distinct TOC position whose
// duration is within 2s. True only when every track pairs — a whole-vector match,
// which is strong evidence even without any ID.
func durationsAlign(tracks []librarySyncTrack, idxs []int, dursMs []int) bool {
	used := make([]bool, len(dursMs))
	var leftover []int
	// Pass 1: exact matches (within 2s).
	for _, i := range idxs {
		want := tracks[i].DurationSeconds * 1000
		matched := false
		for j := range dursMs {
			if !used[j] && absInt(dursMs[j]-want) <= 2000 {
				used[j], matched = true, true
				break
			}
		}
		if !matched {
			leftover = append(leftover, i)
		}
	}
	// Pass 2: a leftover track may be the readable SONG of a physical track that
	// runs LONGER on the disc — a silent/ghost-track tail (the classic hidden
	// track). The rip captures only the song, so its duration is SHORTER than the
	// TOC position. Forgive AT MOST ONE such track: a hidden tail is a single
	// last-track quirk, whereas many mismatches mean a different disc (don't
	// loosen into a wrong-pressing link — that would over-suppress on delete).
	if len(leftover) > 1 {
		return false
	}
	for _, i := range leftover {
		want := tracks[i].DurationSeconds * 1000
		matched := false
		for j := range dursMs {
			if !used[j] && dursMs[j] > want {
				used[j], matched = true, true
				break
			}
		}
		if !matched {
			return false
		}
	}
	return true
}

// discPosition resolves a track's disc position, preferring an exact recording-
// MBID match — robust when the rip's duration differs from the physical TOC
// position (a hidden-track tail makes the song shorter than the disc track) —
// and falling back to the closest-duration heuristic when no MBID is present.
func discPosition(r *DiscIdentityRecord, t *librarySyncTrack) int {
	if t.MusicBrainzRecordingID != nil && *t.MusicBrainzRecordingID != "" {
		for _, tr := range r.TrackRecordings {
			if tr.RecordingMBID == *t.MusicBrainzRecordingID {
				return tr.Position
			}
		}
	}
	return discPositionByDuration(r, t.DurationSeconds)
}

// discPositionByDuration returns the record's TOC position whose duration is
// closest to durSec (within 2s tolerance), else 0 (unknown). Deterministic, so a
// re-rip of the same disc maps the same physical track to the same position.
func discPositionByDuration(r *DiscIdentityRecord, durSec int) int {
	durs := tocTrackDurationsMs(recordTOC(r))
	want := durSec * 1000
	best, bestDelta := 0, 2001
	for i, d := range durs {
		delta := absInt(d - want)
		if delta < bestDelta {
			bestDelta = delta
			best = r.TOCRaw.FirstTrack + i
		}
	}
	return best
}

// applyDiscIdentity attaches the record's stable identity to a track. mb_disc_id
// and release_mbid are attached when present; disc position only when known (>0),
// so the (mb_disc_id, position) tombstone key forms only when it is trustworthy.
func applyDiscIdentity(t *librarySyncTrack, r *DiscIdentityRecord, position int) {
	if r.MBDiscID != "" {
		v := r.MBDiscID
		t.MBDiscID = &v
	}
	if r.ReleaseMBID != "" {
		v := r.ReleaseMBID
		t.ReleaseMBID = &v
	}
	if position > 0 {
		p := position
		t.DiscTrackIndex = &p
	}
}

// recordTOC rebuilds a TOC from a record's stored toc_raw for duration math.
func recordTOC(r *DiscIdentityRecord) *TOC {
	return &TOC{
		FirstTrack:    r.TOCRaw.FirstTrack,
		LastTrack:     r.TOCRaw.LastTrack,
		LeadoutOffset: r.TOCRaw.LeadoutOffset,
		TrackOffsets:  r.TOCRaw.TrackOffsets,
	}
}

// albumKey normalizes (album_artist, album) into one match key. Uses the same
// NFKD normalization as the local-ID, so it degrades gracefully across tag drift.
func albumKey(album, albumArtist string) string {
	a := normalizeForLocalID(album)
	if a == "" {
		return ""
	}
	return normalizeForLocalID(albumArtist) + "\x1f" + a
}

// albumTagKey is albumKey for a sync track, falling back to track artist when the
// album_artist tag is absent.
func albumTagKey(t *librarySyncTrack) string {
	aa := ""
	if t.AlbumArtist != nil {
		aa = *t.AlbumArtist
	}
	if aa == "" {
		aa = t.ArtistName
	}
	return albumKey(t.AlbumName, aa)
}

func absInt(x int) int {
	if x < 0 {
		return -x
	}
	return x
}
