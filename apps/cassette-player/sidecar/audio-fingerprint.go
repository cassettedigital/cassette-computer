package main

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Per-track CONTENT change detection — the audio-file sibling of
// cover-fingerprint.go.
//
// cassette_local_id (CassetteLocalIDFromSeconds) is deliberately content-blind —
// artist + title + duration-rounded-to-the-second — because its job is letting a
// phone recognize the SAME song across devices, not detecting freshness. A re-rip
// that fixes an audio-quality issue keeps the same title and the same rounded
// duration, so the identity is unchanged, and a phone that already has the track
// concludes "already have it" forever, no matter what changed in the actual
// bytes. This file supplies the missing signal: a content fingerprint of each
// track's own file, carried on the same library-sync wire cover-fingerprint.go
// already uses for album art.
//
// UNLIKE the cover case, no "wait for a confirmed Navidrome rescan" dance is
// needed here. Cover-fingerprint.go's complexity exists because Navidrome caches
// WHICH bytes to serve for an album's artwork, keyed by a folder rescan; a phone
// could fetch that cache before it caught up. A track's audio is not cached that
// way — Navidrome serves a track's file straight from the path it already has on
// record, so a re-ripped file that overwrote its old path in place (see rip.go's
// moveFile, an atomic os.Rename onto the same destination) is authoritative for
// playback the instant the rename completes. We hash the exact path Navidrome
// itself reports for the track (t.Path), so there is no possibility of hashing
// something Navidrome doesn't yet know about, and nothing to confirm.
//
// We never modify anything here. This is strictly read-only: the user's library
// is theirs, and a change-detector has no business writing to it.

// trackObservation is the last-seen state of one track's file. Persisted in
// SidecarState so an unchanged file can skip re-reading its bytes.
type trackObservation struct {
	Fingerprint string `json:"fingerprint"`
	Size        int64  `json:"size"`
	ModTimeUnix int64  `json:"modTimeUnix"`
	// HashedAtUnix is when the bytes were last read. 0 (older records) counts as
	// due for a re-check.
	HashedAtUnix int64 `json:"hashedAtUnix,omitempty"`
}

// audioHashBudget caps the time one sync spends reading song files (BUG-789).
// Reading every file of a big library took hours on the first sync, inside the
// sync lock, before the library reached the cloud. Now each sync reads what it
// can in this window, new and changed songs first, and the rest carry on next
// time; a song not reached yet goes up with no fingerprint, and the cloud keeps
// whatever it already had for it.
const audioHashBudget = 3 * time.Minute

// audioFullRehashInterval bounds how long the cheap size+mtime gate is trusted
// before a track's bytes are re-read, the same shape as
// coverFullRehashInterval. Set far longer than the cover interval on purpose:
// audio files run tens of megabytes each where covers run kilobytes, so a full
// pass over a real library is proportionally much more disk I/O — and the edge
// case the escalation exists for (a same-size, same-mtime, different-bytes edit)
// is far less likely for audio, since this app's own re-rip path always produces
// a fresh mtime. A week's staleness on that rare edge case is an acceptable
// trade for not re-reading someone's entire library every day.
const audioFullRehashInterval = 7 * 24 * time.Hour

// How a fingerprint was measured, written before it (BUG-882). The hub's own MusicBrainz ID write changes a song's
// tags, and a fingerprint over the whole file then read as a changed song: the iPhone deleted its copy. Now only
// the audio is measured where the format lets us find it, so a tag edit no longer moves the fingerprint.
//   a1: the audio alone (FLAC frames, MP3 frames, an MP4's media data), tags left out
//   f1: the whole file (any other format, or one that wouldn't parse)
// Fingerprints from before have no kind. A phone (iOS 028da529 on) and the USB sync take a fingerprint whose
// kind differs from the one they hold as the same song measured a new way, never as a change.
const (
	audioOnlyKind = "a1:"
	wholeFileKind = "f1:"
)

// fingerprintKind is the part of a fingerprint before its colon, or "" for one from before kinds.
func fingerprintKind(fp string) string {
	if i := strings.IndexByte(fp, ':'); i > 0 {
		return fp[:i]
	}
	return ""
}

// currentKind reports whether fp was measured the way this hub measures now.
func currentKind(fp string) bool {
	return strings.HasPrefix(fp, audioOnlyKind) || strings.HasPrefix(fp, wholeFileKind)
}

// hashTrackFile fingerprints a track's audio (unlike covers, there's only ever one file per track — no
// name-prefix needed to disambiguate multiple candidates in a folder).
func hashTrackFile(path string) (fingerprint string, ok bool) {
	f, err := os.Open(path)
	if err != nil {
		return "", false
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		return "", false
	}
	kind := audioOnlyKind
	start, end, found := audioSpan(f, fi.Size(), strings.ToLower(filepath.Ext(path)))
	if !found {
		kind, start, end = wholeFileKind, 0, fi.Size()
	}
	if _, err := f.Seek(start, io.SeekStart); err != nil {
		return "", false
	}
	h := sha256.New()
	if _, err := io.CopyN(h, f, end-start); err != nil {
		return "", false
	}
	return kind + hex.EncodeToString(h.Sum(nil))[:16], true
}

// audioSpan finds where a file's audio lies, tags excluded: [start, end). False when the format isn't one we can
// read this way, or the file doesn't parse; the caller then measures the whole file.
func audioSpan(f io.ReadSeeker, size int64, ext string) (start, end int64, ok bool) {
	read := func(at int64, n int) []byte {
		if at < 0 || at+int64(n) > size {
			return nil
		}
		b := make([]byte, n)
		if _, err := f.Seek(at, io.SeekStart); err != nil {
			return nil
		}
		if _, err := io.ReadFull(f, b); err != nil {
			return nil
		}
		return b
	}
	// ID3v2 tags (MP3s, and some FLACs, carry them in front), one after another.
	skipID3 := func(at int64) int64 {
		for {
			h := read(at, 10)
			if h == nil || string(h[:3]) != "ID3" {
				return at
			}
			n := int64(h[6]&0x7f)<<21 | int64(h[7]&0x7f)<<14 | int64(h[8]&0x7f)<<7 | int64(h[9]&0x7f)
			at += 10 + n
			if h[5]&0x10 != 0 {
				at += 10 // footer
			}
		}
	}
	switch ext {
	case ".flac":
		at := skipID3(0)
		if m := read(at, 4); m == nil || string(m) != "fLaC" {
			return 0, 0, false
		}
		at += 4
		for {
			h := read(at, 4)
			if h == nil {
				return 0, 0, false
			}
			at += 4 + (int64(h[1])<<16 | int64(h[2])<<8 | int64(h[3]))
			if h[0]&0x80 != 0 {
				break
			}
		}
		if at >= size {
			return 0, 0, false
		}
		return at, size, true
	case ".mp3":
		at := skipID3(0)
		end := size
		if t := read(end-128, 3); t != nil && string(t) == "TAG" {
			end -= 128 // ID3v1
		}
		if a := read(end-32, 32); a != nil && string(a[:8]) == "APETAGEX" {
			n := int64(a[12]) | int64(a[13])<<8 | int64(a[14])<<16 | int64(a[15])<<24
			if a[23]&0x80 != 0 {
				n += 32 // APEv2 header
			}
			end -= n
		}
		if at >= end {
			return 0, 0, false
		}
		return at, end, true
	case ".m4a", ".mp4", ".m4b", ".alac":
		var mdatStart, mdatEnd int64
		for at := int64(0); at < size; {
			h := read(at, 8)
			if h == nil {
				return 0, 0, false
			}
			n := int64(binary.BigEndian.Uint32(h[:4]))
			head := int64(8)
			switch n {
			case 1:
				x := read(at+8, 8)
				if x == nil {
					return 0, 0, false
				}
				n, head = int64(binary.BigEndian.Uint64(x)), 16
			case 0:
				n = size - at
			}
			if n < head || at+n > size {
				return 0, 0, false
			}
			if string(h[4:8]) == "mdat" {
				if mdatEnd != 0 {
					return 0, 0, false // more than one: measure the whole file
				}
				mdatStart, mdatEnd = at+head, at+n
			}
			at += n
		}
		if mdatEnd == 0 || mdatStart >= mdatEnd {
			return 0, 0, false
		}
		return mdatStart, mdatEnd, true
	}
	return 0, 0, false
}

// attachAudioFingerprints stamps every track with a content fingerprint of its
// own file. Observations are committed immediately (state is saved by the
// caller, same as everywhere else in the sync pass) — there is no pending/
// commit split like the cover pass, because there is no external cache to wait
// on (see the file-level comment above).
func attachAudioFingerprints(tracks []librarySyncTrack, state *SidecarState) {
	attachAudioFingerprintsWithin(tracks, state, audioHashBudget)
}

func attachAudioFingerprintsWithin(tracks []librarySyncTrack, state *SidecarState, budget time.Duration) {
	if len(tracks) == 0 {
		return
	}
	if state != nil && state.AudioObservations == nil {
		stateMu.Lock()
		state.AudioObservations = map[string]trackObservation{}
		stateMu.Unlock()
	}
	start := time.Now()
	staleBefore := start.Add(-audioFullRehashInterval).Unix()

	hash := func(t *librarySyncTrack, size, modUnix int64) bool {
		fingerprint, ok := hashTrackFile(t.Path)
		if !ok {
			return false // unreadable → UNKNOWN this pass, retried next
		}
		value := fingerprint
		t.AudioFingerprint = &value
		if state != nil {
			stateMu.Lock()
			state.AudioObservations[t.CassetteLocalID] = trackObservation{
				Fingerprint:  fingerprint,
				Size:         size,
				ModTimeUnix:  modUnix,
				HashedAtUnix: time.Now().Unix(),
			}
			stateMu.Unlock()
		}
		return true
	}

	// First pass: songs whose file is new or changed get read (they are what the
	// phones need to hear about); unchanged ones reuse what's known, and the
	// ones not read for a week are set aside for a re-check.
	type recheck struct {
		t             *librarySyncTrack
		size, modUnix int64
	}
	var stale []recheck
	stamped, hashed, deferred := 0, 0, 0
	for i := range tracks {
		t := &tracks[i]
		if t.Path == "" || t.CassetteLocalID == "" {
			continue
		}
		fi, err := os.Stat(t.Path)
		if err != nil {
			continue // unreadable this pass — retried next sync, never blocks the rest
		}
		size := fi.Size()
		modUnix := fi.ModTime().Unix()
		if born, ok := fileBornAt(fi); ok {
			b := born.Unix()
			t.FileCreatedAt = &b
		}

		var prev trackObservation
		var had bool
		if state != nil {
			prev, had = state.AudioObservations[t.CassetteLocalID]
		}
		// A fingerprint measured the old way (before kinds) is measured again, within the budget; until then the
		// cloud keeps the value it has (a track sent without one changes nothing there).
		if had && prev.Size == size && prev.ModTimeUnix == modUnix && currentKind(prev.Fingerprint) {
			value := prev.Fingerprint
			t.AudioFingerprint = &value
			stamped++
			if prev.HashedAtUnix < staleBefore {
				stale = append(stale, recheck{t, size, modUnix})
			}
			continue
		}
		if time.Since(start) >= budget {
			deferred++
			continue
		}
		if hash(t, size, modUnix) {
			stamped++
			hashed++
		}
	}
	// Second pass: re-read unchanged songs due a check, with whatever time is
	// left. This catches the rare same-size, same-date edit; the rest wait.
	for _, r := range stale {
		if time.Since(start) >= budget {
			deferred++
			continue
		}
		if hash(r.t, r.size, r.modUnix) {
			hashed++
		}
	}

	// Always report coverage, not just when something was hashed: a track that
	// never gets stamped is indistinguishable from the feature not running at all.
	log.Printf(
		"audio-fp: %d/%d tracks stamped (%d read this pass, %d left for a later pass)",
		stamped, len(tracks), hashed, deferred,
	)
}
