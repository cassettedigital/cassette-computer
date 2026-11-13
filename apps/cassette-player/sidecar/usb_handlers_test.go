package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// fakeUSB stands in for the OS: whatever volumes the test says are plugged in.
type fakeUSB struct{ vols []usbVolume }

func (f fakeUSB) listRemovableVolumes() ([]usbVolume, error) { return f.vols, nil }
func (f fakeUSB) freeBytes(string) int64                     { return 10 << 30 }
func (f fakeUSB) scrubFile(string)                           {}

func withFakeUSB(t *testing.T, vols []usbVolume) {
	t.Helper()
	usbPasses.Wait() // never swap the globals under a pass an earlier tick launched
	oldOS, oldState, oldData := usbOS, liveState, sidecarDataDir
	usbOS = fakeUSB{vols: vols}
	sidecarDataDir = t.TempDir()
	liveState = &SidecarState{}
	usbMu.Lock()
	usbLive = map[string]*usbLiveState{}
	usbMu.Unlock()
	t.Cleanup(func() {
		usbPasses.Wait()
		usbOS, liveState, sidecarDataDir = oldOS, oldState, oldData
		usbMu.Lock()
		usbLive = map[string]*usbLiveState{}
		usbMu.Unlock()
	})
}

func usbPostJSON(t *testing.T, h http.HandlerFunc, path string, body any) (int, map[string]any) {
	t.Helper()
	b, _ := json.Marshal(body)
	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodPost, path, bytes.NewReader(b)))
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func usbGetJSON(t *testing.T, h http.HandlerFunc, path string) (int, map[string]any) {
	t.Helper()
	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodGet, path, nil))
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out
}

func TestUsbAddOnlyAcceptsAPluggedInWritableVolume(t *testing.T) {
	card := t.TempDir()
	locked := t.TempDir()
	withFakeUSB(t, []usbVolume{
		{MountPath: card, Name: "ECHO MINI", Filesystem: "ExFAT", Writable: true},
		{MountPath: locked, Name: "LOCKED", Writable: false},
	})

	// A path the OS does not list as removable is refused, whatever it is.
	code, out := usbPostJSON(t, handleUsbAdd, "/api/usb/add", map[string]any{"mountPath": t.TempDir()})
	if code != http.StatusBadRequest || out["ok"] != false {
		t.Fatalf("stranger path accepted: %d %v", code, out)
	}
	// A read-only card is listed but never added.
	code, out = usbPostJSON(t, handleUsbAdd, "/api/usb/add", map[string]any{"mountPath": locked})
	if code != http.StatusBadRequest {
		t.Fatalf("read-only card accepted: %d %v", code, out)
	}
	if _, err := os.Stat(usbMarkerPath(locked)); !os.IsNotExist(err) {
		t.Fatal("a refused add must not write a marker")
	}

	// The real card: marker written, state recorded, id minted with the prefix.
	code, out = usbPostJSON(t, handleUsbAdd, "/api/usb/add", map[string]any{"mountPath": card})
	if code != http.StatusOK || out["ok"] != true {
		t.Fatalf("add failed: %d %v", code, out)
	}
	id, _ := out["deviceId"].(string)
	if len(id) <= len(usbDeviceIDPrefix) || id[:len(usbDeviceIDPrefix)] != usbDeviceIDPrefix {
		t.Fatalf("device id %q lacks the usb- prefix", id)
	}
	if out["label"] != "ECHO MINI" {
		t.Fatalf("label = %v", out["label"])
	}
	// Not paired to the cloud in this test, so registration is reported honestly.
	if out["cloud"] != false {
		t.Fatalf("cloud = %v, want false when the hub isn't paired", out["cloud"])
	}
	m, err := readUsbMarker(card)
	if err != nil || m == nil || m.DeviceID != id {
		t.Fatalf("marker after add: %+v %v", m, err)
	}
	if usbRecord(liveState, id) == nil {
		t.Fatal("state must remember the added device")
	}
	if _, err := os.Stat(filepath.Join(sidecarDataDir, "sidecar.json")); err != nil {
		t.Fatal("state must be persisted on add")
	}

	// Listing now reports the card as known; the locked one as a stranger.
	code, out = usbGetJSON(t, handleUsbVolumes, "/api/usb/volumes")
	if code != http.StatusOK {
		t.Fatalf("volumes → %d", code)
	}
	vols, _ := out["volumes"].([]any)
	if len(vols) != 2 {
		t.Fatalf("volumes = %v", out["volumes"])
	}
	first, _ := vols[0].(map[string]any)
	known, _ := first["known"].(map[string]any)
	if known == nil || known["deviceId"] != id || known["paused"] != false {
		t.Fatalf("card not reported as known: %v", first)
	}
	second, _ := vols[1].(map[string]any)
	if _, has := second["known"]; has {
		t.Fatalf("locked card must not be known: %v", second)
	}

	// Adding the same card again re-adopts the same id (the cloud row is reused).
	code, out = usbPostJSON(t, handleUsbAdd, "/api/usb/add", map[string]any{"mountPath": card, "label": "Pocket"})
	if code != http.StatusOK || out["deviceId"] != id || out["label"] != "Pocket" {
		t.Fatalf("re-add: %d %v", code, out)
	}

	// Pause flips and persists; forget drops the marker and the record.
	code, out = usbPostJSON(t, handleUsbPause, "/api/usb/pause", map[string]any{"deviceId": id, "paused": true})
	if code != http.StatusOK || out["paused"] != true || !usbRecord(liveState, id).Paused {
		t.Fatalf("pause: %d %v", code, out)
	}
	usbTick(liveState) // the watcher sees the card as mounted
	usbPasses.Wait()
	code, out = usbPostJSON(t, handleUsbForget, "/api/usb/forget", map[string]any{"deviceId": id})
	if code != http.StatusOK || out["forgotten"] != true {
		t.Fatalf("forget: %d %v", code, out)
	}
	if usbRecord(liveState, id) != nil {
		t.Fatal("forget must drop the record")
	}
	if _, err := os.Stat(usbMarkerPath(card)); !os.IsNotExist(err) {
		t.Fatal("forget must remove the marker when the card is mounted")
	}
	// Forget never touches the music or manifest folder itself.
	if _, err := os.Stat(usbFolder(card)); err != nil {
		t.Fatal("forget must leave the Cassette folder (the person's music) alone")
	}
}

func TestUsbTickIgnoresStrangersAndForeignMarkers(t *testing.T) {
	stranger := t.TempDir()
	foreign := t.TempDir()
	if err := writeUsbMarker(foreign, usbMarker{DeviceID: "usb-from-another-hub", Label: "X"}); err != nil {
		t.Fatal(err)
	}
	withFakeUSB(t, []usbVolume{
		{MountPath: stranger, Name: "NEW CARD", Writable: true},
		{MountPath: foreign, Name: "OLD CARD", Writable: true},
	})
	usbTick(liveState)
	usbPasses.Wait()
	usbMu.Lock()
	n := len(usbLive)
	usbMu.Unlock()
	if n != 0 {
		t.Fatalf("the watcher must not track %d unadded volumes", n)
	}
	if _, err := os.Stat(usbFolder(stranger)); !os.IsNotExist(err) {
		t.Fatal("a stranger volume must never be written to")
	}
	// The pane sees the foreign marker for what it is.
	_, out := usbGetJSON(t, handleUsbVolumes, "/api/usb/volumes")
	vols, _ := out["volumes"].([]any)
	second, _ := vols[1].(map[string]any)
	if second["markerForeign"] != true {
		t.Fatalf("foreign marker not flagged: %v", second)
	}
}

func TestUsbTickSkipsPausedDevices(t *testing.T) {
	card := t.TempDir()
	withFakeUSB(t, []usbVolume{{MountPath: card, Name: "ECHO MINI", Writable: true}})
	if err := writeUsbMarker(card, usbMarker{DeviceID: "usb-1", Label: "ECHO MINI"}); err != nil {
		t.Fatal(err)
	}
	liveState.UsbDevices = map[string]*usbDeviceRecord{"usb-1": {DeviceID: "usb-1", Label: "ECHO MINI", Paused: true}}
	usbTick(liveState)
	usbMu.Lock()
	live := usbLive["usb-1"]
	usbMu.Unlock()
	if live == nil || !live.Mounted {
		t.Fatal("an added, plugged-in device is tracked as mounted even when paused")
	}
	if live.Syncing {
		t.Fatal("a paused device must not start a sync pass")
	}
}
