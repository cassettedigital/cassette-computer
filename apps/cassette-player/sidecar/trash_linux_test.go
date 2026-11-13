//go:build linux

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// This file only builds and runs on a real Linux host or Linux CI runner. It
// was never executed on the macOS session that wrote it, only compiled with
// "GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build ./..." (which does not run
// _test.go files at all) and checked by hand against the freedesktop.org
// Trash spec. Treat these as written-but-unrun until a Linux runner picks
// this package up.
//
// The collision and content tests below call specTrash directly rather than
// the public trashFile, so they exercise the hand-rolled freedesktop
// implementation deterministically. Going through trashFile would first try
// "gio trash", and gio's own naming/format conventions (which may differ in
// edge cases from the hand-rolled ones, e.g. its collision-suffix scheme)
// would make these assertions dependent on whether gio happens to be
// installed on the runner.

// TestTrashFileRelativePath verifies that trashFile rejects non-absolute
// paths immediately, without touching the filesystem or trying gio. Mirrors
// trash_darwin_test.go's test of the same name.
func TestTrashFileRelativePath(t *testing.T) {
	err := trashFile("relative/path/file.flac")
	if err == nil {
		t.Fatal("expected error for relative path, got nil")
	}
	t.Logf("correctly rejected relative path: %v", err)
}

// TestSpecTrashHomeTrash creates a real temp file and trashes it via
// specTrash into an isolated $XDG_DATA_HOME (never the real one), then
// verifies:
//
//	(a) the original path no longer exists
//	(b) the file now exists under <trash>/files/
//	(c) a matching <trash>/info/<name>.trashinfo exists with the expected
//	    percent-encoded Path and a DeletionDate key
func TestSpecTrashHomeTrash(t *testing.T) {
	trashHome := t.TempDir()
	t.Setenv("XDG_DATA_HOME", trashHome)

	srcDir := t.TempDir()
	srcFile := filepath.Join(srcDir, "cassette trash test.txt")
	if err := os.WriteFile(srcFile, []byte("trash me"), 0o644); err != nil {
		t.Fatalf("could not create temp file: %v", err)
	}

	if err := specTrash(srcFile); err != nil {
		t.Fatalf("specTrash returned error: %v", err)
	}

	if _, err := os.Stat(srcFile); !os.IsNotExist(err) {
		t.Errorf("original path should not exist after trash; stat err = %v", err)
	}

	trashedPath := filepath.Join(trashHome, "Trash", "files", "cassette trash test.txt")
	if _, err := os.Stat(trashedPath); err != nil {
		t.Fatalf("trashed file not found at %q: %v", trashedPath, err)
	}

	infoPath := filepath.Join(trashHome, "Trash", "info", "cassette trash test.txt.trashinfo")
	content, err := os.ReadFile(infoPath)
	if err != nil {
		t.Fatalf("trashinfo file not found at %q: %v", infoPath, err)
	}

	contentStr := string(content)
	if !strings.HasPrefix(contentStr, "[Trash Info]\n") {
		t.Errorf("trashinfo missing [Trash Info] header: %q", contentStr)
	}
	wantPath := "Path=" + strings.ReplaceAll(srcFile, " ", "%20")
	if !strings.Contains(contentStr, wantPath) {
		t.Errorf("trashinfo missing expected percent-encoded Path line %q, got %q", wantPath, contentStr)
	}
	if !strings.Contains(contentStr, "DeletionDate=") {
		t.Errorf("trashinfo missing DeletionDate key: %q", contentStr)
	}
}

// TestSpecTrashCollision trashes two different source files that share a base
// name and verifies the second gets a ".2" suffix in both files/ and info/,
// per the spec's non-colliding-name requirement.
func TestSpecTrashCollision(t *testing.T) {
	trashHome := t.TempDir()
	t.Setenv("XDG_DATA_HOME", trashHome)

	dirA := t.TempDir()
	dirB := t.TempDir()
	fileA := filepath.Join(dirA, "dup.txt")
	fileB := filepath.Join(dirB, "dup.txt")
	if err := os.WriteFile(fileA, []byte("a"), 0o644); err != nil {
		t.Fatalf("write fileA: %v", err)
	}
	if err := os.WriteFile(fileB, []byte("b"), 0o644); err != nil {
		t.Fatalf("write fileB: %v", err)
	}

	if err := specTrash(fileA); err != nil {
		t.Fatalf("specTrash(fileA) returned error: %v", err)
	}
	if err := specTrash(fileB); err != nil {
		t.Fatalf("specTrash(fileB) returned error: %v", err)
	}

	filesDir := filepath.Join(trashHome, "Trash", "files")
	infoDir := filepath.Join(trashHome, "Trash", "info")

	if _, err := os.Stat(filepath.Join(filesDir, "dup.txt")); err != nil {
		t.Errorf("first dup.txt missing from files/: %v", err)
	}
	if _, err := os.Stat(filepath.Join(filesDir, "dup.txt.2")); err != nil {
		t.Errorf("second dup.txt should be suffixed dup.txt.2 in files/: %v", err)
	}
	if _, err := os.Stat(filepath.Join(infoDir, "dup.txt.trashinfo")); err != nil {
		t.Errorf("first dup.txt.trashinfo missing from info/: %v", err)
	}
	if _, err := os.Stat(filepath.Join(infoDir, "dup.txt.2.trashinfo")); err != nil {
		t.Errorf("second dup.txt.trashinfo should be suffixed dup.txt.2.trashinfo in info/: %v", err)
	}
}

// TestPercentEncodePath spot-checks the Path= encoding against the bytes the
// spec cares most about getting right: spaces, a literal '%', and a non-ASCII
// (multi-byte UTF-8) character.
func TestPercentEncodePath(t *testing.T) {
	cases := map[string]string{
		"/home/user/plain.txt":        "/home/user/plain.txt",
		"/home/user/with space.txt":   "/home/user/with%20space.txt",
		"/home/user/100%done.txt":     "/home/user/100%25done.txt",
		"/home/user/café.txt":         "/home/user/caf%C3%A9.txt",
		"/home/user/a-b_c.d~e/f.txt":  "/home/user/a-b_c.d~e/f.txt",
	}
	for in, want := range cases {
		if got := percentEncodePath(in); got != want {
			t.Errorf("percentEncodePath(%q) = %q, want %q", in, got, want)
		}
	}
}
