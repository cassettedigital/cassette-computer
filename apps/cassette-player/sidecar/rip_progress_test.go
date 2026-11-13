package main

import (
	"testing"
	"time"
)

// computeEta extrapolates remaining time from the empirical per-completed-track
// rate. Sub-second fixture rips round to 0; this pins the real-disc behaviour.
func TestComputeEta(t *testing.T) {
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	orig := nowFn
	defer func() { nowFn = orig }()
	// 2 of 12 tracks done after 30s elapsed → 15s/track → 10 left → 150s.
	nowFn = func() time.Time { return base.Add(30 * time.Second) }

	p := &RipProgress{State: "ripping", StartedAt: base, TrackCount: 12, CompletedTracks: 2}
	p.computeEta()
	if p.EtaSeconds != 150 {
		t.Fatalf("EtaSeconds = %d, want 150", p.EtaSeconds)
	}

	// No ETA before the first track lands, or once not ripping.
	p.CompletedTracks = 0
	p.computeEta()
	if p.EtaSeconds != 0 {
		t.Fatalf("EtaSeconds = %d with 0 completed, want 0", p.EtaSeconds)
	}
	p.CompletedTracks, p.State = 6, "done"
	p.computeEta()
	if p.EtaSeconds != 0 {
		t.Fatalf("EtaSeconds = %d when done, want 0", p.EtaSeconds)
	}
}
