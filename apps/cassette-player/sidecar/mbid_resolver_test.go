// Unit tests for Layer 1.5 resolver hardening.
//
// Covers the four pure-function pieces:
//   - migrateLegacyCacheEntries: Layer 1 cache rows → Layer 1.5 schema
//   - shouldSkipCachedEntry: walker's per-file skip gate
//   - recomputeStats: aggregate snapshot from the state map
//   - passBudgetFor: burst-budget gate on first sync
//
// No MusicBrainz calls, no disk I/O.

package main

import (
	"testing"
	"time"
)

// ─── migrateLegacyCacheEntries ───────────────────────────────────────────

func TestMigrateLegacyCacheEntries_resolvedRow(t *testing.T) {
	now := time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC)
	legacyAttempt := now.Add(-48 * time.Hour)
	state := &SidecarState{
		MBIDResolutionState: map[string]*MBIDFileState{
			"/music/a.flac": {
				Resolved:      true,
				MBID:          "abc-123",
				LocalID:       "local-1",
				LastAttemptAt: legacyAttempt,
			},
		},
	}
	if !migrateLegacyCacheEntries(state, now) {
		t.Fatal("expected migration to report changes")
	}
	got := state.MBIDResolutionState["/music/a.flac"]
	if got.Reason != ReasonResolved {
		t.Errorf("Reason = %q; want %q", got.Reason, ReasonResolved)
	}
	if !got.RetryAfter.IsZero() {
		t.Errorf("RetryAfter = %v; want zero (resolved rows don't retry)", got.RetryAfter)
	}
	if !got.AttemptedAt.Equal(legacyAttempt) {
		t.Errorf("AttemptedAt = %v; want migrated from LastAttemptAt %v", got.AttemptedAt, legacyAttempt)
	}
	if !got.LastAttemptAt.IsZero() {
		t.Errorf("LastAttemptAt should be cleared after migration")
	}
}

func TestMigrateLegacyCacheEntries_tagWriteFailedRow(t *testing.T) {
	now := time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC)
	state := &SidecarState{
		MBIDResolutionState: map[string]*MBIDFileState{
			"/music/b.flac": {Resolved: false, MBID: "mbid-known"},
		},
	}
	migrateLegacyCacheEntries(state, now)
	got := state.MBIDResolutionState["/music/b.flac"]
	if got.Reason != ReasonTagWriteFailed {
		t.Errorf("Reason = %q; want %q (MBID set but write must have failed)", got.Reason, ReasonTagWriteFailed)
	}
	if !got.RetryAfter.IsZero() {
		t.Errorf("RetryAfter = %v; want zero (immediate retry)", got.RetryAfter)
	}
}

func TestMigrateLegacyCacheEntries_noMatchRow(t *testing.T) {
	now := time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC)
	state := &SidecarState{
		MBIDResolutionState: map[string]*MBIDFileState{
			"/music/c.flac": {Resolved: false, MBID: ""},
		},
	}
	migrateLegacyCacheEntries(state, now)
	got := state.MBIDResolutionState["/music/c.flac"]
	if got.Reason != ReasonNoMatch {
		t.Errorf("Reason = %q; want %q", got.Reason, ReasonNoMatch)
	}
	wantRetry := now.Add(resolverLegacyMigrationWait)
	if !got.RetryAfter.Equal(wantRetry) {
		t.Errorf("RetryAfter = %v; want %v (now + 7d migration grace)", got.RetryAfter, wantRetry)
	}
}

func TestMigrateLegacyCacheEntries_idempotent(t *testing.T) {
	now := time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC)
	state := &SidecarState{
		MBIDResolutionState: map[string]*MBIDFileState{
			"/x": {Resolved: false, Reason: ReasonNoMatch, RetryAfter: now.Add(30 * 24 * time.Hour)},
		},
	}
	if migrateLegacyCacheEntries(state, now) {
		t.Error("migration should be a no-op when Reason is already set")
	}
	got := state.MBIDResolutionState["/x"]
	if !got.RetryAfter.Equal(now.Add(30 * 24 * time.Hour)) {
		t.Errorf("RetryAfter unexpectedly mutated: %v", got.RetryAfter)
	}
}

func TestMigrateLegacyCacheEntries_nilSafety(t *testing.T) {
	if migrateLegacyCacheEntries(nil, time.Now()) {
		t.Error("nil state should report no changes")
	}
	empty := &SidecarState{}
	if migrateLegacyCacheEntries(empty, time.Now()) {
		t.Error("nil state map should report no changes")
	}
}

// ─── shouldSkipCachedEntry ───────────────────────────────────────────────

func TestShouldSkipCachedEntry_tableDriven(t *testing.T) {
	now := time.Date(2026, 5, 27, 12, 0, 0, 0, time.UTC)
	past := now.Add(-time.Hour)
	future := now.Add(time.Hour)
	mtime := now.Add(-24 * time.Hour)
	differentMtime := mtime.Add(time.Minute)

	tests := []struct {
		name         string
		entry        *MBIDFileState
		currentMtime time.Time
		want         bool
	}{
		{"nil entry — never skip", nil, mtime, false},
		{
			"resolved + mtime match",
			&MBIDFileState{Reason: ReasonResolved, FileModifiedAt: mtime},
			mtime, true,
		},
		{
			"resolved + mtime drift → invalidate",
			&MBIDFileState{Reason: ReasonResolved, FileModifiedAt: mtime},
			differentMtime, false,
		},
		{
			"insufficient_tags + mtime match",
			&MBIDFileState{Reason: ReasonInsufficientTags, FileModifiedAt: mtime},
			mtime, true,
		},
		{
			"insufficient_tags + mtime drift → re-check",
			&MBIDFileState{Reason: ReasonInsufficientTags, FileModifiedAt: mtime},
			differentMtime, false,
		},
		{
			"no_match + future RetryAfter → skip",
			&MBIDFileState{Reason: ReasonNoMatch, RetryAfter: future, FileModifiedAt: mtime},
			mtime, true,
		},
		{
			"no_match + past RetryAfter → eligible",
			&MBIDFileState{Reason: ReasonNoMatch, RetryAfter: past, FileModifiedAt: mtime},
			mtime, false,
		},
		{
			"tag_write_failed → always eligible",
			&MBIDFileState{Reason: ReasonTagWriteFailed, MBID: "abc", FileModifiedAt: mtime},
			mtime, false,
		},
		{
			"zero FileModifiedAt baseline → mtime gate skipped",
			&MBIDFileState{Reason: ReasonResolved},
			mtime, true,
		},
		{
			"unknown reason → conservative retry",
			&MBIDFileState{Reason: "weird", FileModifiedAt: mtime},
			mtime, false,
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			got := shouldSkipCachedEntry(tc.entry, tc.currentMtime, now)
			if got != tc.want {
				t.Errorf("shouldSkipCachedEntry = %v; want %v", got, tc.want)
			}
		})
	}
}

// ─── recomputeStats ──────────────────────────────────────────────────────

func TestRecomputeStats_counts(t *testing.T) {
	now := time.Now()
	state := &SidecarState{
		MBIDResolutionState: map[string]*MBIDFileState{
			"/a": {Reason: ReasonResolved, MBID: "x"},
			"/b": {Reason: ReasonResolved, MBID: "y"},
			"/c": {Reason: ReasonNoMatch, RetryAfter: now.Add(24 * time.Hour)},   // not due
			"/d": {Reason: ReasonNoMatch, RetryAfter: now.Add(-24 * time.Hour)},  // due → pending
			"/e": {Reason: ReasonInsufficientTags},
			"/f": {Reason: ReasonTagWriteFailed, MBID: "z"},                       // always pending
			"/g": nil,                                                              // ignored
		},
	}
	recomputeStats(state, 17, 42*time.Second)
	s := state.MBIDResolutionStats

	if s.TotalFilesSeen != 6 {
		t.Errorf("TotalFilesSeen = %d; want 6", s.TotalFilesSeen)
	}
	if s.ResolvedWithMBID != 2 {
		t.Errorf("ResolvedWithMBID = %d; want 2", s.ResolvedWithMBID)
	}
	if s.NoMatchCached != 2 {
		t.Errorf("NoMatchCached = %d; want 2", s.NoMatchCached)
	}
	if s.InsufficientTags != 1 {
		t.Errorf("InsufficientTags = %d; want 1", s.InsufficientTags)
	}
	if s.PendingRetry != 2 {
		t.Errorf("PendingRetry = %d; want 2 (one due no_match + one tag_write_failed)", s.PendingRetry)
	}
	if s.LastPassQueries != 17 {
		t.Errorf("LastPassQueries = %d; want 17", s.LastPassQueries)
	}
	if s.LastPassDuration != "42s" {
		t.Errorf("LastPassDuration = %q; want %q", s.LastPassDuration, "42s")
	}
	if s.LastPassAt.IsZero() {
		t.Error("LastPassAt should be set to now")
	}
}

// ─── passBudgetFor ───────────────────────────────────────────────────────

func TestPassBudgetFor_firstPassBurst(t *testing.T) {
	state := &SidecarState{MBIDResolutionState: map[string]*MBIDFileState{}}
	for i := 0; i < resolverFirstPassStateThreshold-1; i++ {
		state.MBIDResolutionState[string(rune('a')+rune(i%26))+string(rune('0')+rune(i/26))] = &MBIDFileState{Reason: ReasonResolved}
	}
	budget, timeout := passBudgetFor(state)
	if budget != resolverMaxQueriesFirstPass {
		t.Errorf("budget = %d; want %d (first-pass burst)", budget, resolverMaxQueriesFirstPass)
	}
	if timeout != resolverContextTimeoutFirstPass {
		t.Errorf("timeout = %v; want %v", timeout, resolverContextTimeoutFirstPass)
	}
}

func TestPassBudgetFor_steadyState(t *testing.T) {
	state := &SidecarState{MBIDResolutionState: map[string]*MBIDFileState{}}
	for i := 0; i < resolverFirstPassStateThreshold+5; i++ {
		key := string(rune('a')+rune(i%26)) + string(rune('A')+rune((i/26)%26))
		state.MBIDResolutionState[key] = &MBIDFileState{Reason: ReasonResolved}
	}
	budget, timeout := passBudgetFor(state)
	if budget != resolverMaxQueriesPerPass {
		t.Errorf("budget = %d; want %d (steady state)", budget, resolverMaxQueriesPerPass)
	}
	if timeout != resolverContextTimeoutSteady {
		t.Errorf("timeout = %v; want %v", timeout, resolverContextTimeoutSteady)
	}
}

func TestPassBudgetFor_nilStateIsFirstPass(t *testing.T) {
	budget, timeout := passBudgetFor(nil)
	if budget != resolverMaxQueriesFirstPass {
		t.Errorf("nil state should be treated as first pass; budget = %d", budget)
	}
	if timeout != resolverContextTimeoutFirstPass {
		t.Errorf("nil state timeout = %v", timeout)
	}
}
