// In-process supervisor for the bundled macOS .app (Chunk 2).
//
// When CASSETTE_SUPERVISE=1, the sidecar binary becomes the whole stack's
// supervisor: it spawns the bundled Navidrome binary, waits for it to become
// healthy, opens the local UI, and installs signal handlers so quitting the
// app tears Navidrome down too. Without that env var the sidecar behaves
// exactly as before (Docker / run-native.sh), so this is additive.
//
// Env:
//   CASSETTE_SUPERVISE=1        — enable supervisor mode
//   CASSETTE_NAVIDROME_BIN=...  — path to the Navidrome binary to spawn
//   ND_PORT (default 4533)      — port to health-check and open
// The spawned Navidrome inherits this process's environment (ND_MUSICFOLDER,
// ND_DATAFOLDER, ND_FFMPEGPATH, …), which the .app launcher sets to the
// bundled resources.

package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

var supervisedNavidrome *exec.Cmd

// startSupervisedNavidrome spawns Navidrome and blocks until it is healthy.
// Fatal on failure — a supervisor with no Navidrome is useless.
func startSupervisedNavidrome() {
	bin := os.Getenv("CASSETTE_NAVIDROME_BIN")
	if bin == "" {
		superviseFatal("supervisor: CASSETTE_SUPERVISE=1 but CASSETTE_NAVIDROME_BIN is unset")
	}
	if _, err := os.Stat(bin); err != nil {
		superviseFatal("supervisor: Navidrome binary not found at %s: %v", bin, err)
	}
	port := envOr("ND_PORT", "4533")

	// APPEND + size-rotate, never TRUNCATE. A crash loop must NOT wipe the failing
	// run's Navidrome output — that output is the evidence for WHY startup died.
	// Mirrors sidecar.log (setupDurableLog) and the native supervisor.log: rotate
	// one generation at ~5MB so it stays bounded while keeping the prior tail.
	logPath := filepath.Join(sidecarDataDir, "navidrome.log")
	if fi, err := os.Stat(logPath); err == nil && fi.Size() > 5*1024*1024 {
		_ = os.Rename(logPath, logPath+".1")
	}
	var out *os.File
	if f, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644); err == nil {
		out = f
	} else {
		log.Printf("supervisor: cannot open %s (%v); Navidrome logs to this process", logPath, err)
	}

	cmd := exec.Command(bin)
	// Inherit ND_* the launcher set, then inject ND_SUBSONIC_DEFAULTREPORTREALPATH.
	// NOTE: library-trash.go does NOT depend on this flag. Navidrome sets
	// player.report_real_path=0 for every client, so getSong always returns a
	// relative path regardless of this env var. The trash path resolution in
	// library-trash.go handles relative paths by joining them onto sidecarMusicDir
	// directly (resolveTrackPath, B1 fix). This injection is kept in case a future
	// Navidrome version or per-client setting honours the flag, but it is not the
	// real fix and must not be relied upon.
	// ND_SUBSONIC_DEFAULTREPORTREALPATH maps to conf.Subsonic.DefaultReportRealPath
	// (viper key "subsonic.defaultreportrealpath", prefix ND_, separator → _).
	// We only inject the variable when it is not already set by the caller so that
	// an explicit ND_SUBSONIC_DEFAULTREPORTREALPATH=false in the environment wins.
	env := os.Environ()
	alreadySet := false
	for _, e := range env {
		if strings.HasPrefix(e, "ND_SUBSONIC_DEFAULTREPORTREALPATH=") {
			alreadySet = true
			break
		}
	}
	if !alreadySet {
		env = append(env, "ND_SUBSONIC_DEFAULTREPORTREALPATH=true")
	}
	cmd.Env = withoutExternalServices(withPictureDefaults(env))
	if lanPort != "" {
		// The hub answers the Wi-Fi for Navidrome (lan-tls.go), so Navidrome listens on this computer only: its
		// web pages, native API and first-admin setup never reach the network (BUG-870).
		cmd.Env = withEnv(cmd.Env, "ND_ADDRESS", "127.0.0.1")
	}
	if out != nil {
		cmd.Stdout = out
		cmd.Stderr = out
	}
	setOwnProcessGroup(cmd) // own group → clean teardown (POSIX; no-op on Windows)
	if err := cmd.Start(); err != nil {
		superviseFatal("supervisor: failed to start Navidrome: %v", err)
	}
	supervisedNavidrome = cmd
	log.Printf("supervisor: Navidrome started (pid %d); waiting for /ping on :%s…", cmd.Process.Pid, port)

	installSupervisorSignalHandler()

	pingURL := fmt.Sprintf("http://127.0.0.1:%s/ping", port)
	client := &http.Client{Timeout: 2 * time.Second}
	ready := false
	for i := 0; i < 90; i++ {
		if resp, err := client.Get(pingURL); err == nil {
			resp.Body.Close()
			ready = true
			break
		}
		if cmd.ProcessState != nil && cmd.ProcessState.Exited() {
			superviseFatal("supervisor: Navidrome exited during startup (see navidrome.log)")
		}
		time.Sleep(1 * time.Second)
	}
	if !ready {
		killSupervisedNavidrome()
		superviseFatal("supervisor: Navidrome did not become healthy within 90s")
	}
	log.Println("supervisor: Navidrome healthy.")

	// Deliberately DO NOT open a browser here. Navidrome's own web UI (the GPL
	// "Welcome to Cassette Player" login) must never be put in front of a user —
	// we use Navidrome's Subsonic *engine*, never its frontend. Launch is a quiet
	// menu-bar agent; the menu's "Open Cassette Player" goes to the hosted
	// Cassette dashboard. The engine stays reachable for the Subsonic API (/rest)
	// on its port; nothing in the experience navigates to its UI.
	log.Printf("supervisor: Navidrome engine up on :%s (Subsonic API only; UI not surfaced).", port)
}

// killSupervisedNavidrome SIGTERMs Navidrome (and its group), escalating to
// SIGKILL after a grace period.
func killSupervisedNavidrome() {
	if supervisedNavidrome == nil || supervisedNavidrome.Process == nil {
		return
	}
	pid := supervisedNavidrome.Process.Pid
	killProcessGroup(pid, syscall.SIGTERM) // negative pid → whole process group
	done := make(chan struct{})
	go func() { _, _ = supervisedNavidrome.Process.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(8 * time.Second):
		killProcessGroup(pid, syscall.SIGKILL)
	}
	log.Println("supervisor: Navidrome stopped.")
}

// installSupervisorSignalHandler tears down Navidrome when the supervisor is
// asked to quit (the .app shell sends SIGTERM on Cmd-Q / menu Quit).
func installSupervisorSignalHandler() {
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		s := <-ch
		log.Printf("supervisor: received %v — shutting down.", s)
		// Stop the audio engine first so playback does not keep going after quit
		// (no-op on macOS, where the shell reaps the Swift host; on Windows this
		// quits + reaps the headless mpv child, which is otherwise orphaned).
		playbackOut.shutdown()
		killSupervisedNavidrome()
		os.Exit(0)
	}()
}

// withPictureDefaults sets how Navidrome sizes a person's own covers for the phones (they ask it for
// ladder sizes, docs/reference/CASSETTE_IMAGES.md): JPEG at the same quality the hub's own sizes use
// (picture-ladder.go; Navidrome's default is 75), and a picture cache big enough to keep a library's
// worth of sizes instead of making them again and again (Navidrome's default is 100 MB). The cache is
// on this computer, under Navidrome's data folder. A value the launcher or the person set wins.
func withPictureDefaults(env []string) []string {
	defaults := []struct{ key, value string }{
		{"ND_COVERARTQUALITY", strconv.Itoa(ladderJPEGQuality)},
		{"ND_IMAGECACHESIZE", "1GB"},
	}
	for _, d := range defaults {
		set := false
		for _, e := range env {
			if strings.EqualFold(strings.SplitN(e, "=", 2)[0], d.key) {
				set = true
				break
			}
		}
		if !set {
			env = append(env, d.key+"="+d.value)
		}
	}
	return env
}

// withoutExternalServices turns off every service Navidrome would reach out to on
// its own: the daily usage report to navidrome.org, Last.fm, Deezer, ListenBrainz
// and the login page's downloaded background (BUG-781). Forced, whatever the
// environment says: Cassette's music server talks only to this Mac and the
// person's own devices, and Last.fm and Deezer are never allowed.
func withoutExternalServices(env []string) []string {
	out := make([]string, 0, len(env)+2)
	for _, e := range env {
		key := strings.ToUpper(strings.SplitN(e, "=", 2)[0])
		if key == "ND_ENABLEEXTERNALSERVICES" || key == "ND_ENABLEINSIGHTSCOLLECTOR" {
			continue
		}
		out = append(out, e)
	}
	return append(out, "ND_ENABLEEXTERNALSERVICES=false", "ND_ENABLEINSIGHTSCOLLECTOR=false")
}

// withEnv sets key=value in env, replacing any value the launcher gave it.
func withEnv(env []string, key, value string) []string {
	out := make([]string, 0, len(env)+1)
	for _, e := range env {
		if !strings.HasPrefix(e, key+"=") {
			out = append(out, e)
		}
	}
	return append(out, key+"="+value)
}
