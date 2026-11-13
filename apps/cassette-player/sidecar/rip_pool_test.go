package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPoolGated(t *testing.T) {
	cases := []struct {
		name string
		rec  DiscIdentityRecord
		want bool
	}{
		{"confident auto", DiscIdentityRecord{MBDiscID: "A", Confidence: 0.80, ConfirmedVia: "auto"}, true},
		{"confident detect", DiscIdentityRecord{MBDiscID: "A", Confidence: 0.97, ConfirmedVia: "detect"}, true},
		{"sub-threshold user_pick", DiscIdentityRecord{MBDiscID: "A", Confidence: 0.62, ConfirmedVia: "user_pick"}, true},
		{"sub-threshold acoustid", DiscIdentityRecord{MBDiscID: "A", Confidence: 0.5, ConfirmedVia: "acoustid"}, true},
		{"sub-threshold non-confirmed (import-as-unknown shape)", DiscIdentityRecord{MBDiscID: "A", Confidence: 0.62, ConfirmedVia: "detect"}, false},
		{"no mb_disc_id", DiscIdentityRecord{MBDiscID: "", Confidence: 0.99, ConfirmedVia: "auto"}, false},
	}
	for _, c := range cases {
		if got := poolGated(&c.rec); got != c.want {
			t.Errorf("%s: poolGated = %v, want %v", c.name, got, c.want)
		}
	}
}

func TestPoolRecordBetter(t *testing.T) {
	hi := DiscIdentityRecord{Confidence: 0.97, ConfirmedVia: "detect"}
	lo := DiscIdentityRecord{Confidence: 0.85, ConfirmedVia: "user_pick"}
	if !poolRecordBetter(hi, lo) || poolRecordBetter(lo, hi) {
		t.Error("higher confidence must win")
	}
	corr := DiscIdentityRecord{Confidence: 0.9, Corroborated: true, ConfirmedVia: "auto"}
	noco := DiscIdentityRecord{Confidence: 0.9, Corroborated: false, ConfirmedVia: "auto"}
	if !poolRecordBetter(corr, noco) || poolRecordBetter(noco, corr) {
		t.Error("at equal confidence, corroborated must win")
	}
	pick := DiscIdentityRecord{Confidence: 0.9, Corroborated: true, ConfirmedVia: "user_pick"}
	auto := DiscIdentityRecord{Confidence: 0.9, Corroborated: true, ConfirmedVia: "auto"}
	if !poolRecordBetter(pick, auto) || poolRecordBetter(auto, pick) {
		t.Error("at equal confidence+corroboration, higher confirmed_via rank must win")
	}
	if poolRecordBetter(auto, auto) {
		t.Error("fully equal must not be 'better' (keep incumbent)")
	}
}

func TestToPoolDiscIdentityStripsLocalFields(t *testing.T) {
	confirmer := "cassette-qsvdgam0"
	rec := DiscIdentityRecord{
		MBDiscID:     "Aaq8tB2T",
		Album:        "American Stories",
		Confidence:   0.95,
		ConfirmedVia: "detect",
		Confirmer:    &confirmer,
		CreatedAt:    "2026-06-25T15:42:09Z",
		UpdatedAt:    "2026-06-25T15:42:09Z",
	}
	out, err := json.Marshal(toPoolDiscIdentity(rec))
	if err != nil {
		t.Fatal(err)
	}
	js := string(out)
	for _, banned := range []string{"confirmer", "created_at", "updated_at", "cassette-qsvdgam0"} {
		if strings.Contains(js, banned) {
			t.Errorf("wire record leaked machine-local field %q: %s", banned, js)
		}
	}
	// Public facts the server needs must still be present.
	for _, want := range []string{`"mb_disc_id"`, `"confidence"`, `"confirmed_via"`} {
		if !strings.Contains(js, want) {
			t.Errorf("wire record missing public field %q: %s", want, js)
		}
	}
}

func TestGatherPoolDiscIdentities(t *testing.T) {
	old := sidecarDataDir
	t.Cleanup(func() { sidecarDataDir = old })
	sidecarDataDir = t.TempDir()

	recs := []DiscIdentityRecord{
		// Disc A — two records; the 0.97 user_pick must win the dedup.
		{MBDiscID: "A", Confidence: 0.85, ConfirmedVia: "detect"},
		{MBDiscID: "A", Confidence: 0.97, ConfirmedVia: "user_pick", Album: "Best A"},
		// Disc B — sub-threshold but user-confirmed → gated IN.
		{MBDiscID: "B", Confidence: 0.62, ConfirmedVia: "user_pick"},
		// Disc C — sub-threshold and not confirmed → gated OUT.
		{MBDiscID: "C", Confidence: 0.62, ConfirmedVia: "detect"},
		// No mb_disc_id → can't pool.
		{MBDiscID: "", Confidence: 0.99, ConfirmedVia: "auto"},
	}
	for _, r := range recs {
		if err := appendDiscIdentity(r); err != nil {
			t.Fatal(err)
		}
	}

	out := gatherPoolDiscIdentities()
	if len(out) != 2 {
		t.Fatalf("expected 2 gated+deduped discs (A,B), got %d: %+v", len(out), out)
	}
	// Sorted by mb_disc_id: A then B.
	if out[0].MBDiscID != "A" || out[0].Confidence != 0.97 || out[0].Album != "Best A" {
		t.Errorf("disc A: best record not selected: %+v", out[0])
	}
	if out[1].MBDiscID != "B" {
		t.Errorf("disc B should be gated in (user-confirmed): %+v", out[1])
	}
}

// Phase-2 gate: markRipComplete stamps rip_complete on EVERY record for a disc
// (so the best-record dedup carries it regardless of which row wins), leaves other
// discs untouched, surfaces on the wire, and is idempotent + safe on missing ids.
func TestMarkRipComplete(t *testing.T) {
	old := sidecarDataDir
	t.Cleanup(func() { sidecarDataDir = old })
	sidecarDataDir = t.TempDir()

	for _, r := range []DiscIdentityRecord{
		{MBDiscID: "A", Confidence: 0.95, ConfirmedVia: "detect"},                 // incomplete
		{MBDiscID: "A", Confidence: 0.97, ConfirmedVia: "user_pick", Album: "A!"}, // incomplete, wins dedup
		{MBDiscID: "B", Confidence: 0.95, ConfirmedVia: "detect"},                 // stays incomplete
	} {
		if err := appendDiscIdentity(r); err != nil {
			t.Fatal(err)
		}
	}

	markRipComplete("A")

	// On disk: both A records flip true; B stays false.
	for _, rec := range loadDiscIdentities() {
		want := rec.MBDiscID == "A"
		if rec.RipComplete != want {
			t.Errorf("disc %s: rip_complete = %v, want %v", rec.MBDiscID, rec.RipComplete, want)
		}
	}

	// On the wire: A reports complete (via the winning 0.97 record), B does not.
	byID := map[string]poolDiscIdentity{}
	for _, p := range gatherPoolDiscIdentities() {
		byID[p.MBDiscID] = p
	}
	if !byID["A"].RipComplete {
		t.Errorf("disc A wire record must report rip_complete=true: %+v", byID["A"])
	}
	if byID["B"].RipComplete {
		t.Errorf("disc B wire record must stay rip_complete=false: %+v", byID["B"])
	}

	// Idempotent + no panic on unknown / empty id.
	markRipComplete("A")
	markRipComplete("nonexistent")
	markRipComplete("")
}
