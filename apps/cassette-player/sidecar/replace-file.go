// replace-file.go — putting a finished temp file in place of a song (BUG-913).
//
// On macOS and Linux a rename over a file that something has open just works:
// the reader keeps the old copy until it lets go. Windows refuses it while any
// program holds the file without delete sharing, which is how Go and most
// programs open files there. On a Windows hub that is Navidrome streaming the
// song to the player (the player plays from Navidrome, which reads the whole
// file out in a few seconds), its scanner reading it, or Defender looking at
// the new copy. Each hold is brief, so the swap waits it out instead of failing
// the person's edit on the first try.
//
// The original is never touched until the rename succeeds: if the hold outlasts
// the wait, the caller removes the temp and reports the error, and the song
// stays exactly as it was.

package main

import (
	"os"
	"time"
)

// replaceFileWait is how long a swap keeps trying while the file is held.
const replaceFileWait = 8 * time.Second

// replaceFile renames from over to, waiting out a brief hold on either file on
// Windows (renameHeld; never true elsewhere, so this is os.Rename there).
func replaceFile(from, to string) error {
	return replaceFileWith(os.Rename, renameHeld, time.Sleep, replaceFileWait, from, to)
}

// replaceFileWith is replaceFile with its parts passed in, for the tests.
func replaceFileWith(rename func(string, string) error, held func(error) bool, sleep func(time.Duration), budget time.Duration, from, to string) error {
	pause := 50 * time.Millisecond
	var spent time.Duration
	for {
		err := rename(from, to)
		if err == nil || !held(err) || spent >= budget {
			return err
		}
		if spent+pause > budget {
			pause = budget - spent
		}
		sleep(pause)
		spent += pause
		if pause *= 2; pause > time.Second {
			pause = time.Second
		}
	}
}
