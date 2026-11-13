package main

import (
	"sort"
)

// IOKit publishes the disc's table of contents in IOCDMedia's "TOC" property. macOS
// reads the TOC ONCE when the disc is inserted and keeps it in the IORegistry until
// the disc is ejected — so we can identify the disc (disc ID, gnudb/freedb ID,
// per-track durations, the alignment input) WITHOUT spinning the drive. Only the
// actual audio extraction (cd-paranoia reading sectors) needs the motor.
//
// The IORegistry read itself (tocFromIOKit) is macOS-specific and lives behind the
// disc platform seam in rip_platform_darwin.go. The BLOB PARSER below is pure
// bytes→struct and stays OS-neutral so it is testable without a drive and reusable
// by a future non-macOS TOC source.

// parseIOKitTOC turns a raw CDTOC blob (IOKit IOCDTypes.h layout) into a TOC. The
// blob is: length(2) sessionFirst(1) sessionLast(1), then 11-byte CDTOCDescriptors:
//
//	session(1) ctrlAdr(1) tno(1) point(1) addr[3] zero(1) pmin psec pframe
//
// ctrlAdr packs ADR in the high nibble and CONTROL in the low nibble; a track whose
// CONTROL has bit 0x4 set is a DATA track. The audio program is the points 1..99 with
// CONTROL 0x4 clear; the disc-ID lead-out is the first DATA track's start after the
// audio (the CD-Extra convention cd-paranoia uses), or the A2 lead-out on a plain
// audio CD. Split out from tocFromIOKit so it's testable against a captured blob.
func parseIOKitTOC(b []byte) (*TOC, bool) {
	if len(b) < 4 {
		return nil, false
	}
	descs := b[4:]
	msf2f := func(mn, s, f byte) int { return (int(mn)*60+int(s))*75 + int(f) }

	type trk struct{ point, off int }
	var audio []trk
	var dataStarts, leadouts []int
	for i := 0; i+11 <= len(descs); i += 11 {
		d := descs[i : i+11]
		control := d[1] & 0x0f
		point := int(d[3])
		off := msf2f(d[8], d[9], d[10])
		switch {
		case point == 0xa2: // session lead-out
			leadouts = append(leadouts, off)
		case point >= 1 && point <= 99:
			if control&0x04 != 0 {
				dataStarts = append(dataStarts, off)
			} else {
				audio = append(audio, trk{point, off})
			}
		}
	}
	if len(audio) == 0 {
		return nil, false
	}
	sort.Slice(audio, func(i, j int) bool { return audio[i].point < audio[j].point })
	first, last := audio[0].point, audio[len(audio)-1].point
	if last-first+1 != len(audio) {
		return nil, false // non-contiguous audio tracks — let cd-paranoia handle it
	}
	offs := make([]int, len(audio))
	for i, t := range audio {
		offs[i] = t.off
	}
	lastAudio := offs[len(offs)-1]

	// AudioLeadout = where the AUDIO program ends: the audio session's A2 lead-out.
	// This is the true end of the last audio track — bounding the rip here keeps
	// cd-paranoia out of the unreadable inter-session gap on an enhanced CD.
	audioLeadout := firstAfter(leadouts, lastAudio)

	// LeadoutOffset (disc ID) = the next addressable thing AFTER the audio program: a
	// trailing data track (CD-Extra) if present, else the audio session's A2.
	leadout := firstAfter(dataStarts, lastAudio)
	if leadout == 0 {
		leadout = audioLeadout
	}
	if leadout == 0 {
		return nil, false
	}
	if audioLeadout == 0 {
		audioLeadout = leadout // plain audio CD: audio ends at the lead-out
	}
	return &TOC{FirstTrack: first, LastTrack: last, LeadoutOffset: leadout, AudioLeadout: audioLeadout, TrackOffsets: offs}, true
}

// firstAfter returns the smallest value in xs strictly greater than min, or 0 if none.
func firstAfter(xs []int, min int) int {
	best := 0
	for _, x := range xs {
		if x > min && (best == 0 || x < best) {
			best = x
		}
	}
	return best
}
