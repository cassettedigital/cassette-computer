//go:build linux

// playback_platform_linux.go - the Linux audio output engine.
//
// There is no Swift host on Linux either, so exactly like Windows the sidecar
// owns the audio engine itself: it spawns a headless mpv and drives it over
// mpv's JSON IPC transport (line-delimited UTF-8 JSON, one object per newline,
// full-duplex). The command surface, the driver-managed queue (loadfile per
// track, advance on end-file/eof, repeat-one reload), and the shutdown reaping
// are a direct port of playback_platform_windows.go - read that file first, this
// one only differs where the OS forces it to.
//
// The ONE structural difference is the transport. Windows has no Unix domain
// sockets, so it drives mpv over a named pipe via go-winio (overlapped I/O).
// Linux has real Unix domain sockets in the standard library, so this dials
// mpv's --input-ipc-server socket with net.Dial("unix", ...) directly - no
// external package needed, and the resulting net.Conn is driven exactly the
// same way (bufio.Scanner reader loop, JSON command writer) as the Windows pipe
// and the macOS Unix-socket seam the doc comment on that file already describes.
//
// Levels: mpv exposes no decoded-PCM tap to an external IPC client, so
// writeLevels returns the idle frame here too - the web visualizer degrades to
// idle on Linux, same as Windows; transport, seek, auto-advance, and
// play-logging all work.
//
// Now-playing / MPRIS media-key integration (BUG-250): webkit2gtk does not
// bridge a media session the way WebView2/Chromium does on Windows, so this
// loads the mpv-mpris plugin (github.com/hoyon/mpv-mpris, staged from the
// Ubuntu "mpv-mpris" apt package as bin/mpris.so) explicitly via --script=,
// since --no-config below means mpv will not auto-load it the way a normal
// desktop mpv install would. Best-effort: findMPRISPlugin's absence is not an
// error, mpv just starts without it (no lock-screen card / media keys, same
// as before this fix), so a build that doesn't stage the plugin degrades
// gracefully rather than failing to play at all.

package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

// mpvSockPath is the Unix domain socket mpv opens for IPC. A fixed path (like
// Windows's fixed pipe name) lets a restarted sidecar ADOPT an mpv that outlived
// it (see ensureEngine) instead of stacking up orphaned engines holding the
// socket. Chosen once at process start via mpvSockDir(), which prefers
// XDG_RUNTIME_DIR.
var mpvSockPath = filepath.Join(mpvSockDir(), "cassette-mpv.sock")

// mpvSockDir picks a per-user, writable directory to hold the IPC socket.
// XDG_RUNTIME_DIR (typically /run/user/<uid>, tmpfs, cleaned on logout) is the
// right home for a short-lived socket and is set on every normal desktop
// session; some minimal/container environments don't set it, so this falls back
// to the sidecar's own data dir (sidecarDataDir, main.go - already the
// container-friendly default), then os.TempDir() as a last resort.
func mpvSockDir() string {
	if d := strings.TrimSpace(os.Getenv("XDG_RUNTIME_DIR")); d != "" {
		if fi, err := os.Stat(d); err == nil && fi.IsDir() {
			return d
		}
	}
	if strings.TrimSpace(sidecarDataDir) != "" {
		if err := os.MkdirAll(sidecarDataDir, 0o755); err == nil {
			return sidecarDataDir
		}
	}
	return os.TempDir()
}

// mpvBaseArgs runs mpv audio-only, windowless, idle-waiting for IPC commands.
// --no-config keeps a user's stray global mpv.conf from changing shipped
// playback. There is no --media-controls=yes here (that flag is Windows/macOS
// SMTC-only in mpv); the Linux equivalent is the mpv-mpris plugin, loaded
// explicitly (see mpvArgs / findMPRISPlugin) precisely BECAUSE --no-config
// means mpv won't auto-load it from /etc/mpv/scripts the way a normal
// desktop mpv install would.
var mpvBaseArgs = []string{
	"--idle=yes",
	"--no-video",
	"--no-terminal",
	"--input-ipc-server=" + mpvSockPath,
	"--no-config",
	"--force-window=no",
	"--vo=null",
}

// mpvArgs builds the full mpv argument list for one launch, appending
// --script=<mpris.so> when the plugin is found (BUG-250: OS media-key /
// lock-screen now-playing integration). Computed per-launch, not as a
// package-level var, because the plugin path depends on where mpv itself
// resolved from - not known until findMPVBin() runs.
func mpvArgs(mpvBinPath string) []string {
	args := append([]string(nil), mpvBaseArgs...)
	if plugin, ok := findMPRISPlugin(mpvBinPath); ok {
		args = append(args, "--script="+plugin)
	}
	return args
}

// findMPRISPlugin locates mpris.so (github.com/hoyon/mpv-mpris, staged from
// the Ubuntu "mpv-mpris" apt package) so it can be loaded via --script=,
// since --no-config above means mpv will not find it on its own. Checks an
// explicit CASSETTE_MPV_MPRIS override first, then the same directory the
// mpv binary itself was resolved from (where linux-desktop.yml stages it,
// alongside cd-paranoia/flac/fpcalc/ffmpeg in bin/). Absence is NOT an error -
// MPRIS is a nice-to-have; a build without the plugin just runs mpv without
// it, exactly as this port has run since 71f50967, only now with a real path
// to enable it rather than none.
func findMPRISPlugin(mpvBinPath string) (string, bool) {
	if env := strings.TrimSpace(os.Getenv("CASSETTE_MPV_MPRIS")); env != "" {
		if _, err := os.Stat(env); err == nil {
			return env, true
		}
		log.Printf("playback: CASSETTE_MPV_MPRIS is set to %q but no file is there; starting mpv without MPRIS", env)
		return "", false
	}
	candidate := filepath.Join(filepath.Dir(mpvBinPath), "mpris.so")
	if _, err := os.Stat(candidate); err == nil {
		return candidate, true
	}
	return "", false
}

func init() { playbackOut = newLinuxPlayback() }

// mpvReply is one reply line: {"data":<value>,"error":"success"} for reads,
// {"error":"success"} for commands.
type mpvReply struct {
	Data  json.RawMessage `json:"data"`
	Error string          `json:"error"`
}

// linuxPlayback drives a headless mpv over its Unix-domain-socket IPC.
type linuxPlayback struct {
	// startMu serializes engine startup so two concurrent commands don't both
	// spawn an mpv.
	startMu sync.Mutex

	// writeMu guards conn + serializes writes to the socket (net.Conn writes
	// from several goroutines must not interleave). Never held while waiting
	// for a reply.
	writeMu sync.Mutex
	conn    net.Conn
	cmd     *exec.Cmd

	// mu guards the driver's queue state and the pending-reply table. Never
	// held while waiting for a reply (that would deadlock the reader).
	mu        sync.Mutex
	queue     []resolvedTrack
	index     int
	repeat    string // off | all | one
	started   bool   // a track is loaded and not stopped/ended
	paused    bool   // last observed pause state (observe_property keeps it truthful)
	nextReqID int
	pending   map[int]chan mpvReply
}

func newLinuxPlayback() *linuxPlayback {
	return &linuxPlayback{index: -1, repeat: "off", pending: map[int]chan mpvReply{}}
}

// ─── Engine lifecycle ──────────────────────────────────────────────────────────

func (p *linuxPlayback) alive() bool {
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	return p.conn != nil
}

// ensureEngine guarantees a live IPC connection to an mpv, adopting one that is
// already running (a restarted sidecar) before spawning a new one. Returns a
// clear error if mpv cannot be found or its socket never opens.
func (p *linuxPlayback) ensureEngine() error {
	if p.alive() {
		return nil
	}
	p.startMu.Lock()
	defer p.startMu.Unlock()
	if p.alive() {
		return nil
	}

	// Adopt an already-running engine on the fixed socket path, so a sidecar
	// restart reconnects instead of leaking a second mpv.
	if conn, err := net.DialTimeout("unix", mpvSockPath, 500*time.Millisecond); err == nil {
		p.attach(conn, nil)
		return nil
	}

	// A stale socket file from an unclean prior shutdown (mpv killed, sidecar
	// crashed) sits on disk but refuses new connections. Remove it before
	// spawning, or mpv's own bind() would fail with "address already in use".
	removeStaleSocket(mpvSockPath)

	bin, err := findMPVBin()
	if err != nil {
		return err
	}
	cmd := exec.Command(bin, mpvArgs(bin)...)
	// Its own process group so a future kill can tear it down as a tree
	// (mirrors setOwnProcessGroup, used the same way for the rip child).
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("could not start mpv: %w", err)
	}
	conn, err := dialMPV()
	if err != nil {
		_ = cmd.Process.Kill()
		return fmt.Errorf("mpv started but its IPC socket never opened: %w", err)
	}
	p.attach(conn, cmd)
	return nil
}

// removeStaleSocket deletes a leftover socket file so a fresh mpv can bind the
// path. Ignores a missing file; a real removal failure just surfaces later as a
// clear "could not start mpv" from cmd.Start()/dialMPV().
func removeStaleSocket(path string) {
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		log.Printf("playback: could not remove stale mpv socket %s: %v", path, err)
	}
}

// attach stores a live connection, starts the reader, and subscribes to pause
// flips (an external controller, if one ever exists, could change play state
// behind our back; this also keeps state() truthful after our own set_property).
func (p *linuxPlayback) attach(conn net.Conn, cmd *exec.Cmd) {
	p.writeMu.Lock()
	p.conn = conn
	p.cmd = cmd
	p.writeMu.Unlock()
	go p.readLoop(conn)
	_ = p.send(map[string]any{"command": []any{"observe_property", 1, "pause"}})
}

// dialMPV waits out the short window between exec and mpv creating the socket.
func dialMPV() (net.Conn, error) {
	deadline := time.Now().Add(5 * time.Second)
	for {
		conn, err := net.DialTimeout("unix", mpvSockPath, 200*time.Millisecond)
		if err == nil {
			return conn, nil
		}
		if time.Now().After(deadline) {
			return nil, err
		}
		time.Sleep(50 * time.Millisecond)
	}
}

// findMPVBin locates the mpv binary: an explicit CASSETTE_MPV_BIN override, else
// PATH (the desktop shell prepends bin/). A clear error rather than a crash when
// absent.
func findMPVBin() (string, error) {
	if env := strings.TrimSpace(os.Getenv("CASSETTE_MPV_BIN")); env != "" {
		if _, err := os.Stat(env); err == nil {
			return env, nil
		}
		return "", fmt.Errorf("CASSETTE_MPV_BIN is set to %q but no file is there", env)
	}
	if path, err := exec.LookPath("mpv"); err == nil {
		return path, nil
	}
	return "", errors.New("mpv not found: bundle it in bin/ (on PATH) or set CASSETTE_MPV_BIN")
}

// ─── Reader: demultiplex events from replies ───────────────────────────────────

func (p *linuxPlayback) readLoop(conn net.Conn) {
	sc := bufio.NewScanner(conn)
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for sc.Scan() {
		var msg struct {
			Event     string          `json:"event"`
			Name      string          `json:"name"`
			Data      json.RawMessage `json:"data"`
			Reason    string          `json:"reason"`
			RequestID *int            `json:"request_id"`
			Error     string          `json:"error"`
		}
		if err := json.Unmarshal(sc.Bytes(), &msg); err != nil {
			continue
		}
		if msg.Event != "" {
			p.handleEvent(msg.Event, msg.Name, msg.Data, msg.Reason)
			continue
		}
		if msg.RequestID != nil {
			p.mu.Lock()
			ch, ok := p.pending[*msg.RequestID]
			if ok {
				delete(p.pending, *msg.RequestID)
			}
			p.mu.Unlock()
			if ok {
				ch <- mpvReply{Data: msg.Data, Error: msg.Error} // buffered(1), never blocks
			}
		}
	}
	// The socket closed (mpv exited). Mark the engine dead so the next command
	// respawns, and drop any pending waiters (they time out).
	p.writeMu.Lock()
	if p.conn == conn {
		p.conn = nil
		p.cmd = nil
	}
	p.writeMu.Unlock()
	p.mu.Lock()
	p.started = false
	for id := range p.pending {
		delete(p.pending, id)
	}
	p.mu.Unlock()
}

func (p *linuxPlayback) handleEvent(event, name string, data json.RawMessage, reason string) {
	switch event {
	case "property-change":
		if name == "pause" {
			var b bool
			if json.Unmarshal(data, &b) == nil {
				p.mu.Lock()
				p.paused = b
				p.mu.Unlock()
			}
		}
	case "end-file":
		// eof = the track played out (advance the queue); error = a failed track
		// (skip it forward so the queue does not stall). stop/quit are our own
		// commands and must not trigger an advance.
		if reason == "eof" || reason == "error" {
			p.advance(1, true)
		}
	}
}

// ─── Command surface ───────────────────────────────────────────────────────────

func (p *linuxPlayback) play(items []resolvedTrack, startIndex int, repeat string) error {
	if err := p.ensureEngine(); err != nil {
		return err
	}
	if startIndex < 0 || startIndex >= len(items) {
		startIndex = 0
	}
	p.mu.Lock()
	p.queue = items
	p.index = startIndex
	p.repeat = normalizeRepeat(repeat)
	p.started = true
	cur := items[startIndex]
	p.mu.Unlock()
	return p.loadAndPlay(cur)
}

// setUpcoming replaces the driver's queue after the current track. The queue is
// driver-managed (mpv only ever holds the one loaded track), so nothing is sent to
// mpv: the current track plays on, and the next advance reads the new list.
func (p *linuxPlayback) setUpcoming(items []resolvedTrack) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.index < 0 || p.index >= len(p.queue) {
		return nil
	}
	p.queue = append(append(make([]resolvedTrack, 0, p.index+1+len(items)), p.queue[:p.index+1]...), items...)
	return nil
}

func (p *linuxPlayback) pause() error {
	if err := p.ensureEngine(); err != nil {
		return err
	}
	p.mu.Lock()
	p.paused = true
	p.mu.Unlock()
	return p.send(map[string]any{"command": []any{"set_property", "pause", true}})
}

func (p *linuxPlayback) resume() error {
	if err := p.ensureEngine(); err != nil {
		return err
	}
	p.mu.Lock()
	p.paused = false
	p.mu.Unlock()
	return p.send(map[string]any{"command": []any{"set_property", "pause", false}})
}

func (p *linuxPlayback) next() error {
	if err := p.ensureEngine(); err != nil {
		return err
	}
	p.advance(1, false)
	return nil
}

// prev reproduces the macOS rule: if more than 3s into the track (or already on
// the first track) restart the current track, else step back one.
func (p *linuxPlayback) prev() error {
	if err := p.ensureEngine(); err != nil {
		return err
	}
	p.mu.Lock()
	idx := p.index
	p.mu.Unlock()
	pos, _ := p.getFloat("time-pos")
	if pos > 3 || idx <= 0 {
		return p.seek(0)
	}
	p.advance(-1, false)
	return nil
}

func (p *linuxPlayback) seek(positionSeconds float64) error {
	if err := p.ensureEngine(); err != nil {
		return err
	}
	return p.send(map[string]any{"command": []any{"seek", positionSeconds, "absolute"}})
}

func (p *linuxPlayback) setRepeat(mode string) error {
	p.mu.Lock()
	p.repeat = normalizeRepeat(mode)
	p.mu.Unlock()
	return nil
}

func (p *linuxPlayback) setVolume(level float64) error {
	if err := p.ensureEngine(); err != nil {
		return err
	}
	if level < 0 {
		level = 0
	} else if level > 1 {
		level = 1
	}
	return p.send(map[string]any{"command": []any{"set_property", "volume", level * 100}})
}

func (p *linuxPlayback) state() (playbackState, error) {
	p.mu.Lock()
	started := p.started
	idx := p.index
	qlen := len(p.queue)
	paused := p.paused
	var curID string
	var durMeta float64
	if started && idx >= 0 && idx < qlen {
		curID = p.queue[idx].TrackID
		durMeta = p.queue[idx].DurationSeconds
	}
	p.mu.Unlock()

	if !started || !p.alive() {
		// Idle snapshot, matching the darwin fail-soft shape.
		return playbackState{QueueIndex: -1}, nil
	}
	pos, _ := p.getFloat("time-pos") // unavailable between tracks -> 0
	dur, ok := p.getFloat("duration")
	if !ok || dur <= 0 {
		dur = durMeta // fall back to the queue metadata duration
	}
	return playbackState{
		CurrentTrackID:  curID,
		PositionSeconds: pos,
		DurationSeconds: dur,
		IsPlaying:       !paused,
		QueueIndex:      idx,
		QueueLength:     qlen,
	}, nil
}

func (p *linuxPlayback) writeLevels(w http.ResponseWriter) {
	// mpv has no external PCM tap; the visualizer is idle on Linux (accepted,
	// same as Windows).
	writeLevelsIdle(w)
}

// ─── Queue advance + load ──────────────────────────────────────────────────────

// advance moves the driver's queue position and loads the resulting track. auto
// is true when triggered by the end-file event (so repeat-one reloads the same
// track); an explicit next/prev passes false. At the end of the queue: wrap when
// repeat is "all", otherwise stop.
func (p *linuxPlayback) advance(step int, auto bool) {
	p.mu.Lock()
	if len(p.queue) == 0 {
		p.mu.Unlock()
		return
	}
	if auto && p.repeat == "one" {
		cur := p.queue[p.index]
		p.mu.Unlock()
		_ = p.loadAndPlay(cur)
		return
	}
	ni := p.index + step
	if ni >= len(p.queue) {
		if p.repeat == "all" {
			ni = 0
		} else {
			p.started = false
			p.mu.Unlock()
			_ = p.send(map[string]any{"command": []any{"stop"}})
			return
		}
	}
	if ni < 0 {
		ni = 0
	}
	p.index = ni
	p.started = true
	cur := p.queue[ni]
	p.mu.Unlock()
	_ = p.loadAndPlay(cur)
}

// loadAndPlay loads one track and starts it. force-media-title is set as a
// property AFTER the load (not inline in loadfile options) so a comma in the
// title cannot be misparsed as an option separator.
func (p *linuxPlayback) loadAndPlay(t resolvedTrack) error {
	if err := p.send(map[string]any{"command": []any{"loadfile", t.URL, "replace"}}); err != nil {
		return err
	}
	title := t.Title
	if t.Artist != "" && t.Title != "" {
		title = t.Artist + " - " + t.Title
	}
	if title != "" {
		_ = p.send(map[string]any{"command": []any{"set_property", "force-media-title", title}})
	}
	p.mu.Lock()
	p.paused = false
	p.mu.Unlock()
	return p.send(map[string]any{"command": []any{"set_property", "pause", false}})
}

// ─── Low-level IPC ─────────────────────────────────────────────────────────────

// send writes one JSON command line to the socket. Writes are serialized by
// writeMu.
func (p *linuxPlayback) send(cmd any) error {
	b, err := json.Marshal(cmd)
	if err != nil {
		return err
	}
	b = append(b, '\n')
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	if p.conn == nil {
		return errors.New("mpv engine is not running")
	}
	_, err = p.conn.Write(b)
	return err
}

// getFloat reads a numeric mpv property, correlating the reply by request_id. It
// never holds p.mu while waiting (that would block the reader that delivers the
// reply). ok is false when the property is unavailable (e.g. time-pos between
// tracks) or the read times out.
func (p *linuxPlayback) getFloat(prop string) (float64, bool) {
	p.mu.Lock()
	id := p.nextReqID
	p.nextReqID++
	ch := make(chan mpvReply, 1)
	p.pending[id] = ch
	p.mu.Unlock()

	if err := p.send(map[string]any{"command": []any{"get_property", prop}, "request_id": id}); err != nil {
		p.mu.Lock()
		delete(p.pending, id)
		p.mu.Unlock()
		return 0, false
	}

	select {
	case rep := <-ch:
		if rep.Error != "success" || len(rep.Data) == 0 {
			return 0, false
		}
		var v float64
		if json.Unmarshal(rep.Data, &v) != nil {
			return 0, false
		}
		return v, true
	case <-time.After(2 * time.Second):
		p.mu.Lock()
		delete(p.pending, id)
		p.mu.Unlock()
		return 0, false
	}
}

// shutdown asks mpv to quit and reaps the child. Called by the supervisor's quit
// handler so the headless mpv does not outlive the app and keep playing audio.
func (p *linuxPlayback) shutdown() {
	_ = p.send(map[string]any{"command": []any{"quit"}})
	p.writeMu.Lock()
	cmd := p.cmd
	p.writeMu.Unlock()
	if cmd != nil && cmd.Process != nil {
		pid := cmd.Process.Pid
		// Whole process group, same POSIX mechanism proc_group_posix.go already
		// uses for the rip child. Give the polite quit a moment to land, then
		// force-kill so shutdown never hangs waiting on a wedged mpv.
		killProcessGroup(pid, syscall.SIGTERM)
		done := make(chan struct{})
		go func() { _, _ = cmd.Process.Wait(); close(done) }()
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			killProcessGroup(pid, syscall.SIGKILL)
		}
	}
	removeStaleSocket(mpvSockPath)
	log.Printf("playback: mpv engine shut down")
}
