// The intrinsic disc profile (JOB 1) and recorded negatives (JOB 5).
//
// Per CASSETTE_IDENTIFICATION_ARCHITECTURE.md, identification has three layers
// the old flow blurred. This file owns the first: the INTRINSIC PROFILE — the
// facts we compute from the disc itself, depending on no external database.
//
// The profile is computed ONCE on detect and is the constant that travels
// through the whole resolve flow: every source and the scorer read from it, and
// it is the key the local memory index (rung zero) matches an incoming disc on.
// CD-TEXT and the AcoustID fingerprint are populated lazily (they cost a disc
// read / a fingerprint pass) but live on the same object once obtained.

package main

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
)

// DiscProfile is everything we know about a disc independent of any source.
// It is computed once (buildDiscProfile) and carried through resolveDisc, the
// confirm path, and the persisted disc-identity record.
type DiscProfile struct {
	TrackCount   int    // from the TOC
	DurationsMs  []int  // per-track durations, the duration vector the scorer uses
	TotalLenMs   int    // sum of DurationsMs
	MBDiscID     string // computed MusicBrainz disc ID
	FreedbDiscID string // computed freedb/gnudb disc ID
	TOC          *TOC   // the raw table of contents (re-hashed for the memory index)

	// Populated lazily — present only once the disc has been read for them.
	CDText         *CDText  // nil until readCT() fires (rung-1 miss)
	Fingerprint    string   // AcoustID Chromaprint fingerprint, "" until a scan computes it
	RecordingMBIDs []string // AcoustID recording MBIDs, for cross-pressing clusters

	// Negatives (JOB 5): per-source misses, recorded as precise facts rather than
	// discarded. Used to (a) avoid re-querying a known miss within a session and
	// (b) populate the "gaps we could fill" in the contribution dataset.
	Negatives []SourceNegative
}

// SourceNegative is one recorded miss: a source asked, and what it answered.
// A negative is a fact ("mb_disc_id: not_found", "gnudb: 202", "cdtext: absent"),
// not the absence of one.
type SourceNegative struct {
	Source string `json:"source"` // mb_disc_id | gnudb | mb_fuzzy_toc | cd_text | acoustid
	Reason string `json:"reason"` // not_found | no_match | 202 | absent | error
}

// buildDiscProfile computes the intrinsic profile from the TOC and the disc ID
// (already derived by the caller). CD-TEXT / fingerprint are attached later.
func buildDiscProfile(toc *TOC, mbDiscID string) *DiscProfile {
	dur := tocTrackDurationsMs(toc)
	total := 0
	for _, d := range dur {
		total += d
	}
	return &DiscProfile{
		TrackCount:   len(dur),
		DurationsMs:  dur,
		TotalLenMs:   total,
		MBDiscID:     mbDiscID,
		FreedbDiscID: freedbDiscIDHex(toc),
		TOC:          toc,
	}
}

// recordNegative banks a per-source miss on the profile. Idempotent per source:
// a source's first recorded reason wins (we don't append duplicates).
func (p *DiscProfile) recordNegative(source, reason string) {
	if p == nil {
		return
	}
	for _, n := range p.Negatives {
		if n.Source == source {
			return
		}
	}
	p.Negatives = append(p.Negatives, SourceNegative{Source: source, Reason: reason})
}

// hasNegative reports whether a source already missed this session, so a later
// pass (e.g. the AcoustID scan, or a retry) can skip re-querying a known miss.
func (p *DiscProfile) hasNegative(source string) bool {
	if p == nil {
		return false
	}
	for _, n := range p.Negatives {
		if n.Source == source {
			return true
		}
	}
	return false
}

// tocSignature is a stable hash of the physical TOC (track offsets + leadout).
// Two pressings with the same table of contents hash identically — the strictest
// non-database key for the local memory index, independent of whether any disc
// database holds the disc. Hex-encoded SHA-1 of the canonical offset string.
func tocSignature(toc *TOC) string {
	if toc == nil {
		return ""
	}
	h := sha1.New()
	fmt.Fprintf(h, "%d|%d|%d|", toc.FirstTrack, toc.LastTrack, toc.LeadoutOffset)
	for _, o := range toc.TrackOffsets {
		fmt.Fprintf(h, "%d,", o)
	}
	return hex.EncodeToString(h.Sum(nil))
}
