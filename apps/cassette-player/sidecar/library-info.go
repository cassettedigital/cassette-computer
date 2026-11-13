// library-info.go — browser-facing "This Mac" surface for the web dashboard.
//
// Two small, additive, read-mostly endpoints:
//
//   GET  /api/library/info    → { musicDir, storageBytes, version }
//   POST /api/library/reveal  → opens the library folder in Finder (macOS)
//
// The desktop app's page calls these through its same-origin /sidecar route (a
// web dev server can, cross-origin, when a dev hub names it in
// SIDECAR_CORS_ORIGINS), so both are wrapped in corsMiddleware at registration
// (status-server.go).
//
// storageBytes is the on-disk footprint of the whole music library (every
// regular file under sidecarMusicDir, not just audio). Walking the tree is
// potentially expensive, so the result is cached for storageTTL and recomputed
// lazily on the first request after it goes stale. A walk error never fails the
// endpoint — we serve the best partial sum we managed to accumulate.

package main

import (
	"encoding/json"
	"io/fs"
	"log"
	"net/http"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"time"
)

// libraryInfoResponse is the JSON body of GET /api/library/info.
type libraryInfoResponse struct {
	MusicDir     string `json:"musicDir"`
	StorageBytes int64  `json:"storageBytes"`
	Version      string `json:"version"`
}

// storageTTL bounds how often the (potentially expensive) library walk runs.
// Within the TTL, cached bytes are served; after it, the next request recomputes.
const storageTTL = 60 * time.Second

var (
	storageMu         sync.Mutex
	storageCache      int64     // last computed footprint in bytes
	storageComputed   bool      // whether storageCache holds a real (non-zero-default) value
	storageComputedAt time.Time // when storageCache was last refreshed
)

// libraryStorageBytes returns the total on-disk size of the music library,
// recomputing via a filepath.WalkDir only when the cached value is missing or
// older than storageTTL. Concurrency: the whole compute-or-serve is guarded by
// storageMu so a single walk runs at a time and callers within the TTL never
// trigger a redundant scan. On a walk error the best partial sum is cached and
// returned (the endpoint never fails just because the tree was unreadable).
func libraryStorageBytes() int64 {
	storageMu.Lock()
	defer storageMu.Unlock()

	if storageComputed && time.Since(storageComputedAt) < storageTTL {
		return storageCache
	}

	var total int64
	walkErr := filepath.WalkDir(sidecarMusicDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			// Unreadable entry — skip it, keep accumulating the rest.
			return nil
		}
		if d.IsDir() || !d.Type().IsRegular() {
			return nil
		}
		info, ierr := d.Info()
		if ierr != nil {
			return nil
		}
		total += info.Size()
		return nil
	})
	if walkErr != nil {
		// Best partial sum: still cache + return what we accumulated.
		log.Printf("library-info: storage walk of %q returned %v (serving partial sum %d bytes)", sidecarMusicDir, walkErr, total)
	}

	storageCache = total
	storageComputed = true
	storageComputedAt = time.Now()
	return total
}

// handleLibraryInfo serves the library folder, its on-disk footprint, and the
// build version for the dashboard's "This Mac" page. GET only.
func handleLibraryInfo(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "GET only"})
		return
	}
	_ = json.NewEncoder(w).Encode(libraryInfoResponse{
		MusicDir:     sidecarMusicDir,
		StorageBytes: libraryStorageBytes(),
		Version:      buildVersion,
	})
}

// handleLibraryReveal opens the library folder in Finder (macOS `open`). POST
// only. We Start() the process (fire-and-forget) so the handler never blocks on
// Finder; success means the command launched, not that a window is visible.
func handleLibraryReveal(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "POST only"})
		return
	}
	// Open the library folder in the OS file manager. Per-OS command: Finder on
	// macOS, File Explorer on Windows, the default handler on Linux.
	var reveal *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		reveal = exec.Command("explorer", sidecarMusicDir)
	case "darwin":
		reveal = exec.Command("open", sidecarMusicDir)
	default:
		reveal = exec.Command("xdg-open", sidecarMusicDir)
	}
	if err := reveal.Start(); err != nil {
		log.Printf("library-info: reveal failed for %q: %v", sidecarMusicDir, err)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": err.Error()})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}
