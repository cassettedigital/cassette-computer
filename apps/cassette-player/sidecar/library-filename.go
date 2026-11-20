// library-filename.go — what a song's file name says when its tags say nothing.
//
// Two gaps, both found on an imported OverClocked ReMix album whose files are
// named like "1-13 Gario - The Throes of Death.mp3":
//
//  1. Track numbers. The cloud and the apps put a record's songs in order by
//     (disc number, number on the disc). That number used to reach the cloud only
//     for CD rips (carryDiscIdentity), so every imported record listed its songs
//     in arrival order. Now every song carries Navidrome's own track number, and
//     when Navidrome has none, the number at the front of the file name.
//  2. Titles that are really file names. With no title tag, Navidrome falls back
//     to the file name without its extension, so the song reached the cloud as
//     "1-13 Gario - The Throes of Death". When the title is exactly the file name,
//     the hub sends it without the leading number and the leading "<artist> - ".
//     A title that came from a tag is never touched.
//
// Read-only: nothing here changes a file. Only what the hub reports changes. The
// song's cassette_local_id keeps being made from Navidrome's own title, because
// playback and the card actions make it from that same title (playback.go,
// card-actions.go) and the two must keep agreeing.

package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

const (
	maxFileNameTrack = 999
	maxFileNameDisc  = 99
)

var (
	// A disc, a dash, a two- or three-digit track, then a separator:
	// "1-13 Gario - ...", "2-05. Song", "1-01_Song". A one-digit track after the
	// dash ("24-7 Love") is left alone, as it reads as easily as part of a title.
	fileNameDiscTrack = regexp.MustCompile(`^(\d{1,2})-(\d{2,3})([ _]+(?:-[ _]*)?|[.)_-][ _]*)`)
	// A one- to three-digit track, then a separator: "07 Intro", "01 - Intro",
	// "01. Intro", "01_Intro", "01) Intro", "01-Intro". Four digits are a year or a
	// title ("2001 A Space Odyssey"), never a track.
	fileNameTrack = regexp.MustCompile(`^(\d{1,3})([ _]+(?:-[ _]*)?|[.)_-][ _]*)`)
)

// fileNameNumbers reads the disc and track number off the front of a file name
// (without its extension). 0 means the name does not say. A number is taken only
// when it is followed by a separator, and a bare punctuation separator followed
// by another digit ("24-7", "1.5 Degrees") is read as part of a title, not a
// number, so a name is left alone whenever it is unclear. A name that starts with
// the song's own artist and a dash ("3 Doors Down - Kryptonite") has no number.
func fileNameNumbers(base, artist string) (disc, track int) {
	_, disc, track = splitFileName(base, artist)
	return disc, track
}

// cleanFileNameTitle turns a title Navidrome took from the file name into the
// song's title: the leading disc-track or track number and its separators go,
// then a leading "<artist> - " when it is the song's own artist (any case). When
// nothing would be left, the name is kept as it was.
func cleanFileNameTitle(base, artist string) string {
	title, _, _ := splitFileName(base, artist)
	if title == "" {
		return base
	}
	return title
}

// splitFileName reads a file name the way people name songs: an optional
// disc-track or track number, an optional "<artist> - ", then the title.
func splitFileName(base, artist string) (title string, disc, track int) {
	rest := base
	if _, ok := cutArtistDash(base, artist); !ok {
		rest, disc, track = splitFileNameNumber(base)
	}
	if after, ok := cutArtistDash(rest, artist); ok {
		rest = after
	}
	return strings.TrimSpace(rest), disc, track
}

// splitFileNameNumber returns the rest of base after a leading disc-track or
// track number and its separators, with the numbers it found. When base has no
// number it is returned whole, with zeros.
func splitFileNameNumber(base string) (rest string, disc, track int) {
	if m := fileNameDiscTrack.FindStringSubmatch(base); m != nil {
		d, _ := strconv.Atoi(m[1])
		t, _ := strconv.Atoi(m[2])
		rest := base[len(m[0]):]
		if d >= 1 && d <= maxFileNameDisc && t >= 1 && t <= maxFileNameTrack && !digitAfterBareMark(m[3], rest) {
			return rest, d, t
		}
		// A disc-track shape out of range is not read as a plain track either.
		return base, 0, 0
	}
	if m := fileNameTrack.FindStringSubmatch(base); m != nil {
		t, _ := strconv.Atoi(m[1])
		rest := base[len(m[0]):]
		if t >= 1 && t <= maxFileNameTrack && !digitAfterBareMark(m[2], rest) {
			return rest, 0, t
		}
	}
	return base, 0, 0
}

// digitAfterBareMark reports a separator that is only punctuation ("-", ".",
// "_", ")") with a digit straight after it: "24-7", "1.5". Those read as part of
// a title. A space separator is clear ("01 2 Become 1").
func digitAfterBareMark(sep, rest string) bool {
	if rest == "" || rest[0] < '0' || rest[0] > '9' {
		return false
	}
	return strings.Trim(sep, "._)-") == ""
}

// cutArtistDash cuts a leading "<artist> - " (artist in any case, at least one
// space before the dash) and returns what follows it.
func cutArtistDash(s, artist string) (string, bool) {
	a := strings.TrimSpace(artist)
	if a == "" {
		return s, false
	}
	after, ok := cutPrefixFold(s, a)
	if !ok {
		return s, false
	}
	spaced := strings.TrimLeft(after, " ")
	if len(spaced) == len(after) || !strings.HasPrefix(spaced, "-") {
		return s, false
	}
	return strings.TrimSpace(spaced[1:]), true
}

// cutPrefixFold is strings.CutPrefix that ignores case, rune by rune, so a
// prefix whose case changes its byte length still cuts at the right place.
func cutPrefixFold(s, prefix string) (string, bool) {
	for _, pr := range prefix {
		r, size := utf8.DecodeRuneInString(s)
		if size == 0 || !strings.EqualFold(string(r), string(pr)) {
			return s, false
		}
		s = s[size:]
	}
	return s, true
}

// songFileBase is the name of a song's own file without its extension, or ""
// when the hub cannot be sure which file it is. The library fetch asks Navidrome
// for real absolute paths (librarySyncClientName). A relative path may be one
// Navidrome made up from the tags (its fakePath: "Artist/Album/01 - Title.mp3"),
// whose name is not a file name at all, so it counts only when that file really
// is there under the music folder.
func songFileBase(p string) string {
	if p == "" {
		return ""
	}
	if !filepath.IsAbs(p) {
		fi, err := os.Stat(filepath.Join(sidecarMusicDir, p))
		if err != nil || !fi.Mode().IsRegular() {
			return ""
		}
	}
	base := filepath.Base(p)
	return strings.TrimSuffix(base, filepath.Ext(base))
}

// fillFromFileNames gives every song its number on its disc and, when its title
// is only its file name, a cleaned title. It runs after carryDiscIdentity, which
// has the final word for CD rips:
//   - a song carry already placed keeps its position;
//   - a song carry linked to a disc but could not place keeps no position, so the
//     disc's (mb_disc_id, position) key never forms from a guess;
//   - every other song takes Navidrome's track number, or when Navidrome has none
//     the number at the front of its file name.
//
// The disc number comes from a "D-TT" file name only when Navidrome has none, and
// only when the name's track agrees with the track the song is given.
func fillFromFileNames(tracks []librarySyncTrack) {
	for i := range tracks {
		t := &tracks[i]
		base := songFileBase(t.Path)

		if t.DiscTrackIndex == nil && t.MBDiscID == nil {
			track := t.NavidromeTrack
			nameDisc, nameTrack := fileNameNumbers(base, t.ArtistName)
			if track <= 0 {
				track = nameTrack
			}
			if track > 0 {
				n := track
				t.DiscTrackIndex = &n
				if t.DiscNumber == nil && nameDisc > 0 && nameTrack == track {
					d := nameDisc
					t.DiscNumber = &d
				}
			}
		}

		if base != "" && t.TrackTitle == base {
			t.TrackTitle = cleanFileNameTitle(base, t.ArtistName)
		}
		t.TrackTitle = undoubleTitle(t.TrackTitle)
	}
}

// undoubleTitle drops a closing "(…)" that only repeats the start of the title. Navidrome appends a file's
// SUBTITLE tag in parentheses (subsonic.appendsubtitle, on by default), and some files repeat the title there,
// so a song read "Memories of Dali (Village of Dali) (Memories of Dali)". Navidrome's own setting stays on:
// cassette_local_id is made from its title (local-id.go), so turning it off would give every song with a
// subtitle a new id and loosen it from playlists and favourites. Only the title Cassette shows changes, and a
// real subtitle ("Symphony No. 5 (Fate)") stays, because it doesn't repeat the title.
func undoubleTitle(title string) string {
	s := strings.TrimRight(title, " ")
	if !strings.HasSuffix(s, ")") {
		return title
	}
	depth, open := 0, -1
	for i := len(s) - 1; i >= 0 && open < 0; i-- {
		switch s[i] {
		case ')':
			depth++
		case '(':
			depth--
			if depth == 0 {
				open = i
			}
		}
	}
	if open <= 0 {
		return title
	}
	inner := strings.TrimSpace(s[open+1 : len(s)-1])
	rest := strings.TrimSpace(s[:open])
	if inner == "" || rest == "" || !strings.HasPrefix(strings.ToLower(rest), strings.ToLower(inner)) {
		return title
	}
	return rest
}
