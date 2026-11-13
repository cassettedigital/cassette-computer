//go:build windows

// playback_platform_windows.go - the Windows audio output engine.
//
// There is no Swift host on Windows, so the sidecar owns the audio engine itself:
// it spawns a bundled, headless mpv.exe and drives it over mpv's JSON IPC named
// pipe (line-delimited UTF-8 JSON, one object per newline, full-duplex). This
// mirrors how the Windows rip path owns cd-paranoia.exe. mpv renders the audio and
// publishes the Windows now-playing card (SMTC) itself via --media-controls=yes;
// the driver keeps a parallel queue so it can answer currentTrackId and reproduce
// the transport behaviors the AVFoundation host has (auto-advance, repeat, the
// >3s-else-step-back prev rule).
//
// The queue is DRIVER-managed, not handed to mpv's own playlist: each track is
// loaded individually with loadfile, and the driver advances on the end-file/eof
// event. That keeps next/prev/repeat logic in one place and identical to macOS.
//
// Levels: mpv exposes no decoded-PCM tap to an external IPC client the way the
// in-process AVFoundation tap does, so writeLevels returns the idle frame. The web
// visualizer degrades to idle on Windows; the transport bar, seek, auto-advance,
// and play-logging (which key off time-pos/duration/pause) all work.
//
// The pipe needs overlapped I/O, which a plain os.OpenFile handle does not do, so
// the connection goes through Microsoft's go-winio (the same named-pipe library
// Docker/containerd use), which hands back a net.Conn driven exactly like the
// macOS Unix-socket seam.

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
	"strings"
	"sync"
	"syscall"
	"time"

	winio "github.com/Microsoft/go-winio"
	"golang.org/x/sys/windows"
)

// mpvPipeName is the named pipe mpv opens for IPC. A fixed name lets a restarted
// sidecar ADOPT an mpv that outlived it (see ensureEngine) instead of stacking up
// orphaned engines holding the pipe.
const mpvPipeName = `\\.\pipe\cassette-mpv`

// mpvArgs runs mpv audio-only, windowless, idle-waiting for IPC commands, with the
// Windows now-playing card + media keys active. --no-config keeps a user's stray
// global mpv.conf from changing shipped playback.
var mpvArgs = []string{
	"--idle=yes",
	"--no-video",
	"--no-terminal",
	"--input-ipc-server=" + mpvPipeName,
	"--media-controls=yes",
	"--no-config",
	"--force-window=no",
	"--vo=null",
}

func init() { playbackOut = newWindowsPlayback() }

// mpvReply is one reply line: {"data":<value>,"error":"success"} for reads,
// {"error":"success"} for commands.
type mpvReply struct {
	Data  json.RawMessage `json:"data"`
	Error string          `json:"error"`
}

// windowsPlayback drives a headless mpv.exe over its IPC pipe.
type windowsPlayback struct {
	// startMu serializes engine startup so two concurrent commands don't both
	// spawn an mpv.
	startMu sync.Mutex

	// writeMu guards conn + serializes writes to the pipe (net.Conn writes from
	// several goroutines must not interleave). Never held while waiting for a reply.
	writeMu sync.Mutex
	conn    net.Conn
	cmd     *exec.Cmd

	// mu guards the driver's queue state and the pending-reply table. Never held
	// while waiting for a reply (that would deadlock the reader).
	mu        sync.Mutex
	queue     []resolvedTrack
	index     int
	repeat    string // off | all | one
	started   bool   // a track is loaded and not stopped/ended
	paused    bool   // last observed pause state (observe_property keeps it truthful)
	nextReqID int
	pending   map[int]chan mpvReply
}

func newWindowsPlayback() *windowsPlayback {
	return &windowsPlayback{index: -1, repeat: "off", pending: map[int]chan mpvReply{}}
}

// ─── Engine lifecycle ──────────────────────────────────────────────────────────

func (p *windowsPlayback) alive() bool {
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	return p.conn != nil
}

// ensureEngine guarantees a live IPC connection to an mpv, adopting one that is
// already running (a restarted sidecar) before spawning a new one. Returns a clear
// error if mpv.exe cannot be found or its pipe never opens.
func (p *windowsPlayback) ensureEngine() error {
	if p.alive() {
		return nil
	}
	p.startMu.Lock()
	defer p.startMu.Unlock()
	if p.alive() {
		return nil
	}

	// Adopt an already-running engine on the fixed pipe name, so a sidecar restart
	// reconnects instead of leaking a second mpv.exe.
	adopt := 500 * time.Millisecond
	if conn, err := winio.DialPipe(mpvPipeName, &adopt); err == nil {
		p.attach(conn, nil)
		return nil
	}

	bin, err := findMPVBin()
	if err != nil {
		return err
	}
	cmd := exec.Command(bin, mpvArgs...)
	// No console window for the headless engine, and its own process group so a
	// future taskkill /T can tear it down as a tree.
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: windows.CREATE_NO_WINDOW | windows.CREATE_NEW_PROCESS_GROUP,
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("could not start mpv: %w", err)
	}
	conn, err := dialMPV()
	if err != nil {
		_ = cmd.Process.Kill()
		return fmt.Errorf("mpv started but its IPC pipe never opened: %w", err)
	}
	p.attach(conn, cmd)
	return nil
}

// attach stores a live connection, starts the reader, and subscribes to pause
// flips (the SMTC card and media keys change play state behind our back).
func (p *windowsPlayback) attach(conn net.Conn, cmd *exec.Cmd) {
	p.writeMu.Lock()
	p.conn = conn
	p.cmd = cmd
	p.writeMu.Unlock()
	go p.readLoop(conn)
	_ = p.send(map[string]any{"command": []any{"observe_property", 1, "pause"}})
}

// dialMPV waits out the short window between exec and mpv creating the pipe.
func dialMPV() (net.Conn, error) {
	deadline := time.Now().Add(5 * time.Second)
	timeout := 200 * time.Millisecond
	for {
		conn, err := winio.DialPipe(mpvPipeName, &timeout)
		if err == nil {
			return conn, nil
		}
		if time.Now().After(deadline) {
			return nil, err
		}
		time.Sleep(50 * time.Millisecond)
	}
}

// findMPVBin locates mpv.exe: an explicit CASSETTE_MPV_BIN override, else PATH
// (the desktop shell prepends bin/). A clear error rather than a crash when absent.
func findMPVBin() (string, error) {
	if env := strings.TrimSpace(os.Getenv("CASSETTE_MPV_BIN")); env != "" {
		if _, err := os.Stat(env); err == nil {
			return env, nil
		}
		return "", fmt.Errorf("CASSETTE_MPV_BIN is set to %q but no file is there", env)
	}
	for _, name := range []string{"mpv.exe", "mpv"} {
		if path, err := exec.LookPath(name); err == nil {
			return path, nil
		}
	}
	return "", errors.New("mpv.exe not found: bundle it in bin/ (on PATH) or set CASSETTE_MPV_BIN")
}

// ─── Reader: demultiplex events from replies ───────────────────────────────────

func (p *windowsPlayback) readLoop(conn net.Conn) {
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
	// The pipe closed (mpv exited). Mark the engine dead so the next command
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

func (p *windowsPlayback) handleEvent(event, name string, data json.RawMessage, reason string) {
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

func (p *windowsPlayback) play(items []resolvedTrack, startIndex int, repeat string) error {
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
func (p *windowsPlayback) setUpcoming(items []resolvedTrack) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.index < 0 || p.index >= len(p.queue) {
		return nil
	}
	p.queue = append(append(make([]resolvedTrack, 0, p.index+1+len(items)), p.queue[:p.index+1]...), items...)
	return nil
}

func (p *windowsPlayback) pause() error {
	if err := p.ensureEngine(); err != nil {
		return err
	}
	p.mu.Lock()
	p.paused = true
	p.mu.Unlock()
	return p.send(map[string]any{"command": []any{"set_property", "pause", true}})
}

func (p *windowsPlayback) resume() error {
	if err := p.ensureEngine(); err != nil {
		return err
	}
	p.mu.Lock()
	p.paused = false
	p.mu.Unlock()
	return p.send(map[string]any{"command": []any{"set_property", "pause", false}})
}

func (p *windowsPlayback) next() error {
	if err := p.ensureEngine(); err != nil {
		return err
	}
	p.advance(1, false)
	return nil
}

// prev reproduces the macOS rule: if more than 3s into the track (or already on
// the first track) restart the current track, else step back one.
func (p *windowsPlayback) prev() error {
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

func (p *windowsPlayback) seek(positionSeconds float64) error {
	if err := p.ensureEngine(); err != nil {
		return err
	}
	return p.send(map[string]any{"command": []any{"seek", positionSeconds, "absolute"}})
}

func (p *windowsPlayback) setRepeat(mode string) error {
	p.mu.Lock()
	p.repeat = normalizeRepeat(mode)
	p.mu.Unlock()
	return nil
}

func (p *windowsPlayback) setVolume(level float64) error {
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

func (p *windowsPlayback) state() (playbackState, error) {
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

func (p *windowsPlayback) writeLevels(w http.ResponseWriter) {
	// mpv has no external PCM tap; the visualizer is idle on Windows (accepted).
	writeLevelsIdle(w)
}

// ─── Queue advance + load ──────────────────────────────────────────────────────

// advance moves the driver's queue position and loads the resulting track. auto is
// true when triggered by the end-file event (so repeat-one reloads the same track);
// an explicit next/prev passes false. At the end of the queue: wrap when repeat is
// "all", otherwise stop.
func (p *windowsPlayback) advance(step int, auto bool) {
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

// loadAndPlay loads one track and starts it. force-media-title is set as a property
// AFTER the load (not inline in loadfile options) so a comma in the title cannot be
// misparsed as an option separator; it drives the SMTC now-playing title.
func (p *windowsPlayback) loadAndPlay(t resolvedTrack) error {
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

// send writes one JSON command line to the pipe. Writes are serialized by writeMu.
func (p *windowsPlayback) send(cmd any) error {
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
func (p *windowsPlayback) getFloat(prop string) (float64, bool) {
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
func (p *windowsPlayback) shutdown() {
	_ = p.send(map[string]any{"command": []any{"quit"}})
	p.writeMu.Lock()
	cmd := p.cmd
	p.writeMu.Unlock()
	if cmd != nil && cmd.Process != nil {
		_ = exec.Command("taskkill", "/PID", fmt.Sprint(cmd.Process.Pid), "/T", "/F").Run()
	}
	log.Printf("playback: mpv engine shut down")
}
