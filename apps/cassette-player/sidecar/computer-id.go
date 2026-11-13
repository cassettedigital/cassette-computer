// The computer id: which computer this hub runs on, as the cloud's account slot knows it (BUG-862).
//
// An account has one main computer. The hub mints this id once, keeps it in its data folder (so app
// updates and reinstalls keep it), and sends it on register, heartbeat and library sync. The cloud's
// slot remembers the first id it hears and refuses another computer's, so a second computer signing
// in can no longer take the phones or knock the first one's songs out of the library
// (apps/cassette/src/lib/player-main-computer.ts).
//
// It lives in sidecar.json and, written once, in its own small file beside it. A lost or unreadable
// sidecar.json starts the hub fresh; without the second copy it would mint a new id and the main
// computer would be refused by its own slot.
//
// Kept apart from InstallID on purpose: that one is the diagnostics spine's anonymous correlation
// key, and this one is tied to the account.

package main

import (
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const computerIDFile = "computer-id"

var computerIDPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// computerID is this hub's id, set once at startup by ensureComputerID before any cloud call.
var computerID string

func computerIDPath() string { return filepath.Join(sidecarDataDir, computerIDFile) }

// keptComputerID is the id in the side file, or "" when there is none or it isn't one of ours.
func keptComputerID() string {
	b, err := os.ReadFile(computerIDPath())
	if err != nil {
		return ""
	}
	id := strings.TrimSpace(string(b))
	if !computerIDPattern.MatchString(id) {
		return ""
	}
	return id
}

// ensureComputerID takes the id from sidecar.json, else from the side file, else mints one; keeps
// both copies; and returns it.
func ensureComputerID(state *SidecarState) string {
	if state == nil {
		return ""
	}
	if state.ComputerID == "" {
		if kept := keptComputerID(); kept != "" {
			state.ComputerID = kept
		} else {
			state.ComputerID = newUUID()
		}
		if err := saveState(state); err != nil {
			log.Printf("computer id: could not save it in sidecar.json: %v", err)
		}
	}
	if keptComputerID() == "" {
		if err := atomicWriteFile(computerIDPath(), []byte(state.ComputerID+"\n"), 0600); err != nil {
			log.Printf("computer id: could not keep a copy beside sidecar.json: %v", err)
		}
	}
	computerID = state.ComputerID
	return computerID
}
