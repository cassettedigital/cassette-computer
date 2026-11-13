package main

import (
	"path/filepath"
	"testing"
)

// landedPath disc-prefixes multi-disc files so a set's discs stop colliding in the
// shared album folder, and leaves single-disc files exactly as before (BUG-261).
func TestLandedPathDiscPrefix(t *testing.T) {
	name := func(rel *MatchedRelease, pos int, title string) string {
		return filepath.Base(landedPath("/m/Artist/Album", rel, RippedTrackMeta{Position: pos, Title: title}))
	}
	if got, want := name(&MatchedRelease{MediumCount: 1, MediumPos: 1}, 3, "Song"), "03 - Song.flac"; got != want {
		t.Errorf("single-disc: got %q, want %q", got, want)
	}
	if got, want := name(&MatchedRelease{MediumCount: 2, MediumPos: 2}, 3, "Song"), "2-03 - Song.flac"; got != want {
		t.Errorf("multi-disc: got %q, want %q", got, want)
	}
	// Defensive: nil release, or a multi-disc release with an unset MediumPos, must
	// still produce a stable name (degrade to single-disc / disc 1) — never "0-…".
	if got, want := name(nil, 1, "X"), "01 - X.flac"; got != want {
		t.Errorf("nil rel: got %q, want %q", got, want)
	}
	if got, want := name(&MatchedRelease{MediumCount: 2, MediumPos: 0}, 1, "X"), "1-01 - X.flac"; got != want {
		t.Errorf("multi-disc unset pos: got %q, want %q", got, want)
	}
}
