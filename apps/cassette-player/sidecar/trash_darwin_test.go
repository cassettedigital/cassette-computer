//go:build darwin

package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestTrashFile creates a real temp file, trashes it via trashFile, and
// verifies that:
//   (a) the original path no longer exists (the file left its source location)
//   (b) a file with the same base name now exists in $HOME/.Trash/
//
// The test attempts to clean up the trashed file afterwards.
func TestTrashFile(t *testing.T) {
	// Create a temp directory and a file inside it.
	tmpDir := t.TempDir()
	tmpFile := filepath.Join(tmpDir, "cassette-trash-test.txt")
	if err := os.WriteFile(tmpFile, []byte("trash me"), 0o644); err != nil {
		t.Fatalf("could not create temp file: %v", err)
	}

	// Verify it exists before we trash it.
	if _, err := os.Stat(tmpFile); err != nil {
		t.Fatalf("temp file should exist before trash: %v", err)
	}

	// Call trashFile.
	if err := trashFile(tmpFile); err != nil {
		t.Fatalf("trashFile returned error: %v", err)
	}

	// (a) Original path must no longer exist.
	if _, err := os.Stat(tmpFile); !os.IsNotExist(err) {
		t.Errorf("original path should not exist after trash; stat err = %v", err)
	}

	// (b) A file with that base name should now exist in ~/.Trash/.
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatalf("could not get home dir: %v", err)
	}
	trashBase := filepath.Join(home, ".Trash")
	trashedPath := filepath.Join(trashBase, filepath.Base(tmpFile))

	info, err := os.Stat(trashedPath)
	if err != nil {
		// macOS may rename the trashed file if there's a collision; walk .Trash to
		// see if any file that starts with our base name is there.
		entries, readErr := os.ReadDir(trashBase)
		if readErr != nil {
			t.Errorf("file not found in ~/.Trash at expected path %q: %v", trashedPath, err)
		} else {
			baseName := "cassette-trash-test"
			found := false
			for _, e := range entries {
				if len(e.Name()) >= len(baseName) && e.Name()[:len(baseName)] == baseName {
					// Attempt cleanup of this name-variant.
					_ = os.Remove(filepath.Join(trashBase, e.Name()))
					found = true
					break
				}
			}
			if !found {
				t.Errorf("file not found in ~/.Trash (checked entries); last stat err: %v", err)
			}
		}
		return
	}

	t.Logf("trashed file found in ~/.Trash: %s (size=%d)", trashedPath, info.Size())

	// Clean up the trashed test file.
	if err := os.Remove(trashedPath); err != nil {
		t.Logf("note: could not remove trashed test file %s: %v", trashedPath, err)
	}
}

// TestTrashFileRelativePath verifies that trashFile rejects non-absolute paths
// immediately, without touching the filesystem.
func TestTrashFileRelativePath(t *testing.T) {
	err := trashFile("relative/path/file.flac")
	if err == nil {
		t.Fatal("expected error for relative path, got nil")
	}
	t.Logf("correctly rejected relative path: %v", err)
}
