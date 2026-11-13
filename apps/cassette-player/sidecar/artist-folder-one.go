// One artist, or a shared folder? (BUG-553)
//
// The hub writes an artist's photo as artist.<ext> in the artist folder, which it finds two levels up from a track
// ({music}/{Artist}/{Album}/track). When that folder is really a GROUPING folder (an imports or compilations folder
// holding albums by different artists), the first artist's photo written there is served for every artist under it:
// FUN.'s circle wore Bright Eyes' face. folderHoldsOneArtist tells the two apart by sampling one song from each
// album folder inside, so artistDirForPath can fall back to the album folder when the folder is shared, the same way
// it already does for the library root (BUG-787).
//
// Only the track artist tag is read (the three tag readers carry no album-artist tag), so the comparison is loose on
// purpose: "feat." and "&" credits are cut to the first name, a leading "The" is dropped, and a compilation's
// "Various Artists" is not an artist. When there is nothing to compare (fewer than two readable albums) the folder
// stays an artist folder, which is what it was before.

package main

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode"
)

const (
	artistFolderVerdictTTL = 10 * time.Minute
	// Album folders sampled per folder, and how deep to look inside one for its first song (disc folders).
	artistFolderMaxAlbums = 24
	artistFolderMaxDepth  = 2
)

type artistFolderVerdict struct {
	one bool
	at  time.Time
}

var (
	artistFolderVerdictMu sync.Mutex
	artistFolderVerdicts  = map[string]artistFolderVerdict{}
)

// primaryArtistKey is a track artist credit boiled down to its first name, for comparing across albums.
func primaryArtistKey(artist string) string {
	s := strings.ToLower(strings.TrimSpace(artist))
	for _, sep := range []string{" feat.", " feat ", " ft.", " ft ", " featuring ", " with ", " & ", " and ", ", ", "; ", " x ", " + ", " / "} {
		if i := strings.Index(s, sep); i > 0 {
			s = s[:i]
		}
	}
	s = strings.TrimPrefix(s, "the ")
	var b strings.Builder
	space := false
	for _, r := range s {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
			space = false
		case !space && b.Len() > 0:
			b.WriteRune(' ')
			space = true
		}
	}
	return strings.TrimSpace(b.String())
}

// sameArtistKey: two credits name the same artist when one is the other, or opens with it ("fun" and "fun some nights").
func sameArtistKey(a, b string) bool {
	return a == b || strings.HasPrefix(a, b+" ") || strings.HasPrefix(b, a+" ")
}

// isCompilationCredit: a credit that names no artist of its own.
func isCompilationCredit(key string) bool {
	return key == "various artists" || key == "various" || key == "va"
}

// firstSongArtistKey reads the track artist of the first readable song at or under dir ("" when there is none).
func firstSongArtistKey(dir string) string {
	var key string
	root := filepath.Clean(dir)
	_ = filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || key != "" {
			return nil
		}
		if d.IsDir() {
			if rel, rErr := filepath.Rel(root, p); rErr == nil && rel != "." && strings.Count(rel, string(filepath.Separator)) >= artistFolderMaxDepth {
				return filepath.SkipDir
			}
			return nil
		}
		if !isSupportedAudio(p) {
			return nil
		}
		if tags, tErr := readTags(p); tErr == nil && tags.Artist != "" {
			key = primaryArtistKey(tags.Artist)
			return filepath.SkipAll
		}
		return nil
	})
	return key
}

// folderHoldsOneArtist reports whether dir (two levels above a track) is one artist's folder. False only when the
// albums inside it are credited to more than one artist; the verdict is remembered for artistFolderVerdictTTL.
func folderHoldsOneArtist(dir string) bool {
	artistFolderVerdictMu.Lock()
	v, seen := artistFolderVerdicts[dir]
	artistFolderVerdictMu.Unlock()
	if seen && time.Since(v.at) < artistFolderVerdictTTL {
		return v.one
	}

	one := true
	var keys []string
	if entries, err := os.ReadDir(dir); err == nil {
		looked := 0
		for _, e := range entries {
			if looked >= artistFolderMaxAlbums {
				break
			}
			if !e.IsDir() || strings.HasPrefix(e.Name(), ".") {
				continue
			}
			looked++
			key := firstSongArtistKey(filepath.Join(dir, e.Name()))
			if key == "" || isCompilationCredit(key) {
				continue
			}
			for _, k := range keys {
				if sameArtistKey(k, key) {
					key = ""
					break
				}
			}
			if key != "" {
				keys = append(keys, key)
				if len(keys) > 1 {
					one = false
					break
				}
			}
		}
	}

	artistFolderVerdictMu.Lock()
	artistFolderVerdicts[dir] = artistFolderVerdict{one: one, at: time.Now()}
	artistFolderVerdictMu.Unlock()
	return one
}
