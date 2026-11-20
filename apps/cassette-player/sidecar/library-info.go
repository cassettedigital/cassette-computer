// library-info.go — browser-facing "This Mac" surface for the web dashboard.
//
// Two small, additive, read-mostly endpoints:
//
//   GET  /api/library/info    → { musicDir, storageBytes, version }
//   POST /api/library/reveal  → opens the library folder in Finder (macOS), or
//                               with {"songId","what":"song"|"record"} selects
//                               one song's file or its record's folder
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
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
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

// libraryRevealRequest is the optional JSON body of POST /api/library/reveal.
// An empty body (or no songId) opens the whole music folder, as before.
type libraryRevealRequest struct {
	SongID string `json:"songId"` // the song's Subsonic track id
	What   string `json:"what"`   // "song" (the default) or "record"
}

// errNotInLibrary is every way a song to show can fail to be a file in the music
// folder: unknown to Navidrome, gone from the disk, or outside the folder.
var errNotInLibrary = errors.New("not in the library")

// handleLibraryReveal shows the library in the computer's file manager. POST
// only. With no body it opens the whole music folder. With {"songId": "...",
// "what": "song"|"record"} it selects that song's file, or the folder that holds
// it, in Finder or File Explorer. We Start() the process (fire-and-forget) so the
// handler never blocks on the file manager; success means the command launched,
// not that a window is visible.
func handleLibraryReveal(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "POST only"})
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 4096))
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "could not read the request"})
		return
	}
	var req libraryRevealRequest
	if len(bytes.TrimSpace(body)) > 0 {
		if err := json.Unmarshal(body, &req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "invalid JSON body"})
			return
		}
	}
	if id := strings.TrimSpace(req.SongID); id != "" {
		revealSong(w, id, req.What)
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

// revealSong selects one song's file ("song") or the folder that holds it
// ("record") in the file manager. The file must really be inside the music
// folder, links followed; anything else answers 404 "not in the library".
func revealSong(w http.ResponseWriter, songID, what string) {
	what = strings.TrimSpace(what)
	if what == "" {
		what = "song"
	}
	if what != "song" && what != "record" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": `what must be "song" or "record"`})
		return
	}
	if !isPlausibleTrackID(songID) {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "songId is not a song id"})
		return
	}
	file, musicDir, err := songFileInLibrary(songID)
	if err != nil {
		log.Printf("library-info: reveal %s %q refused: %v", what, songID, err)
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": errNotInLibrary.Error()})
		return
	}
	target := revealTarget(file, musicDir, what)
	cmd := revealInFileManager(target)
	if err := cmd.Start(); err != nil {
		log.Printf("library-info: reveal %s failed for %q: %v", what, target, err)
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "could not open the file manager"})
		return
	}
	// Reap the process whatever it says: Explorer exits 1 even when it worked.
	go func() { _ = cmd.Wait() }()
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

// songFileInLibrary finds a song's own file the way library-trash.go does: the
// path Navidrome reports for it (getSong on the real-path client), joined onto
// the music folder when it is relative. It returns that file with links followed,
// and the music folder with links followed, once the file is known to be inside.
func songFileInLibrary(songID string) (file, musicDir string, err error) {
	p, err := getSongPath(songID)
	if err != nil {
		return "", "", err
	}
	if p == "" {
		return "", "", errNotInLibrary
	}
	if !filepath.IsAbs(p) {
		p = filepath.Join(sidecarMusicDir, p)
	}
	return pathInsideLibrary(p, sidecarMusicDir)
}

// pathInsideLibrary cleans p, makes it absolute and follows its links, then
// requires the result to be strictly inside musicDir (its links followed too):
// a path outside, a "../" climb out, or a link inside the folder that points out
// of it are all refused. p must exist. It returns the real path of p and of
// musicDir. Both sides are followed so a music folder reached through a link
// (/tmp is /private/tmp on a Mac) still works.
func pathInsideLibrary(p, musicDir string) (realPath, realDir string, err error) {
	if musicDir == "" {
		return "", "", errNotInLibrary
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return "", "", err
	}
	realPath, err = filepath.EvalSymlinks(filepath.Clean(abs))
	if err != nil {
		return "", "", err
	}
	dirAbs, err := filepath.Abs(musicDir)
	if err != nil {
		return "", "", err
	}
	realDir, err = filepath.EvalSymlinks(filepath.Clean(dirAbs))
	if err != nil {
		return "", "", err
	}
	realPath, realDir = filepath.Clean(realPath), filepath.Clean(realDir)
	rel, err := filepath.Rel(realDir, realPath)
	if err != nil || rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) || filepath.IsAbs(rel) {
		return "", "", fmt.Errorf("%q is not inside %q: %w", realPath, realDir, errNotInLibrary)
	}
	return realPath, realDir, nil
}

// revealTarget is what to select: the song's file, or for "record" the folder
// that holds it, unless that folder is the music folder itself, when the file is
// the closest thing to the record there is.
func revealTarget(file, musicDir, what string) string {
	if what == "record" {
		if dir := filepath.Dir(file); filepath.Clean(dir) != filepath.Clean(musicDir) {
			return dir
		}
	}
	return file
}
