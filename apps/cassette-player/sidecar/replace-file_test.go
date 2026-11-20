package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

var errHeldForTest = errors.New("held")

func heldForTest(err error) bool { return errors.Is(err, errHeldForTest) }

// A hold that lets go inside the wait: the swap lands, after pausing only as long as needed.
func TestReplaceFileWaitsOutABriefHold(t *testing.T) {
	tries := 0
	rename := func(string, string) error {
		tries++
		if tries < 4 {
			return errHeldForTest
		}
		return nil
	}
	var slept time.Duration
	err := replaceFileWith(rename, heldForTest, func(d time.Duration) { slept += d }, 8*time.Second, "a", "b")
	if err != nil {
		t.Fatalf("want the swap to land, got %v", err)
	}
	if tries != 4 {
		t.Fatalf("want 4 tries, got %d", tries)
	}
	if slept != 350*time.Millisecond { // 50 + 100 + 200
		t.Fatalf("want 350ms of pauses, got %v", slept)
	}
}

// A hold that outlasts the wait: the error comes back, and the pauses never add up past the wait.
func TestReplaceFileGivesUpAtTheWait(t *testing.T) {
	var slept time.Duration
	err := replaceFileWith(func(string, string) error { return errHeldForTest }, heldForTest, func(d time.Duration) { slept += d }, 8*time.Second, "a", "b")
	if !errors.Is(err, errHeldForTest) {
		t.Fatalf("want the hold's error back, got %v", err)
	}
	if slept != 8*time.Second {
		t.Fatalf("want exactly the 8s wait, got %v", slept)
	}
}

// Any other failure comes back at once: no waiting on a file that isn't held.
func TestReplaceFileDoesNotWaitOnOtherErrors(t *testing.T) {
	other := errors.New("no such folder")
	tries := 0
	err := replaceFileWith(func(string, string) error { tries++; return other }, heldForTest, func(time.Duration) { t.Fatal("slept on an error that isn't a hold") }, 8*time.Second, "a", "b")
	if !errors.Is(err, other) || tries != 1 {
		t.Fatalf("want one try and the error back, got %d tries, %v", tries, err)
	}
}

// The real thing on this computer: the temp takes the song's place.
func TestReplaceFileSwapsTheFile(t *testing.T) {
	dir := t.TempDir()
	from, to := filepath.Join(dir, "song.flac.cassette.tmp.1"), filepath.Join(dir, "song.flac")
	if err := os.WriteFile(to, []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(from, []byte("new"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := replaceFile(from, to); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(to)
	if string(got) != "new" {
		t.Fatalf("want the new copy in place, got %q", got)
	}
	if _, err := os.Stat(from); !os.IsNotExist(err) {
		t.Fatalf("want the temp gone, got %v", err)
	}
}
