package main

import (
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"
)

// TestSaveStateDuringLibraryPass (BUG-788): a save on one goroutine while the
// library pass writes the MusicBrainz map on another must not abort the
// process, and the file on disk must always be whole. Run with -race.
func TestSaveStateDuringLibraryPass(t *testing.T) {
	prev := sidecarDataDir
	sidecarDataDir = t.TempDir()
	t.Cleanup(func() { sidecarDataDir = prev })

	state := &SidecarState{MBIDResolutionState: map[string]*MBIDFileState{}}
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for i := 0; i < 2000; i++ {
			setMBIDFileState(state, fmt.Sprintf("/music/%d.flac", i), &MBIDFileState{})
		}
	}()
	go func() {
		defer wg.Done()
		for i := 0; i < 50; i++ {
			if err := saveState(state); err != nil {
				t.Error(err)
				return
			}
		}
	}()
	wg.Wait()

	data, err := os.ReadFile(statePath())
	if err != nil {
		t.Fatal(err)
	}
	var back SidecarState
	if err := json.Unmarshal(data, &back); err != nil {
		t.Fatalf("sidecar.json is not whole: %v", err)
	}
}

// TestWaitForPairingKeepsWaitingAndKeepsState (BUG-788): a failed attempt
// doesn't end the wait, and signing in keeps what this launch already knew.
func TestWaitForPairingKeepsWaitingAndKeepsState(t *testing.T) {
	prev := sidecarDataDir
	sidecarDataDir = t.TempDir()
	t.Cleanup(func() { sidecarDataDir = prev })

	since := time.Now().Add(-time.Minute)
	state := &SidecarState{InstallID: "install-1", FolderArtSince: since}
	results := make(chan pairingResult, 2)
	results <- pairingResult{err: fmt.Errorf("callback received without token")}
	results <- pairingResult{state: &SidecarState{BearerToken: "tok", SubsonicUsername: "cassette", PairedAt: time.Now()}}

	if err := waitForPairing(state, results); err != nil {
		t.Fatal(err)
	}
	if state.BearerToken != "tok" || state.SubsonicUsername != "cassette" {
		t.Errorf("sign-in not taken: %+v", state)
	}
	if state.InstallID != "install-1" || !state.FolderArtSince.Equal(since) {
		t.Errorf("signing in wiped what the hub already knew: install=%q since=%v", state.InstallID, state.FolderArtSince)
	}
}

// TestSignInStaysInMemoryForTheApp (BUG-859): a hub the app started never writes its sign-in to sidecar.json, and
// keeps using it from memory; a hub run by hand, with no app to hand it over, keeps its copy.
func TestSignInStaysInMemoryForTheApp(t *testing.T) {
	prevDir, prevKey := sidecarDataDir, localKey
	t.Cleanup(func() { sidecarDataDir, localKey = prevDir, prevKey })
	read := func() *SidecarState {
		data, err := os.ReadFile(statePath())
		if err != nil {
			t.Fatal(err)
		}
		var s SidecarState
		if err := json.Unmarshal(data, &s); err != nil {
			t.Fatal(err)
		}
		return &s
	}

	sidecarDataDir, localKey = t.TempDir(), "launch-key"
	state := &SidecarState{BearerToken: "tok", SubsonicUsername: "me"}
	if err := saveState(state); err != nil {
		t.Fatal(err)
	}
	if got := read(); got.BearerToken != "" || got.SubsonicUsername != "me" {
		t.Fatalf("app-started hub wrote %+v, want the sign-in left out and the rest kept", got)
	}
	if state.BearerToken != "tok" {
		t.Fatal("the hub lost the sign-in it runs on")
	}

	sidecarDataDir, localKey = t.TempDir(), ""
	if err := saveState(state); err != nil {
		t.Fatal(err)
	}
	if got := read(); got.BearerToken != "tok" {
		t.Fatalf("hand-run hub wrote %q, want its sign-in kept", got.BearerToken)
	}
}
