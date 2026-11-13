//go:build linux

// trash_linux.go - Linux trash primitive implementing the freedesktop.org
// Trash specification's home trash ($XDG_DATA_HOME/Trash, defaulting to
// ~/.local/share/Trash). Mirrors trash_darwin.go (macOS Trash via
// NSFileManager) and trash_windows.go (Recycle Bin via SHFileOperation).
//
// HARD RULE (same as trash_darwin.go and trash_windows.go): this file must
// NEVER call os.Remove, os.RemoveAll, unlink, or any primitive that
// permanently deletes data. The only permitted removal of the original file is
// an os.Rename into the trash's files/ directory, paired with a matching
// info/*.trashinfo record, exactly as the spec describes. On any failure
// trashFile returns a non-nil error and leaves the original file exactly where
// it was. Callers MUST NOT fall back to permanent deletion.
//
// Delegation: trashFile first tries "gio trash" (GLib/GNOME's command-line
// trash tool) via os/exec. gio already implements the spec's per-mount trash
// directories ($topdir/.Trash-<uid>), which the hand-rolled path below
// deliberately does not, so preferring it is strictly more capable when it is
// present. If gio is not on PATH, fails, or times out, trashFile falls back to
// the hand-rolled implementation below. gio is never a hard dependency: its
// absence is not an error, only a reason to fall back.
//
// Cross-filesystem files: the spec's answer to a file that cannot be renamed
// into the home trash because it lives on a different filesystem is a
// per-topdir trash ($topdir/.Trash/<uid> or $topdir/.Trash-<uid>). This file
// does not implement that discovery, that is real follow-up work (the gio
// delegation above already covers it for anyone with gio installed). When the
// underlying rename fails with EXDEV, trashFile returns a clear, specific
// error instead of attempting a copy-then-delete: a copy that fails partway
// through and then deletes the original would be a permanent-data-loss risk
// wearing a trash operation's clothes. Refusing clearly is the correct, safe
// behavior here.

package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// gioTrashTimeout bounds how long trashFile waits on "gio trash" before giving
// up and falling back to the hand-rolled implementation. gio can talk to a
// gvfs/D-Bus backend for some mount types; if that backend is wedged or absent
// (the hub running headless with no desktop session, for instance), a single
// trash call must not be able to hang the sidecar.
const gioTrashTimeout = 5 * time.Second

// trashFile moves the file at absPath to the Linux desktop trash, preferring
// "gio trash" when available and otherwise implementing the freedesktop.org
// Trash specification's home trash directly. The move is recoverable: the
// user can restore the file from their file manager's Trash view (or "gio
// trash --restore").
//
// Returns a non-nil error if the path is not absolute, or if neither gio nor
// the hand-rolled fallback could trash the file.
//
// GUARDRAIL: this function must NEVER permanently delete files. Every path
// through it either moves the file into a trash directory or returns an error
// with the original file untouched. There is no fallback to os.Remove or any
// other deletion primitive.
func trashFile(absPath string) error {
	if !filepath.IsAbs(absPath) {
		return fmt.Errorf("trashFile: path must be absolute, got %q", absPath)
	}

	if err := tryGioTrash(absPath); err == nil {
		return nil
	}

	// gio is unavailable, failed, or timed out. gio itself never deletes on
	// failure, so on the ordinary path the original file is still exactly
	// where it was and the hand-rolled fallback below can retry the move. The
	// one thing worth ruling out first is the file having vanished anyway
	// (gio reported failure but the trash actually happened, or something
	// else raced us): if it is gone, guessing further is unsafe, so say so
	// instead of either claiming success or trying to move a file that is not
	// there.
	if _, statErr := os.Lstat(absPath); statErr != nil {
		if os.IsNotExist(statErr) {
			return fmt.Errorf("trashFile: gio trash reported failure for %q but the file no longer exists at its original location; trash state is unclear, refusing to guess", absPath)
		}
		return fmt.Errorf("trashFile: could not stat %q before falling back from gio: %w", absPath, statErr)
	}

	return specTrash(absPath)
}

// tryGioTrash delegates to "gio trash <path>", the GLib/GNOME command-line
// trash tool, when it is present on PATH. gio implements the full freedesktop
// Trash specification, including per-mount trash directories, which the
// hand-rolled fallback in specTrash deliberately does not.
//
// Returns nil only on a confirmed successful trash (gio exited 0). Any other
// return (gio not found, non-zero exit, timeout) means the caller should fall
// back; it does not mean the original file was touched, since a well-behaved
// gio never deletes on failure either.
func tryGioTrash(absPath string) error {
	gioPath, err := exec.LookPath("gio")
	if err != nil {
		return fmt.Errorf("gio not found on PATH: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), gioTrashTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, gioPath, "trash", "--", absPath)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("gio trash failed: %w (output: %s)", err, strings.TrimSpace(string(out)))
	}
	return nil
}

// specTrash implements the freedesktop.org Trash specification's home trash
// directly: $XDG_DATA_HOME/Trash (default ~/.local/share/Trash), with files
// moved into <trash>/files/ and a matching <trash>/info/<name>.trashinfo
// written for each one.
//
// Ordering matters for the hard rule: the .trashinfo record is created first,
// with O_EXCL so two concurrent trashFile calls cannot claim the same name,
// and only once that succeeds does specTrash attempt the rename of the real
// file. If the rename fails for any reason, including a cross-device EXDEV,
// the just-created info record is removed and the original file is left
// exactly where it was, os.Rename is atomic: it either fully succeeds or does
// not touch the source at all.
func specTrash(absPath string) error {
	trashHome, err := trashHomeDir()
	if err != nil {
		return err
	}
	filesDir := filepath.Join(trashHome, "files")
	infoDir := filepath.Join(trashHome, "info")

	// The spec recommends the trash directory (and its files/info children) be
	// created with permissions 0700, since it holds a user's private data.
	if err := os.MkdirAll(filesDir, 0o700); err != nil {
		return fmt.Errorf("trashFile: could not create trash files directory %q: %w", filesDir, err)
	}
	if err := os.MkdirAll(infoDir, 0o700); err != nil {
		return fmt.Errorf("trashFile: could not create trash info directory %q: %w", infoDir, err)
	}

	base := filepath.Base(absPath)
	infoContent := fmt.Sprintf("[Trash Info]\nPath=%s\nDeletionDate=%s\n",
		percentEncodePath(absPath), time.Now().Format("2006-01-02T15:04:05"))

	const maxAttempts = 10000
	for attempt := 0; attempt < maxAttempts; attempt++ {
		name := base
		if attempt > 0 {
			// Browser-style collision suffix: name, name.2, name.3, ...
			name = fmt.Sprintf("%s.%d", base, attempt+1)
		}
		filesPath := filepath.Join(filesDir, name)
		infoPath := filepath.Join(infoDir, name+".trashinfo")

		// A real trash entry always has both a files/ and an info/ member; treat
		// either being present as the name being taken, so we never overwrite a
		// pre-existing trashed file even if its info record is missing or
		// foreign.
		if pathExists(filesPath) || pathExists(infoPath) {
			continue
		}

		infoFile, err := os.OpenFile(infoPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err != nil {
			if os.IsExist(err) {
				continue // lost a naming race with another trash operation; try the next name
			}
			return fmt.Errorf("trashFile: could not create trash info file %q: %w", infoPath, err)
		}
		_, writeErr := infoFile.WriteString(infoContent)
		closeErr := infoFile.Close()
		if writeErr != nil || closeErr != nil {
			_ = os.Remove(infoPath) // best-effort cleanup; the original file was never touched
			if writeErr != nil {
				return fmt.Errorf("trashFile: could not write trash info file %q: %w", infoPath, writeErr)
			}
			return fmt.Errorf("trashFile: could not close trash info file %q: %w", infoPath, closeErr)
		}

		if err := os.Rename(absPath, filesPath); err != nil {
			_ = os.Remove(infoPath) // clean up the now-orphaned info record
			if errors.Is(err, syscall.EXDEV) {
				return fmt.Errorf("trashFile: %q is on a different filesystem than the trash directory %q; cross-filesystem trashing is not supported yet", absPath, trashHome)
			}
			return fmt.Errorf("trashFile: could not move %q to trash: %w", absPath, err)
		}
		return nil
	}
	return fmt.Errorf("trashFile: could not find a free trash name for %q after %d attempts", absPath, maxAttempts)
}

// trashHomeDir resolves the freedesktop.org home trash directory:
// $XDG_DATA_HOME/Trash, or ~/.local/share/Trash when XDG_DATA_HOME is unset,
// empty, or not absolute. Per the XDG Base Directory spec, a relative
// XDG_DATA_HOME is invalid and implementations should ignore it and use the
// default rather than build a path from it.
func trashHomeDir() (string, error) {
	if xdg := os.Getenv("XDG_DATA_HOME"); xdg != "" && filepath.IsAbs(xdg) {
		return filepath.Join(xdg, "Trash"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("trashFile: could not determine home directory for default trash location: %w", err)
	}
	return filepath.Join(home, ".local", "share", "Trash"), nil
}

// pathExists reports whether something (file, directory, or symlink) is
// already present at p, without following a symlink into a stat error.
func pathExists(p string) bool {
	_, err := os.Lstat(p)
	return err == nil
}

// percentEncodePath encodes an absolute path for the Path= key of a
// .trashinfo file. The spec requires this value to be URL-encoded (RFC 2396).
// '/' is left unescaped since Path is a pathname and slashes are structural
// separators, not data; the RFC 3986 unreserved set (letters, digits, '-',
// '.', '_', '~') is left unescaped; everything else, including spaces, '%'
// itself, and every individual byte of a multi-byte UTF-8 sequence, is
// percent-encoded. Encoding a byte that some reader would have tolerated
// unescaped is always spec-safe; leaving one that needed encoding unescaped is
// not, so this errs toward encoding more rather than less.
func percentEncodePath(path string) string {
	const hex = "0123456789ABCDEF"
	var b strings.Builder
	b.Grow(len(path))
	for i := 0; i < len(path); i++ {
		c := path[i]
		if isUnreservedPathByte(c) {
			b.WriteByte(c)
		} else {
			b.WriteByte('%')
			b.WriteByte(hex[c>>4])
			b.WriteByte(hex[c&0x0F])
		}
	}
	return b.String()
}

// isUnreservedPathByte reports whether c may appear unescaped in a percent-
// encoded trash Path value: ASCII letters, digits, '-', '.', '_', '~', and '/'.
func isUnreservedPathByte(c byte) bool {
	switch {
	case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9':
		return true
	case c == '-' || c == '.' || c == '_' || c == '~' || c == '/':
		return true
	default:
		return false
	}
}
