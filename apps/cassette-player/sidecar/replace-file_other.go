//go:build !windows

package main

// renameHeld is never true off Windows: a rename over an open file succeeds
// there (replace-file.go).
func renameHeld(error) bool { return false }
