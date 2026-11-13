// library-trash.go — POST /api/library/trash
//
// Moves audio files to the macOS Trash (recoverable in Finder).
//
// HARD RULE: this file must NEVER call os.Remove/os.RemoveAll/unlink on a
// user audio file. The ONLY permitted removal operation for audio files is
// trashFile() (trash_darwin.go), which uses Foundation NSFileManager
// -trashItemAtURL:resultingItemURL:error:. If a true Trash move cannot be
// performed, the file entry returns a failure — permanent deletion is never a
// fallback.
//
// os.Remove IS called — safely — only to remove now-EMPTY album or artist
// directories. os.Remove fails non-destructively on non-empty directories, so
// there is no risk of removing directories that still contain other files.
//
// Path resolution safety:
//   1. Path must be inside sidecarMusicDir (prefix check on cleaned absolute paths).
//   2. Path must exist on disk (existence check before trash).
//   3. Path must be absolute (enforced by filepath.Abs).
//   4. Symlinks are resolved to their real destination (filepath.EvalSymlinks)
//      and the destination is also checked against sidecarMusicDir.
// Any violation returns an error for that track. The batch never aborts.
//
// Real-path reporting (ND_SUBSONIC_DEFAULTREPORTREALPATH):
// Navidrome's getSong returns a real absolute path only when the player's
// ReportRealPath flag is set. The global default is controlled by the env var
// ND_SUBSONIC_DEFAULTREPORTREALPATH=true, which the sidecar inherits and
// passes through to the supervised Navidrome process (supervisor.go line 54:
// cmd.Env = os.Environ()). Set that env var in the .app launcher or
// docker-compose.yml to enable real-path reporting for all players. Without it
// getSong yields a sanitized relative path; this code falls back to
// filepath.Join(sidecarMusicDir, relativePath), which is safe but may miss
// tracks whose on-disk paths diverge from Navidrome's sanitized form. The
// existence check below makes a wrong path safe: it just returns an error for
// that track rather than trashing the wrong file.

package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// trackHint carries the caller-supplied metadata used as a fallback path
// derivation when getSong does not return a usable path. The hint is lossy
// (sanitizeFilename is not a round-trip) and covers only ripped FLAC files —
// it is NOT used for tracks from other sources.
type trackHint struct {
	AlbumArtist string
	Album       string
	Title       string
	TrackNumber int
}

// trashRequest is the JSON body of POST /api/library/trash.
type trashRequest struct {
	Tracks []trashTrackEntry `json:"tracks"`
}

type trashTrackEntry struct {
	SubsonicTrackID string `json:"subsonicTrackId"`
	AlbumArtist     string `json:"albumArtist"`
	Album           string `json:"album"`
	Title           string `json:"title"`
	TrackNumber     int    `json:"trackNumber"`
}

// trashResponse is the JSON response of POST /api/library/trash.
// ok is true whenever the request was processed (even if some tracks failed).
// The caller inspects "failed" for per-track errors.
type trashResponse struct {
	OK      bool              `json:"ok"`
	Trashed []string          `json:"trashed"`
	Failed  []trashFailure    `json:"failed"`
}

type trashFailure struct {
	SubsonicTrackID string `json:"subsonicTrackId"`
	Reason          string `json:"reason"`
}

// resolveTrackPath maps a Subsonic track id (plus fallback hint metadata) to
// a real absolute path under sidecarMusicDir that is safe to trash.
//
// Resolution order:
//  1. Call Subsonic getSong for the id, read the "path" field.
//  2. If path is absolute → use it; else → join with sidecarMusicDir.
//  3. Apply safety checks: absolute+clean, inside musicDir, file exists.
//  4. Fallback (only when getSong yields no path): derive path from hint
//     metadata using sanitizeFilename + the rip convention
//     (<artist>/<album>/<NN> - <title>.flac). Same safety checks apply.
//
// Returns the cleaned absolute path, or a non-nil error.
func resolveTrackPath(subsonicTrackID string, hint trackHint) (string, error) {
	// Attempt getSong resolution first.
	songPath, err := getSongPath(subsonicTrackID)
	if err != nil {
		log.Printf("library-trash: getSong(%q) failed: %v — trying hint fallback", subsonicTrackID, err)
	}

	if songPath != "" {
		candidate := songPath
		if !filepath.IsAbs(candidate) {
			// Navidrome returns a relative path when player.report_real_path is 0
			// (the per-client default). LaunchServices launches the .app with CWD=/,
			// so filepath.Abs of a relative path would yield "/Eve 6/…" — wrong.
			// Join explicitly onto sidecarMusicDir (confirmed absolute, not a symlink)
			// so the result is correct regardless of the process CWD.
			candidate = filepath.Join(sidecarMusicDir, candidate)
		}
		resolved, resolveErr := safeResolvePath(candidate)
		if resolveErr == nil {
			return resolved, nil
		}
		log.Printf("library-trash: getSong path %q rejected: %v — trying hint fallback", candidate, resolveErr)
	}

	// Fallback: derive path from hint metadata (rip-only, lossy).
	// This only works for FLAC files ripped by this sidecar where the on-disk
	// path follows the sanitizeFilename convention exactly.
	if hint.AlbumArtist == "" || hint.Album == "" || hint.Title == "" {
		return "", fmt.Errorf("getSong returned no usable path and hint fields are incomplete (albumArtist/album/title required)")
	}
	// NOTE: folderName and sanitizeFilename are the functions albumDir/landedPath use in
	// rip.go, so the derived path matches the rip output exactly — for ripped files.
	// For files imported from external sources the path may not match.
	artist := folderName(hint.AlbumArtist)
	if artist == "" {
		artist = "Unknown Artist"
	}
	album := folderName(hint.Album)
	if album == "" {
		album = "Unknown Album"
	}
	trackTitle := sanitizeFilename(hint.Title)

	// The cloud does not send a track number, so hint.TrackNumber defaults to 0
	// → "00 - Title.flac" never matches. Instead, scan the album directory for any
	// entry whose name ends with " - <sanitizeFilename(title)>.flac" (any numeric
	// prefix). This matches regardless of the track number. We never trash a guessed
	// path — only a real, existing, under-musicDir file confirmed by safeResolvePath.
	albumDirPath := filepath.Join(sidecarMusicDir, artist, album)
	entries, readErr := os.ReadDir(albumDirPath)
	if readErr != nil {
		return "", fmt.Errorf("hint fallback: cannot read album dir %q: %v", albumDirPath, readErr)
	}
	suffix := " - " + trackTitle + ".flac"
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if strings.HasSuffix(name, suffix) {
			candidate := filepath.Join(albumDirPath, name)
			resolved, resolveErr := safeResolvePath(candidate)
			if resolveErr == nil {
				log.Printf("library-trash: hint fallback matched %q via dir scan", name)
				return resolved, nil
			}
			log.Printf("library-trash: hint fallback candidate %q rejected: %v", candidate, resolveErr)
		}
	}
	return "", fmt.Errorf("hint fallback: no file ending with %q found in %q", suffix, albumDirPath)
}

// getSongPath calls Subsonic getSong and returns the path field.
// Returns ("", nil) if the response was valid but path is empty.
// Returns ("", err) on HTTP/decode failure.
func getSongPath(trackID string) (string, error) {
	// A satellite knows the song by its own id (satellite.go); the desk holds the main computer's.
	if satelliteOn.Load() {
		if trackID = localSongID(trackID); trackID == "" {
			return "", fmt.Errorf("that song isn't on this computer")
		}
	}
	client := &http.Client{Timeout: 10 * time.Second}
	// Real-path client: the default row reports a tag-synthesized path, which points
	// at a file that does not exist whenever tags and filenames differ.
	req, err := http.NewRequest(http.MethodGet, subsonicGetSongRealPathURL(trackID), nil)
	if err != nil {
		return "", fmt.Errorf("build request: %w", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("GET getSong: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("getSong HTTP %d", resp.StatusCode)
	}

	var body struct {
		Response struct {
			Status string `json:"status"`
			Error  *struct {
				Code    int    `json:"code"`
				Message string `json:"message"`
			} `json:"error,omitempty"`
			Song struct {
				Path string `json:"path"`
			} `json:"song"`
		} `json:"subsonic-response"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<17)).Decode(&body); err != nil {
		return "", fmt.Errorf("decode getSong response: %w", err)
	}
	if body.Response.Status != "ok" {
		if body.Response.Error != nil {
			return "", fmt.Errorf("Subsonic error %d: %s", body.Response.Error.Code, body.Response.Error.Message)
		}
		return "", fmt.Errorf("Subsonic status: %s", body.Response.Status)
	}
	return strings.TrimSpace(body.Response.Song.Path), nil
}

// safeResolvePath validates that path is (or resolves to) a real absolute path
// under sidecarMusicDir with an existing file. Returns the cleaned absolute
// path on success.
//
// Safety invariants enforced:
//  1. filepath.Abs: path becomes absolute (relative paths get joined to cwd).
//  2. filepath.Clean: normalises . / .. / double-slashes.
//  3. String prefix check against cleaned absolute sidecarMusicDir — rejects
//     any path traversal or path outside the music folder.
//  4. os.Stat: file must exist (prevents trashing already-gone or wrong paths).
//  5. filepath.EvalSymlinks: if the file is a symlink, resolve it and repeat
//     the prefix check on the real destination.
func safeResolvePath(path string) (string, error) {
	// 1+2: Make absolute and clean.
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("filepath.Abs: %w", err)
	}
	abs = filepath.Clean(abs)

	// Compute the cleaned absolute music dir once for comparison.
	musicDir, err := filepath.Abs(sidecarMusicDir)
	if err != nil {
		return "", fmt.Errorf("resolve musicDir: %w", err)
	}
	musicDir = filepath.Clean(musicDir)

	// 3: Prefix check — must be inside sidecarMusicDir.
	// Append separator so "/music-extra" does not match "/music".
	if !strings.HasPrefix(abs, musicDir+string(filepath.Separator)) {
		return "", fmt.Errorf("path %q is not inside music directory %q", abs, musicDir)
	}

	// 4: Must exist.
	if _, err := os.Stat(abs); err != nil {
		if os.IsNotExist(err) {
			return "", fmt.Errorf("file does not exist: %s", abs)
		}
		return "", fmt.Errorf("stat %q: %w", abs, err)
	}

	// 5: Resolve symlinks and repeat the prefix check on the real destination.
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", fmt.Errorf("EvalSymlinks %q: %w", abs, err)
	}
	real = filepath.Clean(real)
	if real != abs {
		// The file is a symlink — check the destination is also under musicDir.
		if !strings.HasPrefix(real, musicDir+string(filepath.Separator)) {
			return "", fmt.Errorf("symlink target %q is not inside music directory %q", real, musicDir)
		}
	}

	return abs, nil
}

// handleLibraryTrash is the POST /api/library/trash endpoint.
// It receives a JSON list of tracks (subsonicTrackId required; the rest are
// fallback hints), resolves each to an absolute path, moves it to the macOS
// Trash, and responds with a summary of successes and per-track failures.
//
// The batch never aborts on a single failure. ok is always true if the
// request could be processed; the caller inspects "failed" for errors.
func handleLibraryTrash(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writePlaybackJSON(w, http.StatusMethodNotAllowed, map[string]any{"ok": false, "error": "method not allowed"})
		return
	}

	var req trashRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		writePlaybackJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "invalid JSON body"})
		return
	}
	if len(req.Tracks) == 0 {
		writePlaybackJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "tracks is required and must be non-empty"})
		return
	}

	trashed := make([]string, 0, len(req.Tracks))
	failed := make([]trashFailure, 0)

	// Track the album-level directories we touched so we can attempt to remove
	// them if they become empty after trashing their files.
	dirsTouched := make(map[string]struct{})

	for _, track := range req.Tracks {
		id := strings.TrimSpace(track.SubsonicTrackID)
		if id == "" {
			failed = append(failed, trashFailure{SubsonicTrackID: id, Reason: "subsonicTrackId is required"})
			continue
		}
		if !isPlausibleTrackID(id) {
			failed = append(failed, trashFailure{SubsonicTrackID: id, Reason: "subsonicTrackId contains invalid characters"})
			continue
		}

		hint := trackHint{
			AlbumArtist: track.AlbumArtist,
			Album:       track.Album,
			Title:       track.Title,
			TrackNumber: track.TrackNumber,
		}

		absPath, err := resolveTrackPath(id, hint)
		if err != nil {
			log.Printf("library-trash: resolve %q failed: %v", id, err)
			failed = append(failed, trashFailure{SubsonicTrackID: id, Reason: fmt.Sprintf("path resolution failed: %v", err)})
			continue
		}

		if err := trashFile(absPath); err != nil {
			log.Printf("library-trash: trash %q (%s) failed: %v", id, absPath, err)
			failed = append(failed, trashFailure{SubsonicTrackID: id, Reason: fmt.Sprintf("trash failed: %v", err)})
			continue
		}

		log.Printf("library-trash: trashed %q → %s", id, absPath)
		trashed = append(trashed, id)

		// Record the album dir (parent of the file) and artist dir (grandparent)
		// for potential empty-dir cleanup below.
		albumDir := filepath.Dir(absPath)
		artistDir := filepath.Dir(albumDir)
		dirsTouched[albumDir] = struct{}{}
		dirsTouched[artistDir] = struct{}{}
	}

	// After all files are trashed, attempt to remove now-empty album and artist
	// directories inside sidecarMusicDir. os.Remove fails safely on non-empty
	// directories, so this is always non-destructive. We never use os.RemoveAll.
	if len(trashed) > 0 {
		musicDir, _ := filepath.Abs(sidecarMusicDir)
		musicDir = filepath.Clean(musicDir)
		for dir := range dirsTouched {
			// Only remove directories that are strictly inside musicDir (never
			// musicDir itself, and never anything outside it).
			if dir == musicDir {
				continue
			}
			if !strings.HasPrefix(dir, musicDir+string(filepath.Separator)) {
				continue
			}
			if err := os.Remove(dir); err == nil {
				log.Printf("library-trash: removed now-empty directory %s", dir)
			}
			// Non-nil error is expected and fine — directory not empty, or already gone.
		}
	}

	resp := trashResponse{
		OK:      true,
		Trashed: trashed,
		Failed:  failed,
	}
	writePlaybackJSON(w, http.StatusOK, map[string]any{
		"ok":      resp.OK,
		"trashed": resp.Trashed,
		"failed":  resp.Failed,
	})
}
