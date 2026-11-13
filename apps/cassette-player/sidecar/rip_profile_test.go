package main

import "testing"

// JOB 1 — the intrinsic profile is computed once and holds the disc's own facts.
func TestBuildDiscProfile(t *testing.T) {
	toc := fixtureTOC
	p := buildDiscProfile(&toc, fixtureDiscID)
	if p.TrackCount != 12 {
		t.Errorf("TrackCount = %d, want 12", p.TrackCount)
	}
	if len(p.DurationsMs) != 12 {
		t.Errorf("DurationsMs len = %d, want 12", len(p.DurationsMs))
	}
	if p.TotalLenMs <= 0 {
		t.Errorf("TotalLenMs = %d, want > 0", p.TotalLenMs)
	}
	if p.MBDiscID != fixtureDiscID {
		t.Errorf("MBDiscID = %q, want %q", p.MBDiscID, fixtureDiscID)
	}
	if len(p.FreedbDiscID) != 8 {
		t.Errorf("FreedbDiscID = %q, want 8 hex", p.FreedbDiscID)
	}
}

// JOB 5 — a negative is a recorded fact, deduped per source.
func TestRecordNegative(t *testing.T) {
	p := &DiscProfile{}
	if p.hasNegative("gnudb") {
		t.Fatal("fresh profile should have no negatives")
	}
	p.recordNegative("gnudb", "202")
	p.recordNegative("gnudb", "no_match") // same source — must not duplicate
	p.recordNegative("mb_disc_id", "not_found")
	if len(p.Negatives) != 2 {
		t.Fatalf("Negatives = %d, want 2 (deduped per source): %+v", len(p.Negatives), p.Negatives)
	}
	if !p.hasNegative("gnudb") || !p.hasNegative("mb_disc_id") {
		t.Errorf("hasNegative missed a recorded source: %+v", p.Negatives)
	}
	if p.Negatives[0].Reason != "202" {
		t.Errorf("first recorded reason should win, got %q", p.Negatives[0].Reason)
	}
}

// The TOC signature is stable for a disc and distinguishes different discs — the
// strictest non-database key for the memory index.
func TestTocSignature(t *testing.T) {
	toc := fixtureTOC
	a := tocSignature(&toc)
	b := tocSignature(&toc)
	if a == "" || a != b {
		t.Fatalf("signature unstable: %q vs %q", a, b)
	}
	other := fixtureTOC
	other.TrackOffsets = append([]int(nil), other.TrackOffsets...)
	other.TrackOffsets[3] += 17 // a different pressing
	if tocSignature(&other) == a {
		t.Error("a changed TOC must hash differently")
	}
	if tocSignature(nil) != "" {
		t.Error("nil TOC signature must be empty")
	}
}
