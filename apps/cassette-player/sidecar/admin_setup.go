package main

// Navidrome admin bootstrap for the bundled desktop hub.
//
// The sidecar talks to its own Navidrome as an admin: to play (playback.go), sync
// the library (library-sync.go), trigger scans (tag-writer.go) and create the
// per-account playback user at pairing (status-server.go). Two things used to make
// that work only on the founder's Mac:
//
//   - The password was baked into every copy of the app (bundle-macos.sh wrote the
//     builder's NAVIDROME_ADMIN_PW into cassette.env), and Navidrome listens on the
//     LAN for the phone, so anyone on a shared network could sign in with it.
//   - Nothing ever created the admin user on a fresh data folder. Navidrome only
//     does that under DevAutoCreateAdminPassword, which nobody sets, so a new
//     install had no admin and every admin call failed.
//
// Now each install mints its own password once, keeps it in the data folder
// (owner-only), and creates the admin through Navidrome's first-admin endpoint,
// which refuses once any user exists. An explicit NAVIDROME_ADMIN_PW (Docker,
// run-native.sh, older bundles) still wins, unchanged.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const adminPasswordFile = "navidrome-admin-password"

// resolveNavidromeAdminPassword fills navidromeAdmin from the data folder when the
// environment didn't set it, minting and saving a new one on a fresh install.
func resolveNavidromeAdminPassword() {
	if navidromeAdmin != "" || sidecarDataDir == "" {
		return
	}
	path := filepath.Join(sidecarDataDir, adminPasswordFile)
	if b, err := os.ReadFile(path); err == nil {
		if pw := strings.TrimSpace(string(b)); pw != "" {
			navidromeAdmin = pw
			return
		}
	}
	pw, err := randomString(32)
	if err != nil {
		log.Printf("Warning: could not mint a Navidrome admin password: %v", err)
		return
	}
	if err := os.MkdirAll(sidecarDataDir, 0o755); err != nil {
		log.Printf("Warning: could not create data dir for the admin password: %v", err)
		return
	}
	if err := os.WriteFile(path, []byte(pw+"\n"), 0o600); err != nil {
		log.Printf("Warning: could not save the Navidrome admin password: %v", err)
		return
	}
	navidromeAdmin = pw
	log.Printf("Minted this install's Navidrome admin password (%s)", path)
}

// ensureNavidromeAdmin makes sure the admin the sidecar signs in as exists. A
// working login is the common case; otherwise create the first admin, which
// Navidrome only allows while it has no users at all.
func ensureNavidromeAdmin() {
	if navidromeAdmin == "" {
		return
	}
	if _, err := navidromeAdminLogin(navidromeAdmin); err == nil {
		return
	}
	body, _ := json.Marshal(map[string]string{"username": navidromeAdminUser, "password": navidromeAdmin})
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Post(navidromeBase+"/auth/createAdmin", "application/json", bytes.NewReader(body))
	if err != nil {
		log.Printf("Warning: could not reach Navidrome to create its admin: %v", err)
		return
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusOK:
		log.Printf("Created the Navidrome admin user %q", navidromeAdminUser)
	case resp.StatusCode == http.StatusForbidden:
		// Users exist but this password doesn't sign in: an install made with a
		// different password (e.g. the old shared one). Say so plainly; nothing
		// here can recover it.
		log.Printf("Warning: Navidrome already has users and the admin password in %s doesn't sign in. "+
			"Playback and pairing will fail until it matches.", filepath.Join(sidecarDataDir, adminPasswordFile))
	default:
		log.Printf("Warning: creating the Navidrome admin failed: %s", fmt.Sprint(resp.Status))
	}
}
