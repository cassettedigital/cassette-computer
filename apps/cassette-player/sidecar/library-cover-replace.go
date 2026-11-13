// The explicit "replace this album's cover" upload door (Phase 1 of manual
// album editing — cover art only; metadata fields like title/artist/year are
// a separate, later piece of work with its own tag-writer story, not touched
// here).
//
// Distinct from library-upload.go's track-upload door: this endpoint is
// scoped to a single album's FOLDER cover, resolves the album via an
// existing track id (reusing resolveTrackPath — the same resolution
// library-trash.go's Trash door uses), and — unlike every other cover-writing
// path in this codebase — is allowed to overwrite an existing cover, because
// it only runs on an explicit human "replace" click. See replaceFolderCover
// in cover-art.go for why that guarantee lives in a function of its own.

package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"path/filepath"
	"strings"
)

const maxCoverReplaceBytes = 15 << 20 // 15 MB — generous for a cropped cover image

// sniffImage reports whether head begins with a real JPEG/PNG/WebP/GIF
// signature. Mirrors sniffAudio's role in library-upload.go: reject a
// renamed non-image file before it's written anywhere.
func sniffImage(head []byte) bool {
	if len(head) >= 3 && head[0] == 0xFF && head[1] == 0xD8 && head[2] == 0xFF {
		return true // JPEG
	}
	if len(head) >= 8 && string(head[:8]) == "\x89PNG\r\n\x1a\n" {
		return true // PNG
	}
	if len(head) >= 12 && string(head[:4]) == "RIFF" && string(head[8:12]) == "WEBP" {
		return true // WebP
	}
	if len(head) >= 6 && (string(head[:6]) == "GIF87a" || string(head[:6]) == "GIF89a") {
		return true // GIF
	}
	return false
}

// handleLibraryCoverReplace is POST /api/library/cover/replace?trackId=<id>
// with the raw (already cropped-to-square client-side) image bytes as body.
// trackId anchors the album — any track in the album resolves to the same
// containing directory, same as the GET cover proxy. Responds {"ok":true}
// on success, {"ok":false,"error":"..."} otherwise.
func handleLibraryCoverReplace(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "POST only"})
		return
	}
	trackID := strings.TrimSpace(r.URL.Query().Get("trackId"))
	if trackID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "trackId is required"})
		return
	}

	// No hint metadata for this door (unlike Trash, which has web-supplied
	// fallback fields) — if getSong can't resolve the track, we fail clearly
	// rather than guess a path for a write operation.
	trackPath, err := resolveTrackPath(trackID, trackHint{})
	if err != nil {
		log.Printf("cover-replace: resolveTrackPath(%q) failed: %v", trackID, err)
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "could not resolve album for this track"})
		return
	}
	albumDirPath := filepath.Dir(trackPath)
	if filepath.Clean(albumDirPath) == filepath.Clean(sidecarMusicDir) {
		// A song sitting loose in the music folder has no album folder; a cover
		// written here would belong to every loose song at once (BUG-787).
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "this song has no album folder of its own"})
		return
	}

	br := bufio.NewReaderSize(r.Body, 1<<16)
	head, _ := br.Peek(32)
	if !sniffImage(head) {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "not a valid image (failed magic-byte check)"})
		return
	}

	data, err := io.ReadAll(io.LimitReader(br, maxCoverReplaceBytes+1))
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "upload stream error"})
		return
	}
	if len(data) > maxCoverReplaceBytes {
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": fmt.Sprintf("exceeds %d MB size cap", maxCoverReplaceBytes>>20)})
		return
	}
	if len(data) == 0 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "empty file"})
		return
	}

	mime := http.DetectContentType(data)
	wrote, err := replaceFolderCover(albumDirPath, data, mime)
	if err != nil {
		log.Printf("cover-replace: replaceFolderCover(%q) failed: %v", albumDirPath, err)
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "could not write cover"})
		return
	}
	if !wrote {
		// writeFolderCover's own post-normalization decode check failed — rare
		// (the magic-byte sniff passed but the body wasn't a fully valid image).
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "image could not be processed"})
		return
	}

	log.Printf("cover-replace: replaced cover for %q (%d bytes)", albumDirPath, len(data))
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}
