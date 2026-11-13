package main

import "testing"

func relinkRec(mbDisc, mbid, album, artist, updatedAt string) *DiscIdentityRecord {
	return &DiscIdentityRecord{
		MBDiscID:    mbDisc,
		ReleaseMBID: mbid,
		Album:       album,
		AlbumArtist: artist,
		UpdatedAt:   updatedAt,
	}
}

// TestRelinkShouldApply covers the reconcile decision: apply a cloud re-match only
// when the identity actually differs AND the server correction is newer than the
// local record's last confirmation.
func TestRelinkShouldApply(t *testing.T) {
	rl := serverRelink{
		MBDiscID:    "discA",
		ReleaseMBID: "rel-correct",
		Album:       "Bleed American",
		AlbumArtist: "Jimmy Eat World",
		UpdatedAt:   "2026-07-17T15:00:00Z",
	}

	// The common case: local holds the wrong identity, ripped BEFORE the relink.
	local := relinkRec("discA", "rel-wrong", "Bleed American", "Jimmy Eat Worl", "2026-07-17T14:00:00Z")
	if !relinkShouldApply(rl, local) {
		t.Error("a newer relink with a different identity should apply")
	}

	// Idempotent: once applied (identity matches), a re-pull is a no-op.
	applied := relinkRec("discA", "rel-correct", "Bleed American", "Jimmy Eat World", "2026-07-17T15:00:00Z")
	if relinkShouldApply(rl, applied) {
		t.Error("a relink whose identity already matches must NOT re-apply")
	}

	// A fresher LOCAL re-identification (re-rip confirmed after the relink) wins —
	// the older cloud relink must not clobber it.
	fresher := relinkRec("discA", "rel-z", "Something Else", "Another Band", "2026-07-17T16:00:00Z")
	if relinkShouldApply(rl, fresher) {
		t.Error("an older relink must not override a newer local re-identification")
	}

	// Wrong disc, or nil, never applies.
	if relinkShouldApply(rl, relinkRec("discB", "rel-x", "X", "Y", "2026-07-17T14:00:00Z")) {
		t.Error("a relink must only touch its own mb_disc_id")
	}
	if relinkShouldApply(rl, nil) {
		t.Error("nil record must not apply")
	}

	// Unparseable server timestamp → don't touch (fail-safe).
	badTime := serverRelink{MBDiscID: "discA", ReleaseMBID: "rel-correct", UpdatedAt: "not-a-time"}
	if relinkShouldApply(badTime, local) {
		t.Error("a relink with an unparseable timestamp must not apply")
	}
}

// TestSameRelinkIdentity checks the idempotency predicate: MBID when both have one,
// else album+artist (case/space-insensitive).
func TestSameRelinkIdentity(t *testing.T) {
	rl := serverRelink{ReleaseMBID: "rel-1", Album: "A", AlbumArtist: "B"}
	if !sameRelinkIdentity(rl, relinkRec("d", "rel-1", "different", "names", "")) {
		t.Error("matching MBIDs should be treated as the same identity")
	}
	if sameRelinkIdentity(rl, relinkRec("d", "rel-2", "A", "B", "")) {
		t.Error("differing MBIDs should not match even if names align")
	}
	// MBID-less on one side → fall back to name compare (case/space-insensitive).
	nameOnly := serverRelink{Album: " Bleed American ", AlbumArtist: "jimmy eat world"}
	if !sameRelinkIdentity(nameOnly, relinkRec("d", "", "Bleed American", "Jimmy Eat World", "")) {
		t.Error("MBID-less identities should compare by normalized album+artist")
	}
}

// TestApplyRelinkToRecord verifies the rewrite: identity replaced, disc-intrinsic
// facts kept, and the correction stamped as a deliberate manual override.
func TestApplyRelinkToRecord(t *testing.T) {
	rec := &DiscIdentityRecord{
		MBDiscID:     "discA",
		FreedbDiscID: "keepme",
		TrackCount:   11,
		Fingerprint:  "fp-keep",
		ReleaseMBID:  "rel-wrong",
		Album:        "Bleed American",
		AlbumArtist:  "Jimmy Eat Worl",
		Sources:      []string{"gnudb"},
		Corroborated: true,
		Confidence:   0.62,
		ConfirmedVia: "user_pick",
		RipComplete:  true,
	}
	rl := serverRelink{
		MBDiscID:    "discA",
		ReleaseMBID: "rel-correct",
		Album:       "Bleed American",
		AlbumArtist: "Jimmy Eat World",
		Date:        "2001",
		CoverURL:    "https://cover/front",
		UpdatedAt:   "2026-07-17T15:00:00Z",
	}
	applyRelinkToRecord(rl, rec)

	if rec.ReleaseMBID != "rel-correct" || rec.AlbumArtist != "Jimmy Eat World" {
		t.Errorf("identity not corrected: %q / %q", rec.AlbumArtist, rec.ReleaseMBID)
	}
	if rec.ConfirmedVia != "user_relink" || !rec.WasOverride {
		t.Errorf("correction not stamped as a relink override: via=%q override=%v", rec.ConfirmedVia, rec.WasOverride)
	}
	if rec.Confidence != 1.0 || rec.Corroborated || len(rec.Sources) != 1 || rec.Sources[0] != "manual" {
		t.Errorf("provenance not reset to a single-source manual correction: %+v", rec.Sources)
	}
	// Disc-intrinsic facts survive — the rip already happened; we only re-labeled it.
	if rec.FreedbDiscID != "keepme" || rec.Fingerprint != "fp-keep" || rec.TrackCount != 11 || !rec.RipComplete {
		t.Error("disc-intrinsic facts (TOC/fingerprint/rip_complete) must be preserved")
	}
	if rec.Date != "2001" || rec.CoverURL != "https://cover/front" {
		t.Errorf("date/cover not carried: %q / %q", rec.Date, rec.CoverURL)
	}
}
