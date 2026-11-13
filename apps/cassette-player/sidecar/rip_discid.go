// MusicBrainz Disc ID computation (Chunk 3).
//
// The Disc ID is a hash of the disc's TOC: first track, last track, and the
// LBA offsets of every track plus the lead-out. It is the key that turns an
// anonymous audio CD into a specific MusicBrainz release. Algorithm (per
// https://musicbrainz.org/doc/Disc_ID_Calculation):
//
//   s  = sprintf("%02X", firstTrack)
//   s += sprintf("%02X", lastTrack)
//   for i in 0..99: s += sprintf("%08X", offset[i])   // [0]=leadout, [1..]=tracks
//   sha1 = SHA1(s)                                     // over the ASCII hex string
//   discID = base64(sha1) with +/= -> ._-
//
// This file is pure computation — no drive access — so it is fully unit- and
// fixture-testable without a disc (see rip_discid_test.go).

package main

import (
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"strings"
)

// TOC is a disc table of contents in MusicBrainz terms.
//
//	FirstTrack / LastTrack: 1-based track numbers (FirstTrack is almost always 1).
//	LeadoutOffset:          LBA of the lead-out used for the DISC ID. On an enhanced
//	                        (CD-Extra) disc this is the start of the trailing DATA
//	                        track (the freedb/MB convention), which is PAST the audio.
//	AudioLeadout:           LBA where the AUDIO program actually ends (the audio
//	                        session's lead-out). Equals LeadoutOffset on a plain audio
//	                        CD; SMALLER on an enhanced CD. Used for the last track's
//	                        true duration AND to bound its rip so cd-paranoia never
//	                        over-reads into the unreadable inter-session gap. 0 when
//	                        unknown (e.g. the cd-paranoia probe, which can't see it).
//	TrackOffsets:           LBA of each track start, in order, len == LastTrack-FirstTrack+1.
//
// Offsets are absolute CD frames (75/sec). Track 1 conventionally starts at 150
// (the 2-second pregap); a TOC reader that reports 0-based LSNs must add 150.
type TOC struct {
	FirstTrack    int
	LastTrack     int
	LeadoutOffset int
	AudioLeadout  int
	TrackOffsets  []int
}

// mbDiscIDAlphabet is standard base64 with the three URL-unsafe characters
// remapped, matching libdiscid's output.
var mbDiscIDReplacer = strings.NewReplacer("+", ".", "/", "_", "=", "-")

// DiscID computes the MusicBrainz Disc ID for this TOC.
func (t TOC) DiscID() (string, error) {
	if t.FirstTrack < 1 || t.LastTrack < t.FirstTrack || t.LastTrack > 99 {
		return "", fmt.Errorf("invalid track range %d..%d", t.FirstTrack, t.LastTrack)
	}
	n := t.LastTrack - t.FirstTrack + 1
	if len(t.TrackOffsets) != n {
		return "", fmt.Errorf("have %d track offsets, expected %d", len(t.TrackOffsets), n)
	}

	var b strings.Builder
	fmt.Fprintf(&b, "%02X", t.FirstTrack)
	fmt.Fprintf(&b, "%02X", t.LastTrack)
	// 100 slots: slot 0 = leadout, slots 1..LastTrack = track offsets, rest 0.
	var slots [100]int
	slots[0] = t.LeadoutOffset
	for i, off := range t.TrackOffsets {
		slots[t.FirstTrack+i] = off
	}
	for _, off := range slots {
		fmt.Fprintf(&b, "%08X", off)
	}

	sum := sha1.Sum([]byte(b.String()))
	return mbDiscIDReplacer.Replace(base64.StdEncoding.EncodeToString(sum[:])), nil
}
