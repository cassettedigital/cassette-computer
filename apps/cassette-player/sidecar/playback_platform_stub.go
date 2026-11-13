//go:build !darwin && !windows && !linux

// playback_platform_stub.go - placeholder output engine for whatever's left once
// macOS, Windows, and Linux are covered (e.g. an obscure BSD cross-compile).
// macOS is playback_platform_darwin.go, Windows is playback_platform_windows.go,
// and Linux is playback_platform_linux.go; this file covers everything else so
// the package COMPILES without an audio engine.
//
// Transport commands fail with a clear "not supported on this OS" error. state()
// returns the idle snapshot with a nil error (so the web poller and the
// play-logger see a quiet "nothing playing" rather than an error to special-case),
// and writeLevels writes the same idle frame the real engines fall back to.

package main

import (
	"errors"
	"net/http"
)

var errPlaybackUnsupported = errors.New("playback output is not supported on this OS")

func init() { playbackOut = stubPlayback{} }

type stubPlayback struct{}

func (stubPlayback) play([]resolvedTrack, int, string) error { return errPlaybackUnsupported }
func (stubPlayback) setUpcoming([]resolvedTrack) error       { return errPlaybackUnsupported }
func (stubPlayback) pause() error                            { return errPlaybackUnsupported }
func (stubPlayback) resume() error                           { return errPlaybackUnsupported }
func (stubPlayback) next() error                             { return errPlaybackUnsupported }
func (stubPlayback) prev() error                             { return errPlaybackUnsupported }
func (stubPlayback) seek(float64) error                      { return errPlaybackUnsupported }
func (stubPlayback) setRepeat(string) error                  { return errPlaybackUnsupported }
func (stubPlayback) setVolume(float64) error                 { return errPlaybackUnsupported }

func (stubPlayback) state() (playbackState, error) {
	return playbackState{QueueIndex: -1}, nil
}

func (stubPlayback) writeLevels(w http.ResponseWriter) { writeLevelsIdle(w) }

func (stubPlayback) shutdown() {}
