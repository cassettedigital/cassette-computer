// One-time cover remediation for the pre-guard iTunes-fallback wrong-cover defect.
//
// Before the itunesCoverURL guard, a blind results[0] could stamp a sibling
// single/EP's art onto an album (Petey/USA → "Like a Mantra", The Tallest Man on
// Earth/Dark Bird Is Home → a different EP, spill tab/ANGIE → "angie.exe"). The
// fixed rip path can't self-heal those: materializeCoverForAlbumDir's never-
// overwrite guard keeps any cover that still DECODES, and a valid-but-wrong JPEG
// decodes fine. This is the explicit, one-time repair.
//
// DETECTION IS AN EXPLICIT ALLOWLIST — NOT automated diffing.
//
//	An earlier version diffed every no-embedded-art folder's cover against the
//	catalog cover and flagged any that differed. That over-flagged massively (33 of
//	~39) because the SAME artwork at a different resolution/encoding is byte-
//	different (and perceptual hashing still needs a human eye). With no cover-
//	provenance marker and no undo, a file-overwriting pass must not trust automated
//	detection. So we overwrite ONLY albums on confirmedWrongCovers — each visually
//	confirmed wrong — and only when the catalog resolves to that album's EXPECTED
//	cover id. Everything else is physically untouchable by this pass.
//
// SAFETY: dry-run by default (SIDECAR_REMEDIATE_COVERS=1 writes nothing); only
// =execute writes. An allowlisted album whose catalog cover does NOT resolve to the
// expected id is LEFT for manual review — never replaced with an unexpected cover.

package main

import (
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// coverAllowlistEntry is one album whose materialized cover.jpg was confirmed (by
// visual review) to be a wrong-album iTunes-fallback stamp, plus the catalog cover
// id we EXPECT to replace it with (a stable substring of the catalog cover URL).
type coverAllowlistEntry struct {
	artist     string
	album      string
	expectedID string
}

// confirmedWrongCovers is the verified allowlist — the ONLY albums this pass may
// overwrite (see CASSETTE_BUG_REGISTER). Keep it explicit: do not reintroduce
// automated diffing, and do not add the cosmetic Strokes/Is This It edition
// mismatch or the tag-drift "left for manual" albums.
var confirmedWrongCovers = []coverAllowlistEntry{
	{artist: "Petey", album: "USA", expectedID: "b5e4cf8e"},
	{artist: "The Tallest Man on Earth", album: "Dark Bird Is Home", expectedID: "322613ff"},
	{artist: "spill tab", album: "ANGIE", expectedID: "b0fe72b9"},
}

// remediateMismatchedCovers overwrites ONLY the explicitly-allowlisted wrong covers
// (confirmedWrongCovers), and only when the catalog resolves to the EXPECTED cover
// id. dry-run (execute=false) writes nothing. Returns counts for the run summary.
// Needs a paired session (the catalog lookup is authenticated).
func remediateMismatchedCovers(root string, execute bool) (proposed, replaced, manual int) {
	if liveState == nil || liveState.BearerToken == "" {
		log.Printf("remediate: not paired — skipping (the catalog lookup needs a session)")
		return 0, 0, 0
	}

	// Normalized allowlist: foldGroupText(artist)|foldGroupText(album) -> expected id.
	// foldGroupText is the resolver's own grouping normalization, so "Petey USA"-style
	// drift can't cause a mis-target.
	allow := make(map[string]string, len(confirmedWrongCovers))
	for _, e := range confirmedWrongCovers {
		allow[foldGroupText(e.artist)+"|"+foldGroupText(e.album)] = e.expectedID
	}

	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil || !d.IsDir() {
			return nil
		}
		dir := path

		coverPath := existingFolderCoverPath(dir)
		if coverPath == "" {
			return nil // no materialized cover — nothing to remediate
		}

		// Identify the album from its first audio track's tags.
		entries, _ := os.ReadDir(dir)
		var firstAudio string
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			track := filepath.Join(dir, e.Name())
			if isSupportedAudio(track) {
				firstAudio = track
				break
			}
		}
		if firstAudio == "" {
			return nil
		}
		tags, terr := readTags(firstAudio)
		if terr != nil || tags.Artist == "" || tags.Album == "" {
			return nil
		}

		// Allowlist gate: anything not explicitly confirmed is untouchable.
		expectedID, ok := allow[foldGroupText(tags.Artist)+"|"+foldGroupText(tags.Album)]
		if !ok {
			return nil
		}

		// Resolve the catalog cover and CONFIRM it is the expected id before any
		// write (force past the 24h negative cache so the lookup actually runs).
		coverForceRecheck(dir)
		coverURL, lerr := lookupCatalogCoverURL(tags.Artist, tags.Album)
		if lerr != nil || coverURL == "" {
			log.Printf("remediate: %q (%s — %s) — catalog cover unresolved; LEFT for manual review",
				dir, tags.Artist, tags.Album)
			manual++
			return nil
		}
		if !strings.Contains(coverURL, expectedID) {
			log.Printf("remediate: %q (%s — %s) — catalog resolved to an UNEXPECTED cover "+
				"(want id %s, got %s); LEFT for manual review (never substitute)",
				dir, tags.Artist, tags.Album, expectedID, coverURL)
			manual++
			return nil
		}

		newData, newMime, derr := downloadImage(coverURL)
		if derr != nil || len(newData) == 0 {
			log.Printf("remediate: %q — expected catalog cover download failed; LEFT", dir)
			manual++
			return nil
		}
		newData, newMime = normalizeCover(newData, newMime)
		oldData, _ := os.ReadFile(coverPath)

		if !execute {
			log.Printf("remediate DRY-RUN: %q (%s — %s) — disk cover %d B → catalog cover %d B "+
				"[id=%s OK] WOULD REPLACE", dir, tags.Artist, tags.Album, len(oldData), len(newData), expectedID)
			proposed++
			return nil
		}

		// The wrong cover goes to the Trash first, never deleted (BUG-825), so a person can get it back;
		// writeFolderCover would otherwise overwrite a same-named file in place.
		if err := trashStale(coverPath); err != nil {
			log.Printf("remediate: %q — could not move the old cover to the Trash: %v; LEFT", dir, err)
			manual++
			return nil
		}
		if _, werr := writeFolderCover(dir, newData, newMime); werr != nil {
			log.Printf("remediate: %q — write failed: %v; the old cover is in the Trash", dir, werr)
			manual++
			return nil
		}
		log.Printf("remediate: %q (%s — %s) — REPLACED with expected catalog cover (id=%s)",
			dir, tags.Artist, tags.Album, expectedID)
		replaced++
		return nil
	})
	return proposed, replaced, manual
}
