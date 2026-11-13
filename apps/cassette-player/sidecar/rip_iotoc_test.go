package main

import (
	"encoding/hex"
	"testing"
)

// A real IOCDMedia "TOC" blob captured from an enhanced CD (blink-182 self-titled:
// 14 audio tracks in session 1, a data track in session 2). Parsing it must
// reproduce cd-paranoia's identity EXACTLY — same disc ID — which is the proof that
// the IORegistry TOC is sufficient to identify a disc without spinning the drive.
const fixtureIOKitTOCEnhanced = "00ff0102011000a000000000010000011000a1000000000e0000011000a2000000003117210110000100000000000200011000020000000002362e0110000300000000052609011000040000000009191c01100005000000000e2d1f0110000600000000111a290110000700000000141e1f0110000800000000162a39011000090000000018234a0110000a000000001c37380110000b0000000021072e0110000c00000000231c0e0110000d000000002808100110000e000000002b0242015000b033352102400743015000c0000000005f0000021400a0000000000f0000021400a1000000000f0000021400a2000000004007430214000f00000000333721"

func TestParseIOKitTOC_EnhancedCD(t *testing.T) {
	b, err := hex.DecodeString(fixtureIOKitTOCEnhanced)
	if err != nil {
		t.Fatal(err)
	}
	toc, ok := parseIOKitTOC(b)
	if !ok {
		t.Fatal("parseIOKitTOC returned ok=false on a valid enhanced-CD TOC")
	}
	if toc.FirstTrack != 1 || toc.LastTrack != 14 {
		t.Errorf("track range = %d..%d, want 1..14 (audio only; the data track is excluded)", toc.FirstTrack, toc.LastTrack)
	}
	if len(toc.TrackOffsets) != 14 {
		t.Fatalf("got %d track offsets, want 14", len(toc.TrackOffsets))
	}
	if toc.TrackOffsets[0] != 150 {
		t.Errorf("track 1 offset = %d, want 150 (the 2s pregap)", toc.TrackOffsets[0])
	}
	// The disc-ID lead-out is the DATA track's start (233658), not session 1's A2
	// (222258) — the CD-Extra convention cd-paranoia uses.
	if toc.LeadoutOffset != 233658 {
		t.Errorf("leadout = %d, want 233658 (data track start, not session-1 A2)", toc.LeadoutOffset)
	}
	// The AUDIO lead-out is session 1's A2 (222258) — where the audio actually ends.
	// This is what bounds the last track's rip + its true duration.
	if toc.AudioLeadout != 222258 {
		t.Errorf("audio leadout = %d, want 222258 (session-1 A2, the real end of audio)", toc.AudioLeadout)
	}
	// The last track's duration must use the AUDIO lead-out: ~6:21 (the real song),
	// NOT 8:52 (which would include the unreadable inter-session gap).
	durs := tocTrackDurationsMs(toc)
	last := durs[len(durs)-1] / 1000
	if last < 379 || last > 383 {
		t.Errorf("last track duration = %d:%02d, want ~6:21 (audio only, not 8:52 incl. gap)", last/60, last%60)
	}
	// THE proof: the freedb disc ID matches what the sidecar computed from cd-paranoia.
	if got := freedbDiscIDHex(toc); got != "c40c290e" {
		t.Errorf("freedb disc id = %s, want c40c290e (must equal cd-paranoia's identity)", got)
	}
	// And the MusicBrainz disc ID computes cleanly.
	if id, err := toc.DiscID(); err != nil || id == "" {
		t.Errorf("MB DiscID() = %q, err=%v; want a non-empty id", id, err)
	}
}

// A malformed / empty blob must read as "no TOC" so the caller falls back to cd-paranoia.
func TestParseIOKitTOC_RejectsGarbage(t *testing.T) {
	if _, ok := parseIOKitTOC(nil); ok {
		t.Error("nil blob must not parse")
	}
	if _, ok := parseIOKitTOC([]byte{0x00, 0xff, 0x01, 0x01}); ok {
		t.Error("header-only blob (no descriptors / no audio tracks) must not parse")
	}
}
