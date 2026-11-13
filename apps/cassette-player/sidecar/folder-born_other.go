//go:build !darwin && !windows

package main

import "time"

// folderBornAt has no portable creation time to read, so the automatic folder-art
// passes write nothing off macOS (folderArtAllowed).
func folderBornAt(string) (time.Time, bool) { return time.Time{}, false }
