//go:build !darwin && !windows && !linux

// trash_stub.go - placeholder for the remaining platforms (e.g. an obscure BSD
// cross-compile). macOS is trash_darwin.go (Foundation NSFileManager), Windows
// is trash_windows.go (Recycle Bin via SHFileOperation), and Linux is
// trash_linux.go (freedesktop.org Trash spec); this stub covers everything
// else so the package compiles without a trash primitive.
//
// If this stub is ever reached at runtime it means someone tried to trash files
// from an unsupported platform, which we refuse — permanent deletion is never a
// fallback.

package main

import "errors"

// trashFile is a build-time stub for non-Darwin platforms.
// It always returns an error — permanent deletion is never a fallback.
func trashFile(_ string) error {
	return errors.New("trash: operation not supported on this platform (macOS only)")
}
