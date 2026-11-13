//go:build !darwin && !windows

package main

import "os"

// carryFileMetadata has nothing to carry here beyond the permissions
// rewriteKeepingMetadata already keeps: the extended attributes and dates it
// keeps on macOS (BUG-861) are a macOS concern.
func carryFileMetadata(string, os.FileInfo, *os.File) error { return nil }
