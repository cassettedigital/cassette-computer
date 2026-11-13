//go:build windows

// trash_windows.go — Windows trash primitive using the shell's SHFileOperation
// with FOF_ALLOWUNDO, which moves the file to the Recycle Bin (the Windows
// equivalent of the macOS Trash in trash_darwin.go).
//
// HARD RULE (same as trash_darwin.go): this file must NEVER call os.Remove,
// os.RemoveAll, DeleteFile, or any primitive that permanently deletes data. The
// only permitted removal is a Recycle-Bin move via SHFileOperation + ALLOWUNDO.
// On failure trashFile returns a non-nil error; callers MUST NOT fall back to
// permanent deletion.

package main

import (
	"fmt"
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modshell32           = windows.NewLazySystemDLL("shell32.dll")
	procSHFileOperationW = modshell32.NewProc("SHFileOperationW")
)

const (
	foDelete = 0x0003 // FO_DELETE

	fofSilent         = 0x0004 // no progress UI
	fofNoConfirmation = 0x0010 // do not prompt "are you sure"
	fofAllowUndo      = 0x0040 // send to the Recycle Bin instead of deleting
	fofNoErrorUI      = 0x0400 // report errors to us, do not pop a dialog
)

// SHFILEOPSTRUCTW. Field order + implicit padding match the Win32 64-bit ABI:
// Go inserts the same alignment padding the C struct has (4 bytes after wFunc
// before the pointer, 2 after fFlags before the int32, 4 after the int32 before
// the pointer), so this maps 1:1 without manual padding fields.
type shFileOpStructW struct {
	hwnd                  windows.Handle
	wFunc                 uint32
	pFrom                 *uint16
	pTo                   *uint16
	fFlags                uint16
	fAnyOperationsAborted int32
	hNameMappings         uintptr
	lpszProgressTitle     *uint16
}

// trashFile moves the file at absPath to the Windows Recycle Bin via
// SHFileOperation with FOF_ALLOWUNDO. The move is recoverable: the user can
// restore the file from the Recycle Bin.
//
// Returns a non-nil error if the path is not absolute or the shell operation
// fails. GUARDRAIL: never permanently deletes; there is no os.Remove fallback.
func trashFile(absPath string) error {
	if !filepath.IsAbs(absPath) {
		return fmt.Errorf("trashFile: path must be absolute, got %q", absPath)
	}
	// SHFileOperation takes a DOUBLE-null-terminated list. UTF16FromString gives
	// one terminating null; append a second as the list terminator.
	from, err := windows.UTF16FromString(absPath)
	if err != nil {
		return fmt.Errorf("trashFile: %w", err)
	}
	from = append(from, 0)

	op := shFileOpStructW{
		wFunc:  foDelete,
		pFrom:  &from[0],
		fFlags: fofAllowUndo | fofNoConfirmation | fofSilent | fofNoErrorUI,
	}
	// SHFileOperationW returns 0 on success, a non-zero shell error code otherwise.
	ret, _, _ := procSHFileOperationW.Call(uintptr(unsafe.Pointer(&op)))
	if ret != 0 {
		return fmt.Errorf("trashFile: SHFileOperation failed (code 0x%x) for %q", ret, absPath)
	}
	if op.fAnyOperationsAborted != 0 {
		return fmt.Errorf("trashFile: recycle aborted for %q", absPath)
	}
	return nil
}
