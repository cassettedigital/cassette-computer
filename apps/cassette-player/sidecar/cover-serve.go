// Fast folder-cover serving for the now-playing and library surfaces.
//
// handlePlaybackCover's original path makes TWO Navidrome round-trips per cover
// (resolveCoverArtID → getCoverArt) and leans on Navidrome's image pipeline to
// resize. For a fully local app that is the wrong cost: the album's cover is
// already a file on disk (cover.jpg, the source of truth every device reads), so
// we stream it straight from disk instead. That drops the getCoverArt hop and the
// resize entirely — which is what turns a beat of skeleton into an instant cover
// on the desktop app.
//
// This is a FAST PATH, not a replacement: when an album has no folder cover yet
// (unmatched, or the async materialize pass hasn't run) the caller falls back to
// the Navidrome proxy, which also covers that brief timing gap.

package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
)

// underMusicRoot reports whether dir is the music root or a directory inside it.
// On Windows the comparison is case-insensitive: NTFS is case-insensitive and
// Navidrome can report a path whose drive-letter (or any segment) casing differs
// from SIDECAR_MUSIC_DIR, which would otherwise make the write guard fail closed
// and silently refuse a legitimate folder-cover or artist-photo write.
func underMusicRoot(dir string) bool {
	root := filepath.Clean(sidecarMusicDir)
	d := filepath.Clean(dir)
	if runtime.GOOS == "windows" {
		root = strings.ToLower(root)
		d = strings.ToLower(d)
	}
	return d == root || strings.HasPrefix(d, root+string(filepath.Separator))
}

// coverPathCache memoizes trackID → the album's folder-cover path. The mapping is
// stable (a track's file location doesn't move), so after the first resolve every
// later request — a different requested size, a different surface, a reload past
// the browser cache — is a stat + file stream with NO Navidrome hop at all.
// Entries self-heal: a path that no longer exists (a cover replaced with a
// different extension, or an album moved) is dropped and re-resolved on next use.
var coverPathCache sync.Map // trackID(string) → coverPath(string)

// folderCoverPathForTrack returns the album folder-cover file for a track, using
// the cache when possible and otherwise one getSong lookup to locate the album
// directory. Returns "" when the album has no folder cover on disk yet — the
// signal for the caller to fall back to the Navidrome proxy.
func folderCoverPathForTrack(trackID string) string {
	if v, ok := coverPathCache.Load(trackID); ok {
		p := v.(string)
		if info, err := os.Stat(p); err == nil && !info.IsDir() {
			return p
		}
		coverPathCache.Delete(trackID) // stale — cover removed or its extension changed
	}
	dir, err := albumDirForTrack(trackID)
	if err != nil {
		return ""
	}
	cp := existingFolderCoverPath(dir)
	if cp == "" {
		return ""
	}
	coverPathCache.Store(trackID, cp)
	return cp
}

// albumDirForTrack returns the ALBUM folder for a track (one level up from the
// track file) — the parallel of artistDirForTrack. It takes getSong's reported
// real path, makes it absolute, and requires the directory to exist under the
// music root and to not be the library root itself.
func albumDirForTrack(trackID string) (string, error) {
	p, err := getSongPath(trackID)
	if err != nil || p == "" {
		return "", fmt.Errorf("getSong path unavailable: %v", err)
	}
	if !filepath.IsAbs(p) {
		p = filepath.Join(sidecarMusicDir, p)
	}
	dir := filepath.Dir(p) // {music}/{Artist}/{Album}/track → {Album}
	if !underMusicRoot(dir) {
		return "", fmt.Errorf("album dir %q outside music root", dir)
	}
	if filepath.Clean(dir) == filepath.Clean(sidecarMusicDir) {
		return "", fmt.Errorf("track %q sits directly in the library root", trackID)
	}
	if info, statErr := os.Stat(dir); statErr != nil || !info.IsDir() {
		return "", fmt.Errorf("album dir %q not a directory", dir)
	}
	return dir, nil
}

// serveFolderCover streams a folder cover straight from disk: the file itself when no size was asked or
// it already fits, otherwise the ladder size that holds the asked box (picture-ladder.go: 120, 240, 480,
// 800 or 1200 on the long side, made once on this computer and kept in the OS cache folder), so a tile
// never draws a 1000-3000px picture and every surface asks for the same few sizes.
// http.ServeContent fills Content-Length and Last-Modified and answers conditional requests. Returns
// false (having written nothing) when the file can't be opened, so the caller can fall back to Navidrome.
//
// Cache-Control (coverCacheControl): an address that names the cover it shows (cv=, BUG-920) is kept for
// good, so the window never asks for that cover again; one without a version is kept an hour, as before
// (a replace made in the app also changes the address, lib/local-cover-epoch v=).
func serveFolderCover(w http.ResponseWriter, r *http.Request, coverPath string, size int) bool {
	f, err := os.Open(coverPath)
	if err != nil {
		return false
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.IsDir() {
		return false
	}
	w.Header().Set("Cache-Control", coverCacheControl(coverVersionParam(r), filepath.Dir(coverPath)))
	if made, ct := ladderCopy(coverPath, info, ladderRung(size)); made != "" {
		if t, err := os.Open(made); err == nil {
			defer t.Close()
			w.Header().Set("Content-Type", ct)
			http.ServeContent(w, r, "", info.ModTime(), t)
			return true
		}
	}
	http.ServeContent(w, r, filepath.Base(coverPath), info.ModTime(), f)
	return true
}

// ─── The cover's version in its address (BUG-920) ─────────────────────────────
//
// The window draws a record's cover from /api/playback/cover?trackId=…, an address that stays the same
// when the picture in the folder changes, so it could only be kept an hour, and every cover was asked for
// again after that. The version is the album's folder-cover fingerprint: the one the library sync already
// sends the cloud for every song (cover-fingerprint.go), which the web reads with the library and puts in
// the address as cv=. The web cannot see the file's own time, and the fingerprint is better anyway: the
// hub's writers rewrite identical bytes with a new time, which would change the address for nothing.
//
// The version is checked here before the cover is promised as unchanging. The cloud learns a new cover
// at the next library sync (moments after a change, the watcher starts one), so for that while the web
// still asks by the old version: that answer is the new picture, revalidated on every ask, never kept.
// A record whose songs sit in several folders carries one fingerprint for all of them, which a single
// folder's never equals: those are revalidated every time too (correct, just not kept).

const (
	coverCacheUnversioned = "private, max-age=3600"
	coverCacheForGood     = "private, max-age=31536000, immutable"
	coverCacheRevalidate  = "no-cache"
)

// coverVersionParam is the address's cv=: lowercase hex fingerprints, comma-joined when the cloud's record
// spans several (lib/dashboard/local-cover-version.ts). Anything else is no version.
func coverVersionParam(r *http.Request) string {
	v := strings.TrimSpace(r.URL.Query().Get("cv"))
	if v == "" || len(v) > 256 {
		return ""
	}
	for _, c := range v {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c == ',') {
			return ""
		}
	}
	return v
}

// coverCacheControl: kept for good when the address names the cover in dir now, kept an hour when it
// names none, and asked again every time when it names another (the cloud hasn't heard of the change yet).
func coverCacheControl(version, dir string) string {
	if version == "" {
		return coverCacheUnversioned
	}
	if now := folderCoverVersion(dir); now != "" {
		for _, v := range strings.Split(version, ",") {
			if v == now {
				return coverCacheForGood
			}
		}
	}
	return coverCacheRevalidate
}

// coverVersionMemo is one folder's fingerprint and the cover files it was read from (name, size, time),
// so a folder is hashed again only when one of its covers moved.
type coverVersionMemo struct {
	stamp       string
	fingerprint string
}

var coverVersionCache sync.Map // album dir → coverVersionMemo

// folderCoverVersion is the fingerprint the library sync sends for the album in dir (the same files,
// coverFilesForAlbum, and the same hash, hashCoverFiles). "" when dir has no cover or one can't be read.
func folderCoverVersion(dir string) string {
	files := coverFilesForAlbum([]string{dir})
	if len(files) == 0 {
		return ""
	}
	var stamp strings.Builder
	for _, p := range files {
		info, err := os.Stat(p)
		if err != nil {
			return ""
		}
		fmt.Fprintf(&stamp, "%s|%d|%d\x00", p, info.Size(), info.ModTime().UnixNano())
	}
	if v, ok := coverVersionCache.Load(dir); ok {
		if m := v.(coverVersionMemo); m.stamp == stamp.String() {
			return m.fingerprint
		}
	}
	fp, ok := hashCoverFiles(files)
	if !ok {
		return ""
	}
	coverVersionCache.Store(dir, coverVersionMemo{stamp: stamp.String(), fingerprint: fp})
	return fp
}

// navidromeCoverETag names one picture Navidrome answered: its art id, the size asked, and its
// Last-Modified (the art's last change, the same date Navidrome keys its own image cache on, so this
// is as fresh as Navidrome itself). "" without a real date (missing, unreadable, or Navidrome's zero
// time), so a doubt always sends the picture.
func navidromeCoverETag(coverID string, rung int, lastModified string) string {
	art, err := http.ParseTime(lastModified)
	if err != nil || art.Year() < 2000 {
		return ""
	}
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s|%d|%d", coverID, rung, art.Unix())))
	return `"nd-` + hex.EncodeToString(sum[:8]) + `"`
}

// etagListed reports whether an If-None-Match header lists tag (or "*"), weak or strong.
func etagListed(ifNoneMatch, tag string) bool {
	for _, t := range strings.Split(ifNoneMatch, ",") {
		t = strings.TrimPrefix(strings.TrimSpace(t), "W/")
		if t == "*" || t == tag {
			return true
		}
	}
	return false
}
