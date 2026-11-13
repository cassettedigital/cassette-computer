// Per-OS playback OUTPUT seam.
//
// Native playback is two layers, exactly like the disc seam (rip_platform.go).
// The OS-NEUTRAL layer - resolving each track id to a local Subsonic stream URL,
// keeping the queue metadata for play-logging, and serving every /api/playback/*
// HTTP handler - is the same on every platform and stays build-tag-free
// (playback.go, playback-levels.go). The OS-SPECIFIC layer is the audio OUTPUT:
// what actually renders the audio and reports transport state back. That differs
// per OS and lives behind the playbackPlatform interface below.
//
// The neutral layer NEVER talks to an engine directly; it calls through
// playbackOut. macOS forwards to the in-process Swift/AVFoundation host over
// loopback HTTP (playback_platform_darwin.go, byte-identical to the original
// inline code). Windows drives a bundled headless mpv.exe over a named pipe
// (playback_platform_windows.go); Linux drives the same headless mpv over a
// Unix domain socket instead (playback_platform_linux.go).
// playback_platform_stub.go is the placeholder for whatever's left (e.g. an
// obscure BSD cross-compile) so the package still builds there.

package main

import "net/http"

// resolvedTrack is one queue entry after the broker has resolved its id to a
// playable local stream URL. It is the shape handed to the output engine. The
// json tags are the wire contract the macOS Swift host already expects, so the
// darwin path marshals a []resolvedTrack into the identical /play body.
type resolvedTrack struct {
	TrackID         string  `json:"trackId"`
	URL             string  `json:"url"`
	Title           string  `json:"title"`
	Artist          string  `json:"artist"`
	Album           string  `json:"album"`
	DurationSeconds float64 `json:"durationSeconds"`
}

// playbackState is the transport snapshot the web poller and the play-logger
// read. Same fields and json tags the macOS Swift /state endpoint returns, so the
// proxied JSON at /api/playback/state is unchanged across platforms.
type playbackState struct {
	CurrentTrackID  string  `json:"currentTrackId"`
	PositionSeconds float64 `json:"positionSeconds"`
	DurationSeconds float64 `json:"durationSeconds"`
	IsPlaying       bool    `json:"isPlaying"`
	QueueIndex      int     `json:"queueIndex"`
	QueueLength     int     `json:"queueLength"`
	// Failures are the last few songs the engine could not play, oldest first
	// (the macOS helper reports them; the others leave it empty). The engine
	// skips a failed song like an ended one, and the play logger logs each
	// failure once by its Seq, which only grows (BUG-791).
	Failures []playbackFailure `json:"failures,omitempty"`
}

// playbackFailure is one song the engine could not open or that broke off
// mid-play: its track id and the engine's error, already free of the stream
// address.
type playbackFailure struct {
	Seq     int    `json:"seq"`
	TrackID string `json:"trackId"`
	Error   string `json:"error"`
}

// playbackPlatform is the seam between the OS-neutral playback broker and the
// platform-specific audio output. One implementation is compiled in per OS
// (selected by the init() in the matching platform file), exposed as playbackOut.
type playbackPlatform interface {
	// play replaces the queue and starts rendering at startIndex. repeat is one
	// of off|all|one (already normalized by the caller).
	play(items []resolvedTrack, startIndex int, repeat string) error

	// setUpcoming replaces everything after the current track and leaves the
	// current track playing where it is. An empty list clears what's next; with
	// nothing loaded it changes nothing.
	setUpcoming(items []resolvedTrack) error

	pause() error
	resume() error
	next() error
	prev() error

	// seek jumps to an absolute position in the current track.
	seek(positionSeconds float64) error

	// setRepeat changes the loop mode (off|all|one).
	setRepeat(mode string) error

	// setVolume sets output level on a 0..1 scale (already clamped).
	setVolume(level float64) error

	// state returns the live transport snapshot. It must fail soft: a not-playing
	// or unreachable engine returns an idle snapshot with a nil error rather than
	// forcing the web poller to special-case a miss.
	state() (playbackState, error)

	// writeLevels writes the visualizer frame as a JSON body. Engines with no PCM
	// tap write the idle frame via writeLevelsIdle.
	writeLevels(w http.ResponseWriter)

	// shutdown stops the output engine on supervisor quit. On macOS this is a
	// no-op (the Swift host is a separate process the app shell reaps); on Windows
	// it quits + reaps the headless mpv child so audio does not keep playing after
	// the app is gone.
	shutdown()
}

// playbackOut is the active per-OS output engine. It is assigned by the init() in
// the platform file compiled for this build (darwin -> darwinPlayback, windows ->
// windowsPlayback, else -> stubPlayback).
var playbackOut playbackPlatform
