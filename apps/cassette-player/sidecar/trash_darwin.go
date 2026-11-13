//go:build darwin

// trash_darwin.go — macOS-only trash primitive using Foundation NSFileManager.
//
// HARD RULE: this file must NEVER call os.Remove, os.RemoveAll, unlink, or any
// syscall that permanently deletes data. The ONLY permitted file-removal
// operation is NSFileManager trashItemAtURL:resultingItemURL:error:, which
// moves the file to the macOS Trash (recoverable in Finder).
//
// If a trash move cannot be performed for any reason, trashFile returns a
// non-nil error. Callers MUST NOT fall back to permanent deletion.

package main

// #cgo CFLAGS: -x objective-c
// #cgo LDFLAGS: -framework Foundation
// #import <Foundation/Foundation.h>
//
// // trashItemC moves the file at absPath to the macOS Trash using
// // NSFileManager -trashItemAtURL:resultingItemURL:error:.
// // Returns a newly-allocated C string with the error description on failure
// // (caller must free), or NULL on success.
// static const char* trashItemC(const char *absPath) {
//     @autoreleasepool {
//         NSString *pathStr = [NSString stringWithUTF8String:absPath];
//         if (!pathStr) {
//             return strdup("trashFile: invalid UTF-8 path");
//         }
//         NSURL *url = [NSURL fileURLWithPath:pathStr];
//         if (!url) {
//             return strdup("trashFile: could not create NSURL from path");
//         }
//         NSFileManager *fm = [NSFileManager defaultManager];
//         NSError *err = nil;
//         BOOL ok = [fm trashItemAtURL:url resultingItemURL:nil error:&err];
//         if (!ok) {
//             NSString *desc = err ? [err localizedDescription] : @"unknown error";
//             return strdup([desc UTF8String]);
//         }
//         return NULL;
//     }
// }
import "C"
import (
	"fmt"
	"path/filepath"
	"unsafe"
)

// trashFile moves the file at absPath to the macOS Trash using Foundation's
// NSFileManager -trashItemAtURL:resultingItemURL:error:. The move is
// recoverable: the user can restore the file from the Trash in Finder.
//
// Returns a non-nil error if the path is not absolute, the Objective-C call
// fails, or the file could not be trashed for any reason.
//
// GUARDRAIL: this function must NEVER permanently delete files. If the
// NSFileManager call fails, it returns an error. There is no fallback to
// os.Remove or any other deletion primitive.
func trashFile(absPath string) error {
	if !filepath.IsAbs(absPath) {
		return fmt.Errorf("trashFile: path must be absolute, got %q", absPath)
	}
	cPath := C.CString(absPath)
	defer C.free(unsafe.Pointer(cPath))

	errStr := C.trashItemC(cPath)
	if errStr != nil {
		defer C.free(unsafe.Pointer(errStr))
		return fmt.Errorf("trashFile: %s", C.GoString(errStr))
	}
	return nil
}
