//go:build !darwin

package main

// watchMusicDir has no change-notice service to use here; the ingest watcher
// polls instead.
func watchMusicDir(string) bool { return false }
