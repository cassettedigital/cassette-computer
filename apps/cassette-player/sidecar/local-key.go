// The per-launch secret the Mac app shares with its hub (BUG-776, BUG-777).
//
// The shell mints a fresh random key every launch and hands it to the hub and the
// audio helper in their environment (CASSETTE_LOCAL_KEY). A web page in the
// person's browser can reach both on loopback but can never learn the key, so a
// request carrying it came from the app itself. The hub sends it on every call to
// the audio helper, and the shell sends it when it signs the hub in. Unset (a
// hand-run dev hub) means no app is vouching for anyone, and callers fall back to
// whatever other proof they accept.

package main

import (
	"crypto/subtle"
	"net/http"
	"os"
	"strings"
)

const localKeyHeader = "X-Cassette-Local-Key"

var localKey = takeLocalKey()

// takeLocalKey reads the key once and drops it from the environment, so the
// programs the hub starts (Navidrome, the rip tools) never inherit it.
func takeLocalKey() string {
	k := strings.TrimSpace(os.Getenv("CASSETTE_LOCAL_KEY"))
	_ = os.Unsetenv("CASSETTE_LOCAL_KEY")
	return k
}

// fromApp reports whether r carries this launch's key.
func fromApp(r *http.Request) bool {
	got := r.Header.Get(localKeyHeader)
	return localKey != "" && subtle.ConstantTimeCompare([]byte(got), []byte(localKey)) == 1
}

// vouch adds this launch's key to a request the hub makes to the audio helper.
func vouch(req *http.Request) {
	if localKey != "" {
		req.Header.Set(localKeyHeader, localKey)
	}
}
