// CD-TEXT read (multi-signal disc ID, rung 2 seed).
//
// Some discs that are IN MusicBrainz never had a disc ID submitted, so the
// exact Disc ID lookup (rung 1) 404s. When such a disc carries CD-TEXT — the
// artist/album/track titles burned into the subchannel — we can read that text
// and search MusicBrainz by it (the Rostam case). CD-TEXT also gives us real
// track titles for the IMPORT-ANYWAY terminal when nothing matches.
//
// We shell out to libcdio's `cd-info`, which is already bundled alongside
// cd-paranoia (native/build-app.sh). This is the ONE place that reads cd-info's
// text; the parser is split out so it's unit-testable with a captured sample,
// exactly like parseParanoiaTOC.

package main

import (
	"os/exec"
	"strings"
)

const cdInfoBin = "cd-info"

// CDTextTrack is the per-track CD-TEXT payload (only the fields we use).
type CDTextTrack struct {
	Title  string
	Artist string
}

// CDText is the disc-level CD-TEXT plus a per-track-position map. Absent fields
// stay empty; a disc with no CD-TEXT yields a struct where HasAny() is false.
type CDText struct {
	Album       string
	AlbumArtist string
	Tracks      map[int]CDTextTrack
}

// HasAny reports whether any usable CD-TEXT was present. nil-safe.
func (c *CDText) HasAny() bool {
	return c != nil && (c.Album != "" || c.AlbumArtist != "" || len(c.Tracks) > 0)
}

// TitleFor returns the CD-TEXT title for a 1-based track position, or "".
func (c *CDText) TitleFor(pos int) string {
	if c == nil {
		return ""
	}
	return c.Tracks[pos].Title
}

// ArtistFor returns the CD-TEXT performer for a track position, falling back to
// the disc-level album artist. "" if neither is present.
func (c *CDText) ArtistFor(pos int) string {
	if c == nil {
		return ""
	}
	if a := c.Tracks[pos].Artist; a != "" {
		return a
	}
	return c.AlbumArtist
}

// readCDText runs `cd-info` once and parses any CD-TEXT off the inserted disc.
// Returns nil (not an error) when there's no disc, no CD-TEXT, or cd-info is
// unavailable — CD-TEXT is a best-effort signal, never a gate. Fixture mode has
// no physical disc, so it reports no CD-TEXT (the fixture disc resolves by ID).
func readCDText() *CDText {
	if ripFixtureMode {
		return nil
	}
	// -A no filesystem analysis (slow, irrelevant), -I no ioctl dump, -v no Video
	// CD probe, and suppress the device/disc-mode banners. Track + CD-TEXT info
	// (what we want) is still printed. cd-info may exit non-zero yet still print
	// the table, so we parse the output regardless of the exit code.
	out, _ := exec.Command(cdInfoBin, "-A", "-I", "-v",
		"--no-device-info", "--no-disc-mode", "--no-header").CombinedOutput()
	ct := parseCDText(string(out))
	if !ct.HasAny() {
		return nil
	}
	return ct
}

// parseCDText extracts CD-TEXT from cd-info output. The relevant section looks
// like:
//
//	CD-TEXT for Disc:
//		TITLE: OK Computer
//		PERFORMER: Radiohead
//	CD-TEXT for Track  1:
//		TITLE: Airbag
//		PERFORMER: Radiohead
//
// Section headers start at column 0; field lines are indented. We only assign
// fields while inside a recognized section AND the line is indented, so stray
// "Key: value" lines from other cd-info sections can never be mis-read as
// CD-TEXT. Pure function — no drive access — so it's fixture-testable.
func parseCDText(text string) *CDText {
	ct := &CDText{Tracks: map[int]CDTextTrack{}}
	const (
		sectNone = 0
		sectDisc = -1
	)
	section := sectNone

	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimRight(raw, "\r")
		trimmed := strings.TrimSpace(line)
		low := strings.ToLower(trimmed)

		switch {
		case strings.HasPrefix(low, "cd-text for disc"):
			section = sectDisc
			continue
		case strings.HasPrefix(low, "cd-text for track"):
			if n := firstIntIn(trimmed); n > 0 {
				section = n
			} else {
				section = sectNone
			}
			continue
		}

		indented := len(line) > 0 && (line[0] == ' ' || line[0] == '\t')
		if section == sectNone || trimmed == "" {
			continue
		}
		// A non-indented, non-header line ends the CD-TEXT block — anything that
		// follows belongs to a different cd-info section.
		if !indented {
			section = sectNone
			continue
		}

		key, val, ok := splitCDTextField(trimmed)
		if !ok {
			continue
		}
		switch key {
		case "TITLE":
			if section == sectDisc {
				ct.Album = val
			} else {
				t := ct.Tracks[section]
				t.Title = val
				ct.Tracks[section] = t
			}
		case "PERFORMER":
			if section == sectDisc {
				ct.AlbumArtist = val
			} else {
				t := ct.Tracks[section]
				t.Artist = val
				ct.Tracks[section] = t
			}
		}
	}
	return ct
}

// splitCDTextField parses an indented "KEY: value" CD-TEXT line. Returns the
// upper-cased key and the trimmed value. ok is false when there's no colon.
func splitCDTextField(s string) (key, val string, ok bool) {
	i := strings.IndexByte(s, ':')
	if i <= 0 {
		return "", "", false
	}
	return strings.ToUpper(strings.TrimSpace(s[:i])), strings.TrimSpace(s[i+1:]), true
}

// firstIntIn returns the first run of digits in s as an int, or 0 if none. Used
// to pull the track number out of "CD-TEXT for Track  3:".
func firstIntIn(s string) int {
	n, started := 0, false
	for _, r := range s {
		if r >= '0' && r <= '9' {
			n = n*10 + int(r-'0')
			started = true
		} else if started {
			break
		}
	}
	if !started {
		return 0
	}
	return n
}
