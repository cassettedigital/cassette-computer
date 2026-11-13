// The explicit "replace this artist's local photo" upload door — the same
// shape as library-cover-replace.go's album-cover door, one folder level up.
//
// "Just for my library": this writes a local cache file only, at
// {artist folder}/artist.<ext>. It is NOT the catalog-wide artist_images
// table (that stays shared/public) — a personal photo pick is layered on top
// via the web app's own per-user override (see the display-override pattern
// in lib/dashboard/album-display-override.ts), which is what actually drives
// web/cross-device rendering. This local write exists purely so the same
// photo is available offline / from the sidecar's own cover-style proxy,
// mirroring how a replaced album cover behaves.
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
)

// handleLibraryArtistPhotoReplace is POST /api/library/artist-photo/replace?trackId=<id>
// with the raw (already cropped-to-square client-side) image bytes as body.
// trackId anchors the artist folder: the library's on-disk layout is
// {musicRoot}/{Artist}/{Album}/track.ext, so the artist folder is two
// directory levels above the resolved track path (one level above the album
// folder library-cover-replace.go targets), or the album folder for a flat
// album (artistDirForPath). Responds {"ok":true} on success,
// {"ok":false,"error":"..."} otherwise — same envelope as cover/replace.
func handleLibraryArtistPhotoReplace(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "POST only"})
		return
	}
	trackID := r.URL.Query().Get("trackId")
	if trackID == "" {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "trackId is required"})
		return
	}

	trackPath, err := resolveTrackPath(trackID, trackHint{})
	if err != nil {
		log.Printf("artist-photo-replace: resolveTrackPath(%q) failed: %v", trackID, err)
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "could not resolve artist for this track"})
		return
	}
	artistDirPath, err := artistDirForPath(trackPath) // never the library root or above it (BUG-787)
	if err != nil {
		log.Printf("artist-photo-replace: %v", err)
		w.WriteHeader(http.StatusNotFound)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "this song has no artist folder of its own"})
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
	wrote, err := replaceArtistFolderPhoto(artistDirPath, data, mime)
	if err != nil {
		log.Printf("artist-photo-replace: replaceArtistFolderPhoto(%q) failed: %v", artistDirPath, err)
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "could not write artist photo"})
		return
	}
	if !wrote {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "image could not be processed"})
		return
	}

	log.Printf("artist-photo-replace: replaced artist photo for %q (%d bytes)", artistDirPath, len(data))
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}
