package main

import (
	"os"
	"testing"
)

// TestEveryLibraryPageCarriesTheComputerID (BUG-862): the cloud refuses a library
// from a computer that isn't the account's main one, so every page says which
// computer sent it, the old single request included.
func TestEveryLibraryPageCarriesTheComputerID(t *testing.T) {
	prevID := computerID
	computerID = "0f8e2a4c-1b3d-4e5f-8a9b-0c1d2e3f4a5b"
	t.Cleanup(func() { computerID = prevID })

	for _, gzipOK := range []bool{true, false} {
		srv, seen := fakeLibraryCloud(t, gzipOK)
		prev := cassetteBase
		cassetteBase = srv.URL
		n := librarySyncPageTracks + 3
		if err := postLibrarySync("tok", librarySyncPayload{Tracks: manyTracks(n), SyncMode: "full"}); err != nil {
			t.Fatal(err)
		}
		cassetteBase = prev
		for i, s := range *seen {
			if s.gzip && !gzipOK {
				continue // the refused compressed first page never reached the decoder
			}
			if s.payload.ComputerID != computerID {
				t.Errorf("gzip=%v request %d: computerId %q, want %q", gzipOK, i, s.payload.ComputerID, computerID)
			}
		}
		if len(*seen) == 0 {
			t.Fatalf("gzip=%v: no request reached the cloud", gzipOK)
		}
	}
}

// TestTheComputerIDIsMintedOnceAndKept: a second call returns the same id, so
// the account's slot keeps recognising this computer across launches.
func TestTheComputerIDIsMintedOnceAndKept(t *testing.T) {
	prevID := computerID
	t.Cleanup(func() { computerID = prevID })
	prevDir := sidecarDataDir
	sidecarDataDir = t.TempDir()
	t.Cleanup(func() { sidecarDataDir = prevDir })

	s := &SidecarState{}
	first := ensureComputerID(s)
	if first == "" || s.ComputerID != first || computerID != first {
		t.Fatalf("first mint: got %q, state %q, global %q", first, s.ComputerID, computerID)
	}
	if again := ensureComputerID(s); again != first {
		t.Fatalf("second call minted a new id: %q then %q", first, again)
	}
	loaded, err := loadState()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.ComputerID != first {
		t.Fatalf("not persisted: saved %q, loaded %q", first, loaded.ComputerID)
	}
}

// TestALostStateFileKeepsTheSameComputerID: a hub that starts fresh (sidecar.json
// gone) picks its id back up from the side file, so the main computer is never
// refused by its own slot.
func TestALostStateFileKeepsTheSameComputerID(t *testing.T) {
	prevID := computerID
	t.Cleanup(func() { computerID = prevID })
	prevDir := sidecarDataDir
	sidecarDataDir = t.TempDir()
	t.Cleanup(func() { sidecarDataDir = prevDir })

	first := ensureComputerID(&SidecarState{})
	if err := os.Remove(statePath()); err != nil {
		t.Fatal(err)
	}
	if again := ensureComputerID(&SidecarState{}); again != first {
		t.Fatalf("fresh state minted a new id: %q then %q", first, again)
	}
}
