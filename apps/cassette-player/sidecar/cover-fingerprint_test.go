package main

import "testing"

// The cloud hears the folder cover's fingerprint under the current serving rule, so a
// rule change moves every album's value once (phones pull their covers again) while the
// same cover under the same rule always reports the same value (no endless re-pulls).
func TestReportedCoverFingerprintMovesWithTheRuleOnly(t *testing.T) {
	const raw = "31aecf9818503026"
	got := reportedCoverFingerprint(raw)
	if got == raw {
		t.Fatalf("reported fingerprint equals the plain one, so phones holding a song's own art would never pull the album cover")
	}
	if len(got) != 16 {
		t.Fatalf("reported fingerprint is %d chars, want 16 (the cloud caps the field)", len(got))
	}
	if again := reportedCoverFingerprint(raw); again != got {
		t.Fatalf("same cover reported %q then %q; every sync would read as a change", got, again)
	}
	if other := reportedCoverFingerprint("0000000000000000"); other == got {
		t.Fatalf("two different covers reported the same value")
	}
}
