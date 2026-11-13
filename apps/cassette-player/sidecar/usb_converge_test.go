package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestUsbEntryTier(t *testing.T) {
	if got := usbEntryTier(usbManifestTrack{Path: "A/B/01.flac"}); got != "lossless" {
		t.Fatalf("an untiered original reads as lossless, got %q", got)
	}
	if got := usbEntryTier(usbManifestTrack{Path: "A/B/01.mp3"}); got != "unknown" {
		t.Fatalf("an untiered mp3 is unknown, got %q", got)
	}
	if got := usbEntryTier(usbManifestTrack{Path: "A/B/01.mp3", Tier: "high"}); got != "high" {
		t.Fatalf("a recorded tier wins, got %q", got)
	}
}

func TestUsbHasRoomToReplace(t *testing.T) {
	if !usbHasRoomToReplace(-1, 1<<30) {
		t.Fatal("unknown free space must not block")
	}
	if usbHasRoomToReplace(usbReplaceMarginBytes+10, 100) {
		t.Fatal("a replacement that eats into the margin must be refused")
	}
	if !usbHasRoomToReplace(usbReplaceMarginBytes+1000, 100) {
		t.Fatal("a replacement that leaves the margin must be allowed")
	}
}

// A card of FLAC originals converges to Efficient: each original becomes an
// MP3 from the transcoder at the same place, the original goes, the manifest
// records the tier, and the track's identity is untouched.
func TestConvergeUsbTiersConvertsOriginalsToTheTier(t *testing.T) {
	// t.TempDir() lives under a symlink on macOS (/var → /private/var); the hub's
	// path guard compares resolved paths, so resolve the root up front.
	music, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	oldMusic, oldBase := sidecarMusicDir, navidromeBase
	sidecarMusicDir = music
	t.Cleanup(func() { sidecarMusicDir, navidromeBase = oldMusic, oldBase })

	srcDir := filepath.Join(music, "Bleachers", "Strange Desire")
	if err := os.MkdirAll(srcDir, 0o755); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(srcDir, "01 - Wild Heart.flac")
	if err := os.WriteFile(src, []byte("FLACORIGINALBYTES"), 0o644); err != nil {
		t.Fatal(err)
	}

	// A Navidrome double: getSong answers the real path, stream answers MP3 bytes.
	nav := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/rest/getSong":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"subsonic-response": map[string]any{"status": "ok", "song": map[string]any{"path": src}},
			})
		case "/rest/stream":
			if r.URL.Query().Get("format") != "mp3" || r.URL.Query().Get("maxBitRate") != "128" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			w.Header().Set("Content-Type", "audio/mpeg")
			_, _ = w.Write([]byte("MP3BYTES"))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer nav.Close()
	navidromeBase = nav.URL

	card := t.TempDir()
	withFakeUSB(t, []usbVolume{{MountPath: card, Name: "ECHO MINI", Writable: true}})
	if err := writeUsbMarker(card, usbMarker{DeviceID: "usb-c", Label: "ECHO MINI"}); err != nil {
		t.Fatal(err)
	}
	// What 0.5.11 left on the card: the original, untiered.
	rel := "Bleachers/Strange Desire/01 - Wild Heart.flac"
	oldOnCard := usbCardPath(card, rel)
	if err := os.MkdirAll(filepath.Dir(oldOnCard), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(oldOnCard, []byte("FLACORIGINALBYTES"), 0o644); err != nil {
		t.Fatal(err)
	}
	man := readUsbManifest(card)
	man.Tracks["lid-1"] = usbManifestTrack{Path: rel, SubsonicID: "song1", Size: 17}
	if err := writeUsbManifest(card, man); err != nil {
		t.Fatal(err)
	}
	rec := &usbDeviceRecord{DeviceID: "usb-c", Label: "ECHO MINI"}
	liveState.UsbDevices = map[string]*usbDeviceRecord{"usb-c": rec}
	usbMu.Lock()
	usbLive["usb-c"] = &usbLiveState{Mounted: true, MountPath: card}
	usbMu.Unlock()

	n, stalled := convergeUsbTiers(liveState, rec, usbVolume{MountPath: card}, "efficient")
	if n != 1 || stalled {
		t.Fatalf("converted=%d stalled=%v", n, stalled)
	}
	newOnCard := usbCardPath(card, "Bleachers/Strange Desire/01 - Wild Heart.mp3")
	if b, err := os.ReadFile(newOnCard); err != nil || string(b) != "MP3BYTES" {
		t.Fatalf("mp3 not on card: %q %v", b, err)
	}
	if _, err := os.Stat(oldOnCard); !os.IsNotExist(err) {
		t.Fatal("the original must leave the card once the mp3 is in place")
	}
	got := readUsbManifest(card).Tracks["lid-1"]
	if got.Tier != "efficient" || got.Path != "Bleachers/Strange Desire/01 - Wild Heart.mp3" || got.Size != int64(len("MP3BYTES")) {
		t.Fatalf("manifest after convergence: %+v", got)
	}
	if _, err := os.ReadFile(src); err != nil {
		t.Fatal("the library original must never be touched")
	}

	// Already converged: nothing to do.
	if n, _ := convergeUsbTiers(liveState, rec, usbVolume{MountPath: card}, "efficient"); n != 0 {
		t.Fatalf("second pass converted %d", n)
	}
	// Back to lossless: the original returns and the mp3 goes.
	n, stalled = convergeUsbTiers(liveState, rec, usbVolume{MountPath: card}, "lossless")
	if n != 1 || stalled {
		t.Fatalf("back to lossless: converted=%d stalled=%v", n, stalled)
	}
	if b, err := os.ReadFile(oldOnCard); err != nil || string(b) != "FLACORIGINALBYTES" {
		t.Fatalf("original not restored: %q %v", b, err)
	}
	if _, err := os.Stat(newOnCard); !os.IsNotExist(err) {
		t.Fatal("the mp3 must leave once the original is back")
	}
}

// Out of room mid-conversion: the pass stops, the device holds, nothing half
// written is left behind.
func TestConvergeUsbTiersHoldsWhenTheCardIsFull(t *testing.T) {
	// t.TempDir() lives under a symlink on macOS (/var → /private/var); the hub's
	// path guard compares resolved paths, so resolve the root up front.
	music, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	oldMusic, oldBase := sidecarMusicDir, navidromeBase
	sidecarMusicDir = music
	t.Cleanup(func() { sidecarMusicDir, navidromeBase = oldMusic, oldBase })
	src := filepath.Join(music, "A", "B", "01.flac")
	if err := os.MkdirAll(filepath.Dir(src), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(src, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	nav := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"subsonic-response": map[string]any{"status": "ok", "song": map[string]any{"path": src}},
		})
	}))
	defer nav.Close()
	navidromeBase = nav.URL

	card := t.TempDir()
	withFakeUSB(t, nil)
	usbOS = tightUSB{} // reports almost no free space
	if err := writeUsbMarker(card, usbMarker{DeviceID: "usb-t", Label: "TIGHT"}); err != nil {
		t.Fatal(err)
	}
	man := readUsbManifest(card)
	man.Tracks["lid"] = usbManifestTrack{Path: "A/B/01.flac", SubsonicID: "s", Size: 1}
	if err := writeUsbManifest(card, man); err != nil {
		t.Fatal(err)
	}
	rec := &usbDeviceRecord{DeviceID: "usb-t", Label: "TIGHT"}
	liveState.UsbDevices = map[string]*usbDeviceRecord{"usb-t": rec}
	usbMu.Lock()
	usbLive["usb-t"] = &usbLiveState{Mounted: true, MountPath: card}
	usbMu.Unlock()

	n, stalled := convergeUsbTiers(liveState, rec, usbVolume{MountPath: card}, "efficient")
	if n != 0 || !stalled {
		t.Fatalf("converted=%d stalled=%v, want 0/true", n, stalled)
	}
	usbMu.Lock()
	held := usbLive["usb-t"].fullAtFree > 0
	usbMu.Unlock()
	if !held {
		t.Fatal("running out of room during conversion must put the device on hold")
	}
	if rec.LastError == "" {
		t.Fatal("the reason must be recorded for the device page")
	}
}

// tightUSB: a platform whose card has 1 MB free.
type tightUSB struct{}

func (tightUSB) listRemovableVolumes() ([]usbVolume, error) { return nil, nil }
func (tightUSB) freeBytes(string) int64                     { return 1 << 20 }
func (tightUSB) scrubFile(string)                           {}
