package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// An instruction left "syncing" by an interrupted pass comes back in the queue,
// ahead of newer pending ones, so the album finishes on the next pass.
func TestUsbFetchPendingIntentsResumesInterruptedOnes(t *testing.T) {
	oldBase, oldState := cassetteBase, liveState
	t.Cleanup(func() { cassetteBase, liveState = oldBase, oldState })
	cloud := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Query().Get("state") {
		case "syncing":
			_ = json.NewEncoder(w).Encode(map[string]any{"intents": []map[string]any{
				{"id": "s1", "target_device_id": "usb-1", "state": "syncing", "intent_kind": "add", "created_at": "2026-09-15T10:00:00Z"},
				{"id": "other", "target_device_id": "phone", "state": "syncing", "intent_kind": "add", "created_at": "2026-09-15T09:00:00Z"},
			}})
		case "pending":
			_ = json.NewEncoder(w).Encode(map[string]any{"intents": []map[string]any{
				{"id": "p1", "target_device_id": "usb-1", "state": "pending", "intent_kind": "add", "created_at": "2026-09-15T11:00:00Z"},
			}})
		default:
			w.WriteHeader(http.StatusBadRequest)
		}
	}))
	defer cloud.Close()
	cassetteBase = cloud.URL
	liveState = &SidecarState{BearerToken: "tok"}

	got, err := usbFetchPendingIntents("usb-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].ID != "s1" || got[1].ID != "p1" {
		t.Fatalf("queue = %+v, want the interrupted s1 then pending p1", got)
	}
}

// A ".partial" left by a killed copy is swept once it has gone stale; a fresh
// one (a copy in progress) is left alone.
func TestUsbSweepDropsStalePartials(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "A", "B")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	stale := filepath.Join(dir, "01.mp3.partial")
	fresh := filepath.Join(dir, "02.mp3.partial")
	for _, p := range []string{stale, fresh} {
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	old := time.Now().Add(-usbStalePartialAge - time.Minute)
	if err := os.Chtimes(stale, old, old); err != nil {
		t.Fatal(err)
	}
	withFakeUSB(t, nil)
	usbSweepAppleDouble(root)
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatal("stale partial must be swept")
	}
	if _, err := os.Stat(fresh); err != nil {
		t.Fatal("a fresh partial (copy in progress) must be left alone")
	}
}
