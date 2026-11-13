// Inline naming of a just-ripped unknown album (JOB 5d).
//
// "Just rip it" lands the disc as unknown immediately; the panel then shows
// inline editable name fields. Whatever the user types is POSTed here and written
// to the LANDED FLAC tags — Navidrome displays tags (not filenames), so the
// library shows the real names without any risky file/folder renames. The
// needs-naming marker is cleared once names are applied.
//
// Safe to call during or after the rip: it re-tags whatever has landed and is
// re-submittable to catch tracks that land after an earlier submit. If the user
// leaves it blank it simply lands as unknown and the markers stand for the
// deferred library re-identify feature (out of scope here).

package main

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	flacvorbis "github.com/go-flac/flacvorbis/v2"
	flac "github.com/go-flac/go-flac/v2"
)

type nameOverride struct {
	Album       string `json:"album"`
	AlbumArtist string `json:"albumArtist"`
	Tracks      []struct {
		Position int    `json:"position"`
		Title    string `json:"title"`
		Artist   string `json:"artist"`
	} `json:"tracks"`
}

// handleRipName applies user-typed names to the landed (unknown) album.
func handleRipName(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var req nameOverride
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "bad request"})
		return
	}
	dir := loadRip().LandedDir
	if dir == "" {
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "Nothing to name yet."})
		return
	}
	applied := applyAlbumNames(dir, req)
	if applied > 0 {
		if err := triggerNavidromeScan(); err != nil {
			log.Printf("rip-name: rescan trigger failed: %v", err)
		}
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "applied": applied})
}

// trackNameOverride is one track's user-typed title/artist, keyed by position.
type trackNameOverride struct{ title, artist string }

// applyAlbumNames re-tags every landed FLAC in dir from the override; returns the
// number of files updated.
func applyAlbumNames(dir string, req nameOverride) int {
	byPos := map[int]trackNameOverride{}
	for _, t := range req.Tracks {
		byPos[t.Position] = trackNameOverride{strings.TrimSpace(t.Title), strings.TrimSpace(t.Artist)}
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		log.Printf("rip-name: read dir %q: %v", dir, err)
		return 0
	}
	applied := 0
	for _, e := range entries {
		if e.IsDir() || strings.ToLower(filepath.Ext(e.Name())) != ".flac" {
			continue
		}
		if updateFLACNames(filepath.Join(dir, e.Name()), req, byPos) {
			applied++
		}
	}
	return applied
}

// updateFLACNames rewrites ALBUM/ALBUMARTIST + the per-track TITLE/ARTIST from the
// override, clears CASSETTE_NEEDS_NAMING, and preserves all other tags. The track
// is matched by its TRACKNUMBER tag. Returns true if it wrote.
func updateFLACNames(path string, req nameOverride, byPos map[int]trackNameOverride) bool {
	f, err := parseFLACFile(path)
	if err != nil {
		log.Printf("rip-name: parse %q: %v", path, err)
		return false
	}
	defer f.Close()
	var cmt *flacvorbis.MetaDataBlockVorbisComment
	vcIdx := -1
	for i, block := range f.Meta {
		if block.Type == flac.VorbisComment {
			if parsed, perr := flacvorbis.ParseFromMetaDataBlock(*block); perr == nil {
				cmt, vcIdx = parsed, i
				break
			}
		}
	}
	if cmt == nil {
		return false
	}

	set := func(key, val string) {
		if val == "" {
			return
		}
		cmt = stripVorbisKey(cmt, key)
		_ = cmt.Add(key, val)
	}
	if a := strings.TrimSpace(req.Album); a != "" {
		set("ALBUM", a)
	}
	if aa := strings.TrimSpace(req.AlbumArtist); aa != "" {
		set("ALBUMARTIST", aa)
	}
	if ov, ok := byPos[vorbisInt(cmt, "TRACKNUMBER")]; ok {
		set("TITLE", ov.title)
		artist := ov.artist
		if artist == "" {
			artist = strings.TrimSpace(req.AlbumArtist)
		}
		set("ARTIST", artist)
	}
	// Names applied → drop the needs-naming marker (keep the local-album-id key).
	cmt = stripVorbisKey(cmt, "CASSETTE_NEEDS_NAMING")

	newBlock := cmt.Marshal()
	if vcIdx >= 0 {
		f.Meta[vcIdx] = &newBlock
	} else {
		f.Meta = append(f.Meta, &newBlock)
	}
	var buf bytes.Buffer
	if _, err := f.WriteTo(&buf); err != nil {
		log.Printf("rip-name: serialize %q: %v", path, err)
		return false
	}
	if err := atomicWriteFile(path, buf.Bytes(), 0o644); err != nil {
		log.Printf("rip-name: write %q: %v", path, err)
		return false
	}
	return true
}

func vorbisInt(cmt *flacvorbis.MetaDataBlockVorbisComment, key string) int {
	vals, err := cmt.Get(key)
	if err != nil || len(vals) == 0 {
		return 0
	}
	n, _ := strconv.Atoi(strings.TrimSpace(vals[0]))
	return n
}
