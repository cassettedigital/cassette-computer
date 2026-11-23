//go:build !darwin

package main

// watchMusicDir has no change-notice service to use here; the ingest watcher
// polls instead.
func watchMusicDir(string) bool { return false }

// watchLinkedFolder: likewise; folders Cassette reads are looked at on a timer here.
func watchLinkedFolder(string) bool { return false }
