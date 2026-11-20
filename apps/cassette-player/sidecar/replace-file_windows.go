//go:build windows

package main

import (
	"errors"

	"golang.org/x/sys/windows"
)

// renameHeld reports whether a rename failed because another program has one
// of the files open (replace-file.go). Windows says so with a sharing or lock
// violation, or with access denied when the file being replaced is open.
func renameHeld(err error) bool {
	return errors.Is(err, windows.ERROR_SHARING_VIOLATION) ||
		errors.Is(err, windows.ERROR_LOCK_VIOLATION) ||
		errors.Is(err, windows.ERROR_ACCESS_DENIED)
}
