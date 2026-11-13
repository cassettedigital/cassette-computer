// The web-drop door (SPEC drag-and-drop, J2) — accept audio dropped in the
// browser and land it in the LOCAL music dir, then ingest it (J1). Audio lives on
// the Mac, never the cloud (storage model); the browser reaches this over the same
// PNA-gated local.cassette.digital channel the trash/playback flows use.
//
// Upload safety is non-negotiable (same discipline as library-trash.go):
//   1. Streaming multipart (MultipartReader) so an oversized part is rejected
//      mid-stream, never fully buffered to RAM or disk first.
//   2. Magic-byte sniff — real FLAC/MP3/MP4/AAC, not a renamed file with an
//      audio extension. (Extension must ALSO be in the allowlist.)
//   3. Per-file size cap.
//   4. Path-traversal guard — the relative path is sanitized (no .., no absolute,
//      no NUL) and the join is re-checked to stay under the music dir, with a
//      symlink-escape check on the destination directory (mirrors safeResolvePath,
//      adapted for a to-be-created file).
//
// FLAC, MP3, and (read-only) Apple's M4A/AAC. An M4A lands as-is and is never
// written to afterwards (see isReadOnlyAudio). A copy-protected iTunes file (.m4p,
// pre-2009) is turned away by name: nothing can play it outside Apple's apps.
// This file does NOT touch the accumulator.

package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const (
	maxUploadBytesPerFile = 400 << 20  // 400 MB — generous for hi-res FLAC, bounds abuse
	uploadSniffLen        = 12         // bytes peeked for magic detection (MP4 brand ends at 12)
)

// sniffMP4Audio reports whether head is an MP4 audio file ("ftyp" box) whose
// major brand is one Apple's audio files use. M4P (DRM) and video brands fail.
func sniffMP4Audio(head []byte) bool {
	if len(head) < 12 || string(head[4:8]) != "ftyp" {
		return false
	}
	switch string(head[8:12]) {
	case "M4A ", "M4B ", "mp42", "mp41", "isom", "iso2":
		return true
	}
	return false
}

// sniffADTS reports whether head begins with a raw AAC (ADTS) frame: 12-bit sync,
// layer bits 00. MP3 frame sync shares the first 11 bits, so this is the stricter
// check. An ID3 prefix (some .aac files carry one) is accepted too.
func sniffADTS(head []byte) bool {
	if len(head) >= 3 && string(head[:3]) == "ID3" {
		return true
	}
	return len(head) >= 2 && head[0] == 0xFF && head[1]&0xF6 == 0xF0
}

// sniffAudioFor checks the content against the extension. FLAC/MP3 keep the
// original, permissive sniff (either signature passes); the read-only formats must
// match their own, so a FLAC renamed .m4a is not filed as one.
func sniffAudioFor(ext string, head []byte) bool {
	switch ext {
	case ".m4a":
		return sniffMP4Audio(head)
	case ".aac":
		return sniffADTS(head)
	}
	return sniffAudio(head)
}

// sniffAudio reports whether head begins with a real FLAC or MP3 signature.
// FLAC: "fLaC". MP3: an "ID3" (ID3v2) tag, or a raw MPEG frame sync (0xFF Ex/Fx).
func sniffAudio(head []byte) bool {
	if len(head) >= 4 && string(head[:4]) == "fLaC" {
		return true
	}
	if len(head) >= 3 && string(head[:3]) == "ID3" {
		return true
	}
	if len(head) >= 2 && head[0] == 0xFF && head[1]&0xE0 == 0xE0 {
		return true
	}
	return false
}

// sanitizeRelPath turns a browser-supplied relative path into one that cannot
// escape the music dir. Roots it at "/" so filepath.Clean collapses any leading
// ".." (the standard safe-join trick), then strips the root. Rejects NUL and any
// surviving ".." component.
func sanitizeRelPath(rel string) (string, error) {
	if strings.ContainsRune(rel, 0) {
		return "", errors.New("null byte in path")
	}
	rel = strings.ReplaceAll(rel, "\\", "/") // normalize Windows separators
	rel = strings.TrimSpace(strings.TrimPrefix(rel, "/"))
	if rel == "" {
		return "", errors.New("empty path")
	}
	// Reject any traversal attempt outright (don't silently neutralize it).
	for _, part := range strings.Split(rel, "/") {
		if part == ".." {
			return "", errors.New("path traversal")
		}
	}
	clean := filepath.Clean(rel)
	if clean == "." || clean == "" || filepath.IsAbs(clean) || strings.HasPrefix(clean, "..") {
		return "", errors.New("invalid path")
	}
	return clean, nil
}

// safeUploadDest resolves a sanitized relative path to an absolute destination
// guaranteed under the music dir. Unlike safeResolvePath (which requires the file
// to exist), this is for a file about to be CREATED: it validates the join stays
// under the music dir, and once the destination directory exists, re-checks that
// directory through EvalSymlinks so a symlinked subdir cannot escape.
func safeUploadDest(relPath string) (dest string, err error) {
	musicDir, err := filepath.Abs(sidecarMusicDir)
	if err != nil {
		return "", fmt.Errorf("resolve musicDir: %w", err)
	}
	musicDir = filepath.Clean(musicDir)

	abs := filepath.Clean(filepath.Join(musicDir, relPath))
	if abs != musicDir && !strings.HasPrefix(abs, musicDir+string(filepath.Separator)) {
		return "", fmt.Errorf("destination %q escapes music dir", abs)
	}
	return abs, nil
}

// ensureDirUnderMusic makes the destination's parent dir and verifies (through
// symlinks) it is still inside the music dir.
func ensureDirUnderMusic(dest string) error {
	dir := filepath.Dir(dest)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("mkdir: %w", err)
	}
	musicDir, _ := filepath.Abs(sidecarMusicDir)
	// Resolve symlinks on BOTH sides so the comparison is canonical (e.g. macOS
	// symlinks /var → /private/var; a music dir under such a path must still match
	// its own resolved subdirs). This is stricter than safeResolvePath, which
	// compares against the un-resolved music dir.
	if resolved, err := filepath.EvalSymlinks(musicDir); err == nil {
		musicDir = resolved
	}
	musicDir = filepath.Clean(musicDir)
	real, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return fmt.Errorf("evalsymlinks dir: %w", err)
	}
	real = filepath.Clean(real)
	if real != musicDir && !strings.HasPrefix(real, musicDir+string(filepath.Separator)) {
		return fmt.Errorf("destination dir %q escapes music dir", real)
	}
	return nil
}

// handleLibraryUpload is POST /api/library/upload?path=<relPath> with the raw file
// bytes as the body (one file per request — simplest for streaming + per-file
// browser progress, and the relative path is explicit in the query rather than a
// filename Go would strip to its base). It validates + lands the file in the music
// dir and triggers an immediate ingest (J1, coalesced across an album's files).
func handleLibraryUpload(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "POST only"})
		return
	}
	rel, err := sanitizeRelPath(r.URL.Query().Get("path"))
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "invalid path: " + err.Error()})
		return
	}
	if reason := landUpload(rel, r.Body); reason != "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "path": rel, "error": reason})
		return
	}
	// Hand off to J1: index + identify + sync the just-dropped file now (the
	// trigger coalesces, so an album's worth of uploads collapses to ~one ingest).
	select {
	case ingestTrigger <- struct{}{}:
	default:
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "path": rel})
}

// landUpload validates + lands one file's bytes at the sanitized relPath. Returns
// "" on success, or a human reason on rejection. Never partially lands a file
// (temp + atomic rename); never overwrites an existing track.
func landUpload(rel string, body io.Reader) (reason string) {
	ext := strings.ToLower(filepath.Ext(rel))
	if !isLibraryAudio(rel) {
		if ext == ".m4p" {
			return "copy-protected iTunes file (.m4p) — only Apple's apps can play it"
		}
		return fmt.Sprintf("unsupported type %q — FLAC, MP3, M4A or AAC only", ext)
	}
	dest, err := safeUploadDest(rel)
	if err != nil {
		return "rejected destination: " + err.Error()
	}

	// Magic-byte sniff BEFORE writing the body — reject a renamed non-audio file
	// without streaming it to disk.
	br := bufio.NewReaderSize(body, 1<<16)
	head, _ := br.Peek(uploadSniffLen)
	if !sniffAudioFor(ext, head) {
		return fmt.Sprintf("not a valid %s file (failed magic-byte check)", strings.TrimPrefix(ext, "."))
	}

	if err := ensureDirUnderMusic(dest); err != nil {
		return "could not prepare destination: " + err.Error()
	}

	tmp, err := os.CreateTemp(filepath.Dir(dest), ".upload-*.part")
	if err != nil {
		return "could not create temp file: " + err.Error()
	}
	tmpName := tmp.Name()
	// Stream with a hard cap (+1 so we can detect "exceeds cap").
	n, copyErr := io.Copy(tmp, io.LimitReader(br, maxUploadBytesPerFile+1))
	syncErr := tmp.Sync()
	_ = tmp.Close()
	if copyErr != nil {
		_ = os.Remove(tmpName)
		return "upload stream error: " + copyErr.Error()
	}
	if syncErr != nil {
		_ = os.Remove(tmpName)
		return "could not flush file: " + syncErr.Error()
	}
	if n > maxUploadBytesPerFile {
		_ = os.Remove(tmpName)
		return fmt.Sprintf("exceeds %d MB size cap", maxUploadBytesPerFile>>20)
	}
	if n == 0 {
		_ = os.Remove(tmpName)
		return "empty file"
	}
	// Atomic move into place. Never overwrite an existing file (avoid clobbering
	// an owned track); if it exists, treat as already-present success.
	if _, statErr := os.Stat(dest); statErr == nil {
		_ = os.Remove(tmpName)
		log.Printf("upload: %q already exists — skipped", rel)
		return ""
	}
	if err := os.Rename(tmpName, dest); err != nil {
		_ = os.Remove(tmpName)
		return "could not finalize: " + err.Error()
	}
	log.Printf("upload: landed %q (%d bytes)", rel, n)
	return ""
}
