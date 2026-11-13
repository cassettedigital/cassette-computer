package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func writeRipRecord(t *testing.T, dir string, rec completenessRecord) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	data, err := json.MarshalIndent(rec, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, ".cassette-rip.json"), data, 0o644); err != nil {
		t.Fatal(err)
	}
}

// The launch reconcile must pick up exactly the rips that landed tracks but never
// registered — skipping already-registered and empty rips — so a killed post-rip
// scan is finished on the next launch (BUG-256).
func TestFindUnregisteredRipRecords(t *testing.T) {
	root := t.TempDir()
	writeRipRecord(t, filepath.Join(root, "Alvvays", "Blue Rev"), completenessRecord{
		Album: "Blue Rev", AlbumArtist: "Alvvays", ExpectedTracks: 14, LandedTracks: 14,
		Registered: false, RippedAt: "2026-08-19T16:31:53Z",
	})
	writeRipRecord(t, filepath.Join(root, "Artist B", "Done Album"), completenessRecord{
		Album: "Done Album", AlbumArtist: "Artist B", ExpectedTracks: 10, LandedTracks: 10, Registered: true,
	})
	writeRipRecord(t, filepath.Join(root, "Artist C", "Empty"), completenessRecord{
		Album: "Empty", AlbumArtist: "Artist C", ExpectedTracks: 12, LandedTracks: 0, Registered: false,
	})

	got := findUnregisteredRipRecords(root)
	if len(got) != 1 {
		t.Fatalf("want 1 unregistered record, got %d: %+v", len(got), got)
	}
	if got[0].rec.Album != "Blue Rev" || got[0].rec.LandedTracks != 14 {
		t.Fatalf("wrong record surfaced: %+v", got[0].rec)
	}
}

// Healing the flag must flip registered:true in place without disturbing the
// record's identity/provenance, and the record must then drop out of the pending
// set (so it isn't reprocessed every launch).
func TestMarkRipRegisteredHealsFlagInPlace(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "Alvvays", "Blue Rev")
	rec := completenessRecord{
		Album: "Blue Rev", AlbumArtist: "Alvvays",
		ReleaseMBID:    "92b28e5a-69a2-4046-8d7e-2d78f2a572d9",
		ExpectedTracks: 14, LandedTracks: 14, Registered: false, RippedAt: "2026-08-19T16:31:53Z",
	}
	writeRipRecord(t, dir, rec)

	markRipRegistered(&SidecarState{}, unregisteredRip{dir: dir, rec: rec})

	data, err := os.ReadFile(filepath.Join(dir, ".cassette-rip.json"))
	if err != nil {
		t.Fatal(err)
	}
	var got completenessRecord
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if !got.Registered {
		t.Fatal("expected Registered=true after markRipRegistered")
	}
	if got.Album != "Blue Rev" || got.LandedTracks != 14 ||
		got.ReleaseMBID != rec.ReleaseMBID || got.RippedAt != rec.RippedAt {
		t.Fatalf("markRipRegistered disturbed the record: %+v", got)
	}
	if n := len(findUnregisteredRipRecords(root)); n != 0 {
		t.Fatalf("healed record still listed as unregistered (n=%d)", n)
	}
}
