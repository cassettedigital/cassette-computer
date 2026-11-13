//go:build darwin

// playback_platform_darwin.go - the macOS audio output engine.
//
// On macOS the in-process Swift host renders audio via AVFoundation and runs a
// tiny loopback HTTP server on 127.0.0.1:5174 (POST /play|/pause|/resume|/next|
// /prev|/seek|/setRepeat|/setVolume, GET /state, GET /levels). The sidecar is a
// client of it. This file is that client, relocated verbatim from the old inline
// playback.go/playback-levels.go so the Swift contract and behavior are unchanged:
// same paths, same JSON bodies, same timeouts (5s post, 3s state, 2s levels), same
// idle-levels fallback.

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// swiftControlBase is the loopback address of the in-process Swift playback host.
const swiftControlBase = "http://127.0.0.1:5174"

func init() { playbackOut = darwinPlayback{} }

// darwinPlayback forwards every transport command to the Swift host over loopback
// HTTP. It carries no state of its own: the Swift engine owns the queue and the
// AVFoundation player.
type darwinPlayback struct{}

func (darwinPlayback) play(items []resolvedTrack, startIndex int, repeat string) error {
	return postSwift("/play", map[string]any{"queue": items, "startIndex": startIndex, "repeat": repeat})
}

func (darwinPlayback) setUpcoming(items []resolvedTrack) error {
	return postSwift("/setUpcoming", map[string]any{"queue": items})
}

func (darwinPlayback) pause() error  { return postSwift("/pause", map[string]any{}) }
func (darwinPlayback) resume() error { return postSwift("/resume", map[string]any{}) }
func (darwinPlayback) next() error   { return postSwift("/next", map[string]any{}) }
func (darwinPlayback) prev() error   { return postSwift("/prev", map[string]any{}) }

func (darwinPlayback) seek(positionSeconds float64) error {
	return postSwift("/seek", map[string]any{"positionSeconds": positionSeconds})
}

func (darwinPlayback) setRepeat(mode string) error {
	return postSwift("/setRepeat", map[string]any{"mode": mode})
}

func (darwinPlayback) setVolume(level float64) error {
	return postSwift("/setVolume", map[string]any{"level": level})
}

func (darwinPlayback) state() (playbackState, error) {
	var st playbackState
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, swiftControlBase+"/state", nil)
	if err != nil {
		return st, err
	}
	vouch(req) // the helper refuses calls without this launch's key (BUG-777)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return st, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return st, fmt.Errorf("swift /state returned %d", resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(&st); err != nil {
		return st, err
	}
	return st, nil
}

// shutdown is a no-op on macOS: the Swift/AVFoundation host is a separate process
// the app shell spawns and reaps, so the sidecar has nothing to tear down here.
func (darwinPlayback) shutdown() {}

func (darwinPlayback) writeLevels(w http.ResponseWriter) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, swiftControlBase+"/levels", nil)
	if err != nil {
		writeLevelsIdle(w)
		return
	}
	vouch(req) // the helper refuses calls without this launch's key (BUG-777)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		writeLevelsIdle(w)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		writeLevelsIdle(w)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = io.Copy(w, io.LimitReader(resp.Body, 1<<20))
}

// postSwift POSTs a JSON body to the Swift host (5s timeout), relocated unchanged.
func postSwift(path string, body any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, swiftControlBase+path, bytes.NewReader(b))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	vouch(req) // the helper refuses calls without this launch's key (BUG-777)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("swift %s returned %d", path, resp.StatusCode)
	}
	return nil
}
