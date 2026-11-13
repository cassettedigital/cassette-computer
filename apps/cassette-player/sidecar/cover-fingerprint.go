package main

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Folder-cover CHANGE detection — the signal that lets a satellite notice a user
// swapped an album's art.
//
// The cloud versions an album's artwork by hashing its CLOUD artwork URLs. Swapping
// cover.jpg on this Mac moves no cloud URL, so a phone could never learn the art
// changed: it fetched the cover once and treated that as final, forever. This file
// supplies the missing half — a content fingerprint of each album's FOLDER cover,
// carried on the library-sync wire the sidecar already posts.
//
// HOW ALBUM FOLDERS ARE LOCATED. From the REAL absolute path Navidrome reports for
// each track (see librarySyncClientName — a dedicated client name is required,
// because report_real_path is stored per player row and the legacy row reports a
// tag-synthesized path whose directories often do not exist). Using real paths
// rather than parsing tags on disk means this works for EVERY audio format
// Navidrome indexes — ALAC, AAC, Opus, WAV — not just the two the sidecar's own tag
// reader understands, and the track→folder join is exact rather than a name match.
//
// WHY A CONTENT HASH AND NOT size+mtime. Our own cover writers rewrite atomically and
// bump mtime even when the bytes are identical; a size+mtime fingerprint would push a
// pointless fleet-wide refresh on every such rewrite. A content hash is idempotent
// under an identical rewrite, and it also catches the mtime-preserving edit (rsync
// --archive, in-place editors) that Navidrome's own folder hash misses — see
// needFullScan for how that case is escalated.
//
// We never modify anything here. This walk is strictly read-only: the user's library
// is theirs, and a change-detector has no business writing to it.

// coverObservation is the last-seen state of one album's folder cover. Persisted in
// SidecarState to decide whether Navidrome must be told to re-hash, and to let a pass
// skip re-reading bytes whose size and mtime are unchanged.
type coverObservation struct {
	Fingerprint string `json:"fingerprint"`
	Size        int64  `json:"size"`
	ModTimeUnix int64  `json:"modTimeUnix"`
}

// coverFullRehashInterval bounds how long the cheap size+mtime gate may be trusted.
// Past this, every cover is re-hashed in full so a mtime-preserving edit is still
// caught eventually rather than never.
const coverFullRehashInterval = 24 * time.Hour

// priorityCoverFiles returns EVERY cover-priority image in dir, sorted.
//
// Deliberately not "the winner": Navidrome resolves which candidate to serve by
// iterating a map, and Go randomizes map order, so the served file can differ between
// scans when a folder holds more than one candidate. Hashing all of them means the
// composite moves whenever ANY file Navidrome might pick changes.
func priorityCoverFiles(dir string) []string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var out []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		stem := strings.ToLower(strings.TrimSuffix(name, filepath.Ext(name)))
		if coverBaseNames[stem] {
			out = append(out, filepath.Join(dir, name))
		}
	}
	sort.Strings(out)
	return out
}

// statCoverFiles reports the combined size and newest mtime of the given files
// without reading their bytes — the cheap gate that lets an unchanged album skip
// hashing entirely.
func statCoverFiles(paths []string) (size int64, modUnix int64, ok bool) {
	for _, p := range paths {
		fi, err := os.Stat(p)
		if err != nil {
			continue
		}
		size += fi.Size()
		if m := fi.ModTime().Unix(); m > modUnix {
			modUnix = m
		}
		ok = true
	}
	return size, modUnix, ok
}

// hashCoverFiles fingerprints the given cover files by name + bytes.
//
// A read error fails the WHOLE set rather than silently hashing a truncated file: on a
// network mount a short read produces a different hash at identical size and mtime,
// which is exactly the pattern we treat as a mtime-preserving edit — that would
// escalate to a full Navidrome rescan and a fleet-wide re-pull for what is really just
// a flaky read.
func hashCoverFiles(paths []string) (fingerprint string, ok bool) {
	if len(paths) == 0 {
		return "", false
	}
	h := sha256.New()
	for _, p := range paths {
		f, err := os.Open(p)
		if err != nil {
			return "", false
		}
		_, _ = io.WriteString(h, filepath.Base(p))
		if _, copyErr := io.Copy(h, f); copyErr != nil {
			_ = f.Close()
			return "", false
		}
		_ = f.Close()
	}
	return hex.EncodeToString(h.Sum(nil))[:16], true
}

// withinMusicDir reports whether dir is inside the configured library root. Guards the
// multi-disc parent fallback: for a FLAT library an album dir IS the music root, and
// walking to its parent would read the user's home directory.
func withinMusicDir(dir string) bool {
	root, err := filepath.Abs(sidecarMusicDir)
	if err != nil {
		return false
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(root, abs)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// coverFilesForAlbum collects the cover candidates for an album spanning the given
// directories. A directory with no cover of its own falls back to its PARENT —
// Navidrome serves the common parent folder's cover for an album whose tracks live in
// CD1/CD2 subfolders, so a multi-disc album would otherwise be invisible.
func coverFilesForAlbum(dirs []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, dir := range dirs {
		files := priorityCoverFiles(dir)
		if len(files) == 0 {
			parent := filepath.Dir(dir)
			if parent != dir && withinMusicDir(parent) {
				files = priorityCoverFiles(parent)
			}
		}
		for _, f := range files {
			if !seen[f] {
				seen[f] = true
				out = append(out, f)
			}
		}
	}
	sort.Strings(out)
	return out
}

// albumFoldKey is the album identity shared with the cloud: folded artist + album,
// taken from the SAME Navidrome strings the cloud buckets on, so the two agree.
func albumFoldKey(artist, album string) string {
	return foldGroupText(artist) + "\x00" + foldGroupText(album)
}

// attachCoverFingerprints stamps every track with its album's folder-cover fingerprint
// and reports which album directories changed since the last sync.
//
// needFullScan is set when a change is one Navidrome's own folder hash CANNOT see: it
// hashes name+size+mtime, so identical size AND mtime with different bytes needs a FULL
// rescan. We escalate the scan rather than touching the user's file — an
// mtime-preserving rewrite is usually a backup tool deliberately preserving it, and
// "fixing" that by writing into their library would defeat their tooling.

// coverPassResult is one fingerprinting pass. Observations for CHANGED albums are
// held pending rather than recorded immediately: recording them before Navidrome has
// actually re-hashed the folder would let a device fetch Navidrome's cached OLD bytes
// and stamp the NEW fingerprint as applied, pinning that album to stale art forever.
// The caller commits only after a CONFIRMED idle rescan.
type coverPassResult struct {
	ChangedDirs  []string
	ChangedKeys  []string
	Pending      map[string]coverObservation
	NeedFullScan bool
}

// Commit records the pending observations. Call ONLY after a confirmed rescan.
func (r coverPassResult) Commit(state *SidecarState) {
	if state == nil {
		return
	}
	stateMu.Lock()
	defer stateMu.Unlock()
	if state.CoverObservations == nil {
		state.CoverObservations = map[string]coverObservation{}
	}
	for k, v := range r.Pending {
		state.CoverObservations[k] = v
	}
}

// WithholdChanged strips the fingerprint from tracks whose album changed this pass, so
// an unconfirmed rescan reports nothing new rather than something wrong. The next sync
// re-detects the same change and tries again.
func (r coverPassResult) WithholdChanged(tracks []librarySyncTrack) int {
	if len(r.ChangedKeys) == 0 {
		return 0
	}
	changed := make(map[string]bool, len(r.ChangedKeys))
	for _, k := range r.ChangedKeys {
		changed[k] = true
	}
	n := 0
	for i := range tracks {
		if changed[albumFoldKey(tracks[i].ArtistName, tracks[i].AlbumName)] {
			tracks[i].CoverFingerprint = nil
			n++
		}
	}
	return n
}

func attachCoverFingerprints(
	tracks []librarySyncTrack,
	state *SidecarState,
) coverPassResult {
	result := coverPassResult{Pending: map[string]coverObservation{}}
	var needFullScan bool
	if len(tracks) == 0 {
		return result
	}

	// 1. Group tracks by album identity, collecting each album's real directories.
	//    Both sides of this join come from Navidrome, so there is no tag-vs-index
	//    drift and no per-format limitation.
	dirsByAlbum := map[string]map[string]bool{}
	withPath := 0
	for _, t := range tracks {
		if t.Path == "" {
			continue
		}
		withPath++
		key := albumFoldKey(t.ArtistName, t.AlbumName)
		if dirsByAlbum[key] == nil {
			dirsByAlbum[key] = map[string]bool{}
		}
		dirsByAlbum[key][filepath.Dir(t.Path)] = true
	}
	if withPath == 0 {
		// Navidrome reported no usable paths at all — the dedicated client row is not
		// reporting real paths. Loud, because the whole feature is silently inert.
		log.Printf("cover-fp: NO track paths reported by Navidrome — cover change detection is INERT (check librarySyncClientName / ND_SUBSONIC_DEFAULTREPORTREALPATH)")
		return result
	}

	if state != nil && state.CoverObservations == nil {
		stateMu.Lock()
		state.CoverObservations = map[string]coverObservation{}
		stateMu.Unlock()
	}
	// Trust the cheap size+mtime gate only within the full-rehash window.
	fullRehash := true
	if state != nil && !state.CoverFullRehashAt.IsZero() {
		fullRehash = time.Since(state.CoverFullRehashAt) >= coverFullRehashInterval
	}

	// 2. Fingerprint each album, then stamp every track that belongs to it.
	fingerprintByAlbum := make(map[string]string, len(dirsByAlbum))
	changed := map[string]bool{}
	for key, dirSet := range dirsByAlbum {
		dirs := make([]string, 0, len(dirSet))
		for d := range dirSet {
			dirs = append(dirs, d)
		}
		sort.Strings(dirs)

		files := coverFilesForAlbum(dirs)
		if len(files) == 0 {
			continue // no cover on disk → UNKNOWN, never "removed"
		}
		size, modUnix, statOK := statCoverFiles(files)
		if !statOK {
			continue
		}

		var prev coverObservation
		var had bool
		if state != nil {
			prev, had = state.CoverObservations[key]
		}

		// Cheap path: nothing about size or mtime moved and we are inside the
		// full-rehash window, so reuse the known fingerprint without reading bytes.
		if had && !fullRehash && prev.Size == size && prev.ModTimeUnix == modUnix {
			fingerprintByAlbum[key] = prev.Fingerprint
			continue
		}

		fingerprint, ok := hashCoverFiles(files)
		if !ok {
			continue // unreadable → UNKNOWN this pass, retried next
		}
		fingerprintByAlbum[key] = fingerprint

		if had && prev.Fingerprint == fingerprint {
			continue
		}
		// A change Navidrome's own folder hash cannot see (same size AND mtime,
		// different bytes) needs a full rescan to register.
		if had && prev.Size == size && prev.ModTimeUnix == modUnix {
			needFullScan = true
		}
		// First observation counts as changed ON PURPOSE: it is the rollout path, and
		// the one moment we most need Navidrome to hold current bytes — staying quiet
		// here lets a phone fetch cached OLD art and stamp it as converged.
		for _, d := range dirs {
			changed[d] = true
		}
		result.ChangedKeys = append(result.ChangedKeys, key)
		result.Pending[key] = coverObservation{
			Fingerprint: fingerprint,
			Size:        size,
			ModTimeUnix: modUnix,
		}
	}

	stamped := 0
	for i := range tracks {
		fingerprint, ok := fingerprintByAlbum[albumFoldKey(tracks[i].ArtistName, tracks[i].AlbumName)]
		if !ok {
			continue
		}
		value := fingerprint
		tracks[i].CoverFingerprint = &value
		stamped++
	}

	if state != nil && fullRehash {
		state.CoverFullRehashAt = time.Now()
	}
	for dir := range changed {
		result.ChangedDirs = append(result.ChangedDirs, dir)
	}
	sort.Strings(result.ChangedDirs)
	result.NeedFullScan = needFullScan

	// Always report coverage, not just when something changed: an album that never
	// gets stamped is indistinguishable from the feature not running at all.
	log.Printf(
		"cover-fp: %d/%d tracks stamped across %d album(s), %d folder(s) changed (fullRehash=%v fullScan=%v)",
		stamped, len(tracks), len(fingerprintByAlbum), len(result.ChangedDirs), fullRehash, needFullScan,
	)
	return result
}
