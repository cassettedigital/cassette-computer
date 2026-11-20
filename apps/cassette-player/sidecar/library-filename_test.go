package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFileNameNumbersAndTitle(t *testing.T) {
	cases := []struct {
		base, artist string
		disc, track  int
		title        string
	}{
		// The OverClocked ReMix album that found this.
		{"1-13 Gario - The Throes of Death", "Gario", 1, 13, "The Throes of Death"},
		{"1-01 Benjamin Briggs - Over the Hill", "Benjamin Briggs", 1, 1, "Over the Hill"},
		{"1-01 benjamin briggs - Over the Hill", "Benjamin Briggs", 1, 1, "Over the Hill"},
		{"2-05. Song", "", 2, 5, "Song"},
		// Plain track numbers and their usual separators.
		{"07 Intro", "", 0, 7, "Intro"},
		{"01 - Intro", "", 0, 1, "Intro"},
		{"01. Intro", "", 0, 1, "Intro"},
		{"01_Intro", "", 0, 1, "Intro"},
		{"01) Intro", "", 0, 1, "Intro"},
		{"01-Intro", "", 0, 1, "Intro"},
		{"3 - Gario - Theme", "Gario", 0, 3, "Theme"},
		{"01 2 Become 1", "", 0, 1, "2 Become 1"},
		{"01 ...And Justice for All", "", 0, 1, "...And Justice for All"},
		// No number: the name is left as it is.
		{"Intro", "", 0, 0, "Intro"},
		{"2001 A Space Odyssey", "", 0, 0, "2001 A Space Odyssey"},
		{"1999", "", 0, 0, "1999"},
		{"24-7 Love", "", 0, 0, "24-7 Love"},
		{"1.5 Degrees", "", 0, 0, "1.5 Degrees"},
		{"10,000 Days", "", 0, 0, "10,000 Days"},
		{"00 Hidden", "", 0, 0, "00 Hidden"},
		{"0-01 Song", "", 0, 0, "0-01 Song"},
		{"07", "", 0, 0, "07"},
		// A leading number that belongs to the artist is not a track.
		{"3 Doors Down - Kryptonite", "3 Doors Down", 0, 0, "Kryptonite"},
		// The artist goes only when it is the song's own artist, followed by " - ".
		{"Gario - The Throes of Death", "Gario", 0, 0, "The Throes of Death"},
		{"Gario - The Throes of Death", "Someone Else", 0, 0, "Gario - The Throes of Death"},
		{"Garioke - Song", "Gario", 0, 0, "Garioke - Song"},
		{"12 Gario-Song", "Gario", 0, 12, "Gario-Song"},
		// Nothing left after cleaning: keep the name.
		{"1-13 Gario - ", "Gario", 1, 13, "1-13 Gario - "},
		{"Gario - ", "Gario", 0, 0, "Gario - "},
	}
	for _, c := range cases {
		disc, track := fileNameNumbers(c.base, c.artist)
		if disc != c.disc || track != c.track {
			t.Errorf("fileNameNumbers(%q, %q) = disc %d track %d, want disc %d track %d", c.base, c.artist, disc, track, c.disc, c.track)
		}
		if got := cleanFileNameTitle(c.base, c.artist); got != c.title {
			t.Errorf("cleanFileNameTitle(%q, %q) = %q, want %q", c.base, c.artist, got, c.title)
		}
	}
}

func intp(n int) *int { return &n }

func TestFillFromFileNames(t *testing.T) {
	root := t.TempDir()
	prev := sidecarMusicDir
	sidecarMusicDir = root
	t.Cleanup(func() { sidecarMusicDir = prev })

	// A real file reached by a relative path, and a relative path Navidrome made up.
	if err := os.MkdirAll(filepath.Join(root, "OCR", "FF9"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "OCR", "FF9", "1-07 Gario - Vamo.mp3"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	discID := "disc"
	// Absolute paths Navidrome reports are used as they are, whether or not the
	// file is there (no file is read here).
	abs := func(parts ...string) string { return filepath.Join(append([]string{root, "abs"}, parts...)...) }

	tracks := []librarySyncTrack{
		// 0: no tags at all, absolute path: number and disc from the name, title cleaned.
		{TrackTitle: "1-13 Gario - The Throes of Death", ArtistName: "Gario", Path: abs("OCR", "1-13 Gario - The Throes of Death.mp3")},
		// 1: Navidrome's track number wins over the name's; the title came from a tag.
		{TrackTitle: "Memories of Dali", ArtistName: "Gario", NavidromeTrack: 4, Path: abs("OCR", "1-13 Gario - Memories of Dali.mp3")},
		// 2: a CD rip carry placed: its position stays.
		{TrackTitle: "Song", NavidromeTrack: 9, DiscTrackIndex: intp(3), MBDiscID: &discID, Path: abs("a", "09 - Song.flac")},
		// 3: carry linked a disc but could not place the song: no guessed position.
		{TrackTitle: "Song", NavidromeTrack: 9, MBDiscID: &discID, Path: abs("a", "09 - Song.flac")},
		// 4: a title that only looks like a file name keeps its words.
		{TrackTitle: "2001 A Space Odyssey", Path: abs("a", "2001 A Space Odyssey.mp3")},
		// 5: Navidrome has a disc number: it is kept.
		{TrackTitle: "2-05 Song", DiscNumber: intp(1), Path: abs("a", "2-05 Song.mp3")},
		// 6: relative path to a real file under the music folder.
		{TrackTitle: "1-07 Gario - Vamo", ArtistName: "Gario", Path: filepath.Join("OCR", "FF9", "1-07 Gario - Vamo.mp3")},
		// 7: relative path Navidrome made up from the tags: no file, so nothing is read from it.
		{TrackTitle: "05-Song", Path: filepath.Join("Artist", "Album", "05-Song.mp3")},
		// 8: Navidrome's track agrees with a "D-TT" name and has no disc: the disc comes from the name.
		{TrackTitle: "Over the Hill", NavidromeTrack: 1, Path: abs("a", "2-01 Over the Hill.mp3")},
		// 9: Navidrome's track disagrees with the name: no disc from the name.
		{TrackTitle: "Over the Hill", NavidromeTrack: 4, Path: abs("a", "2-01 Over the Hill.mp3")},
	}
	fillFromFileNames(tracks)

	type want struct {
		index, disc *int
		title       string
	}
	wants := []want{
		{intp(13), intp(1), "The Throes of Death"},
		{intp(4), nil, "Memories of Dali"},
		{intp(3), nil, "Song"},
		{nil, nil, "Song"},
		{nil, nil, "2001 A Space Odyssey"},
		{intp(5), intp(1), "Song"},
		{intp(7), intp(1), "Vamo"},
		{nil, nil, "05-Song"},
		{intp(1), intp(2), "Over the Hill"},
		{intp(4), nil, "Over the Hill"},
	}
	eq := func(a, b *int) bool { return (a == nil && b == nil) || (a != nil && b != nil && *a == *b) }
	show := func(p *int) any {
		if p == nil {
			return nil
		}
		return *p
	}
	for i, w := range wants {
		got := tracks[i]
		if !eq(got.DiscTrackIndex, w.index) {
			t.Errorf("track %d: DiscTrackIndex = %v, want %v", i, show(got.DiscTrackIndex), show(w.index))
		}
		if !eq(got.DiscNumber, w.disc) {
			t.Errorf("track %d: DiscNumber = %v, want %v", i, show(got.DiscNumber), show(w.disc))
		}
		if got.TrackTitle != w.title {
			t.Errorf("track %d: TrackTitle = %q, want %q", i, got.TrackTitle, w.title)
		}
	}
}

func TestUndoubleTitle(t *testing.T) {
	cases := []struct{ in, want string }{
		{"Memories of Dali (Village of Dali) (Memories of Dali)", "Memories of Dali (Village of Dali)"},
		{"You and I (We're Not Alone) [Not Alone] (You and I (We're Not Alone))", "You and I (We're Not Alone) [Not Alone]"},
		{"Zero World (The Final Battle) (Zero World)", "Zero World (The Final Battle)"},
		{"Intro (Intro)", "Intro"},
		{"Symphony No. 5 (Fate)", "Symphony No. 5 (Fate)"},
		{"Song (Live)", "Song (Live)"},
		{"(Interlude)", "(Interlude)"},
		{"Plain title", "Plain title"},
		{"Unbalanced (open", "Unbalanced (open"},
		{"Close only)", "Close only)"},
		{"Café (café)", "Café"},
	}
	for _, c := range cases {
		if got := undoubleTitle(c.in); got != c.want {
			t.Errorf("undoubleTitle(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
