// Folder art applies forward only (BUG-786).
//
// The hub fills in a missing cover.<ext> or artist.<ext> beside a person's music.
// That is a write into their library, and the rule for those is that a new
// default reaches the next thing that arrives, never what is already sitting on
// their disk (docs/reference/CASSETTE_FILE_WRITEBACK.md). So the automatic passes
// only write into a folder that came into being after the hub first started
// watching this library. Folders that were already there keep exactly what they
// had; Navidrome still shows their embedded art.
//
// "Came into being" is the folder's creation time. Copying an album in makes a new
// folder; moving one in from elsewhere on the same disk keeps its old date and is
// left alone, which is the safe direction. Where the creation time can't be read
// (folderBornAt false) nothing is written.
//
// Rips don't go through this: the rip writes into the folder it just made.

package main

import (
	"sync/atomic"
	"time"
)

// folderArtSinceNanos mirrors SidecarState.FolderArtSince for readers on other
// goroutines (the on-demand artist-photo serve). 0 means not established yet,
// and then nothing is written.
var folderArtSinceNanos atomic.Int64

// ensureFolderArtBaseline stamps the moment the hub started watching, the first
// time it runs, and publishes it. Reports whether state changed and needs saving.
func ensureFolderArtBaseline(state *SidecarState) (dirty bool) {
	if state.FolderArtSince.IsZero() {
		state.FolderArtSince = time.Now()
		dirty = true
	}
	folderArtSinceNanos.Store(state.FolderArtSince.UnixNano())
	return dirty
}

// folderArtAllowed reports whether the automatic passes may write folder art into
// dir: only when dir was created after the baseline.
func folderArtAllowed(dir string) bool {
	// A satellite's folders hold copies of the main computer's, and a spare's music isn't the account's
	// library: neither gets pictures written into it (satellite.go).
	if asSpare() {
		return false
	}
	since := folderArtSinceNanos.Load()
	if since == 0 {
		return false
	}
	born, ok := folderBornAt(dir)
	return ok && born.UnixNano() > since
}
