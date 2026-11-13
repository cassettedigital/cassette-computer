package main

import "testing"

// resetDiscMemory gives each test a clean in-memory index. seedMemory marks it
// loaded so lookups don't touch the filesystem.
func resetDiscMemory() {
	discMemory = &discMemoryIndex{
		byMBDisc:    map[string]*DiscIdentityRecord{},
		byFreedb:    map[string]*DiscIdentityRecord{},
		byTOCSig:    map[string]*DiscIdentityRecord{},
		byRecording: map[string][]*DiscIdentityRecord{},
	}
}

func seedMemory(recs ...*DiscIdentityRecord) {
	resetDiscMemory()
	discMemory.loaded = true
	for _, r := range recs {
		discMemory.indexRecord(r)
	}
}

// JOB 4 — corroboration lifts a multi-source candidate once, idempotently.
func TestMarkCorroboration(t *testing.T) {
	single := &RipScoredCandidate{Confidence: 0.6, Sources: []string{"gnudb"}}
	single.markCorroboration()
	if single.Confidence != 0.6 || single.Corroborated {
		t.Errorf("single source must not boost: %.2f corroborated=%v", single.Confidence, single.Corroborated)
	}

	two := &RipScoredCandidate{Confidence: 0.6, Sources: []string{"gnudb", "mb-toc"}}
	two.markCorroboration()
	want := corroborate(0.6)
	if two.Confidence != want || !two.Corroborated {
		t.Errorf("two sources: got %.4f corroborated=%v, want %.4f true", two.Confidence, two.Corroborated, want)
	}
	two.markCorroboration() // idempotent — must not double-boost
	if two.Confidence != want {
		t.Errorf("double-applied boost: %.4f, want %.4f", two.Confidence, want)
	}

	hi := &RipScoredCandidate{Confidence: 0.95, Sources: []string{"discid", "gnudb"}}
	hi.markCorroboration()
	if hi.Confidence != 1.0 {
		t.Errorf("boost must cap at 1.0, got %.4f", hi.Confidence)
	}
}

func TestAddSourceDedup(t *testing.T) {
	s := addSource(nil, "gnudb")
	s = addSource(s, "gnudb") // dup — same source twice is not corroboration
	s = addSource(s, "mb-toc")
	if len(s) != 2 {
		t.Errorf("addSource dedup failed: %v", s)
	}
}

// JOB 7 — persist a record, then resolve it from local memory by every key it
// carries. Rebuild restores the tracklist offline.
func TestDiscIdentityRoundtrip(t *testing.T) {
	oldDir, oldState := sidecarDataDir, liveState
	t.Cleanup(func() { sidecarDataDir, liveState = oldDir, oldState })
	sidecarDataDir = t.TempDir()
	liveState = &SidecarState{SubsonicUsername: "founder"}
	resetDiscMemory()

	toc := fixtureTOC
	profile := buildDiscProfile(&toc, fixtureDiscID)
	rel := &MatchedRelease{
		ReleaseMBID: "rel-okc", Album: "OK Computer", AlbumArtist: "Radiohead", TrackCount: 12,
	}
	for i := 0; i < 12; i++ {
		pos := toc.FirstTrack + i
		rel.Tracks = append(rel.Tracks, RippedTrackMeta{
			Position: pos, Title: "Song " + itoa(pos), Artist: "Radiohead",
			RecordingMBID: "rec-" + itoa(pos),
		})
	}
	persistDiscIdentity(profile, rel, []string{"gnudb", "mb-toc"}, true, 0.92, "user_pick",
		crosswalk{gnudbID: "rock/9405ad0c", coverURL: "https://coverartarchive.org/release/rel-okc/front"}, false)

	// Lookup by MB disc ID.
	rec, via := lookupMemory(profile)
	if rec == nil {
		t.Fatal("lookupMemory missed a just-persisted disc")
	}
	if via != "mb_disc_id" {
		t.Errorf("matched via %q, want mb_disc_id", via)
	}
	if rec.Album != "OK Computer" || rec.ReleaseMBID != "rel-okc" {
		t.Errorf("record fields wrong: %+v", rec)
	}
	if !rec.Corroborated || len(rec.TrackRecordings) != 12 {
		t.Errorf("provenance/crosswalk not persisted: corroborated=%v tracks=%d", rec.Corroborated, len(rec.TrackRecordings))
	}
	if rec.GnudbID != "rock/9405ad0c" || rec.CoverURL == "" {
		t.Errorf("crosswalk gnudb/cover not persisted: gnudb=%q cover=%q", rec.GnudbID, rec.CoverURL)
	}

	// Lookup by freedb ID alone (a re-press with no MB disc ID computed).
	byFreedb := &DiscProfile{FreedbDiscID: profile.FreedbDiscID}
	if r, _ := lookupMemory(byFreedb); r == nil {
		t.Error("lookup by freedb_disc_id missed")
	}

	// Offline rebuild restores titles + recording MBIDs.
	got := rec.toMatchedRelease(&toc, nil)
	if len(got.Tracks) != 12 || got.Tracks[0].Title != "Song 1" || got.Tracks[0].RecordingMBID != "rec-1" {
		t.Errorf("toMatchedRelease rebuild wrong: %+v", got.Tracks[0])
	}
}

// A multi-disc set's disc position must survive persist → local_memory →
// toMatchedRelease. Regression guard: MediumPos was computed by the disc-id rung,
// dropped at persist, and restored as 0 — so every remembered rip re-tagged
// DISCNUMBER=1 and both discs of a 2-CD set (e.g. Hozier studio + extras)
// collapsed onto "Disc 1". The rip pass tags off this rebuilt release.
func TestMediumPositionSurvivesMemory(t *testing.T) {
	oldDir, oldState := sidecarDataDir, liveState
	t.Cleanup(func() { sidecarDataDir, liveState = oldDir, oldState })
	sidecarDataDir = t.TempDir()
	liveState = &SidecarState{SubsonicUsername: "founder"}
	resetDiscMemory()

	toc := fixtureTOC
	profile := buildDiscProfile(&toc, fixtureDiscID)
	rel := &MatchedRelease{
		ReleaseMBID: "rel-set", Album: "Hozier", AlbumArtist: "Hozier", TrackCount: 12,
		MediumPos: 2, MediumCount: 2, MediumTitle: "Extras",
	}
	for i := 0; i < 12; i++ {
		pos := toc.FirstTrack + i
		rel.Tracks = append(rel.Tracks, RippedTrackMeta{
			Position: pos, Title: "Song " + itoa(pos), Artist: "Hozier",
			RecordingMBID: "rec-" + itoa(pos),
		})
	}
	persistDiscIdentity(profile, rel, []string{"discid"}, false, 1.0, "auto", crosswalk{}, false)

	rec, _ := lookupMemory(profile)
	if rec == nil {
		t.Fatal("lookupMemory missed a just-persisted disc")
	}
	if rec.MediumPos != 2 || rec.MediumCount != 2 || rec.MediumTitle != "Extras" {
		t.Fatalf("medium position not persisted: pos=%d count=%d title=%q",
			rec.MediumPos, rec.MediumCount, rec.MediumTitle)
	}
	// The offline rebuild is what the RIP pass actually tags DISCNUMBER from.
	got := rec.toMatchedRelease(&toc, nil)
	if got.MediumPos != 2 || got.MediumCount != 2 || got.MediumTitle != "Extras" {
		t.Fatalf("toMatchedRelease dropped medium position (would tag DISCNUMBER=1): pos=%d count=%d title=%q",
			got.MediumPos, got.MediumCount, got.MediumTitle)
	}
}

// JOB 7 — the existing contribution audit log is backfilled into the index so
// discs identified before this feature are recognized on the next insert.
func TestBackfillRecognizesContribution(t *testing.T) {
	oldDir, oldState := sidecarDataDir, liveState
	t.Cleanup(func() { sidecarDataDir, liveState = oldDir, oldState })
	sidecarDataDir = t.TempDir()
	liveState = &SidecarState{SubsonicUsername: "founder"}
	resetDiscMemory()

	// Bank a contribution the old way (no disc-identity record written).
	toc := fixtureTOC
	dr := &detectResult{toc: &toc, discID: fixtureDiscID, res: &RipResolution{}}
	captureMatchContribution(dr, &MatchedRelease{
		ReleaseMBID: "rel-eve6", Album: "Eve 6", AlbumArtist: "Eve 6", TrackCount: 12,
	}, "acoustid", 0.9)

	// Fresh index (loaded=false) must backfill it from the contributions file.
	resetDiscMemory()
	rec, via := lookupMemory(buildDiscProfile(&toc, fixtureDiscID))
	if rec == nil {
		t.Fatal("backfill did not recognize a previously-identified disc")
	}
	if rec.Album != "Eve 6" || rec.ConfirmedVia != "backfill" {
		t.Errorf("backfilled record wrong: album=%q via=%q (matched %s)", rec.Album, rec.ConfirmedVia, via)
	}
}

// JOB 7 — pressings that share a recording MBID join one cross-pressing cluster
// even when their disc/freedb IDs differ.
func TestCrossPressingCluster(t *testing.T) {
	oldDir, oldState := sidecarDataDir, liveState
	t.Cleanup(func() { sidecarDataDir, liveState = oldDir, oldState })
	sidecarDataDir = t.TempDir()
	liveState = &SidecarState{}
	resetDiscMemory()

	// Pressing A: 12 tracks.
	tocA := fixtureTOC
	profA := buildDiscProfile(&tocA, "discA")
	relA := &MatchedRelease{ReleaseMBID: "rel-A", Album: "Album", AlbumArtist: "Artist", TrackCount: 12}
	relA.Tracks = []RippedTrackMeta{{Position: 1, Title: "T1", RecordingMBID: "shared-rec-1"}}
	persistDiscIdentity(profA, relA, []string{"mb-toc"}, false, 0.85, "user_pick", crosswalk{}, false)

	// Pressing B: different TOC/disc ID, but shares recording shared-rec-1.
	tocB := fixtureTOC
	tocB.LeadoutOffset += 9000 // a genuinely different table of contents
	tocB.TrackOffsets = append([]int(nil), tocB.TrackOffsets...)
	tocB.TrackOffsets[5] += 4000
	profB := buildDiscProfile(&tocB, "discB")
	relB := &MatchedRelease{ReleaseMBID: "rel-B", Album: "Album", AlbumArtist: "Artist", TrackCount: 12}
	relB.Tracks = []RippedTrackMeta{{Position: 1, Title: "T1", RecordingMBID: "shared-rec-1"}}
	persistDiscIdentity(profB, relB, []string{"acoustid"}, false, 0.85, "acoustid", crosswalk{}, false)

	a, _ := lookupMemory(profA)
	b, _ := lookupMemory(profB)
	if a == nil || b == nil {
		t.Fatal("both pressings should be in memory")
	}
	if a.ClusterID == "" || a.ClusterID != b.ClusterID {
		t.Errorf("shared recording must link clusters: A=%q B=%q", a.ClusterID, b.ClusterID)
	}
}

// JOB 1 — clusterID is a pure function of the recording SET: independent of track
// order, release MBID, and insertion order (the old order-dependence that
// fragmented across machines is gone). Fallbacks intact when recordings are absent.
func TestClusterIDDeterministic(t *testing.T) {
	recA := &DiscIdentityRecord{
		MBDiscID:    "disc-A",
		ReleaseMBID: "rel-A",
		TrackRecordings: []TrackRecording{
			{Position: 1, RecordingMBID: "rec-c"},
			{Position: 2, RecordingMBID: "rec-a"},
			{Position: 3, RecordingMBID: "rec-b"},
		},
	}
	// Pressing B: a different disc + release, the SAME recordings in a different order.
	recB := &DiscIdentityRecord{
		MBDiscID:    "disc-B",
		ReleaseMBID: "rel-B",
		TrackRecordings: []TrackRecording{
			{Position: 1, RecordingMBID: "rec-a"},
			{Position: 2, RecordingMBID: "rec-b"},
			{Position: 3, RecordingMBID: "rec-c"},
		},
	}
	idA, idB := clusterID(recA), clusterID(recB)
	if idA != idB {
		t.Fatalf("same recording set must cluster identically regardless of order/release: A=%q B=%q", idA, idB)
	}
	if len(idA) < 4 || idA[:4] != clusterPrefixRecordings {
		t.Fatalf("recording-keyed id must use %q prefix: %q", clusterPrefixRecordings, idA)
	}
	// Fallback: no recordings + release MBID → rel:.
	if got := clusterID(&DiscIdentityRecord{ReleaseMBID: "rel-X"}); got != clusterPrefixRelease+"rel-X" {
		t.Fatalf("no recordings + release must seed rel:: got %q", got)
	}
	// Fallback: no recordings, no release → recordKey() (mb: here).
	if got := clusterID(&DiscIdentityRecord{MBDiscID: "disc-Z"}); got != "mb:disc-Z" {
		t.Fatalf("no recordings, no release must fall back to recordKey(): got %q", got)
	}
}

// JOB 2 — the one-time recompute rewrites stale rel:-prefixed ids onto the
// deterministic scheme, preserves membership, and is idempotent.
func TestRecomputeClusterIDsRewritesStaleIDs(t *testing.T) {
	old := sidecarDataDir
	t.Cleanup(func() { sidecarDataDir = old })
	sidecarDataDir = t.TempDir()

	// Two pressings of one album (shared recording set) written with the OLD,
	// per-release cluster ids.
	stale := []DiscIdentityRecord{
		{MBDiscID: "d1", ReleaseMBID: "rel-A", ClusterID: "rel:rel-A",
			TrackRecordings: []TrackRecording{{Position: 1, RecordingMBID: "rec-1"}}},
		{MBDiscID: "d2", ReleaseMBID: "rel-B", ClusterID: "rel:rel-B",
			TrackRecordings: []TrackRecording{{Position: 1, RecordingMBID: "rec-1"}}},
	}
	for _, r := range stale {
		if err := appendDiscIdentity(r); err != nil {
			t.Fatal(err)
		}
	}

	recomputeClusterIDs()

	got := loadDiscIdentities()
	if len(got) != 2 {
		t.Fatalf("recompute must preserve record count: got %d", len(got))
	}
	want := clusterID(&stale[0]) // both share recording set {rec-1} → one cluster
	for _, r := range got {
		if r.ClusterID != want {
			t.Errorf("record %s: cluster_id %q not recomputed to %q", r.MBDiscID, r.ClusterID, want)
		}
	}

	// Idempotent: a second run rewrites nothing and keeps the same ids.
	recomputeClusterIDs()
	again := loadDiscIdentities()
	if len(again) != 2 || again[0].ClusterID != want || again[1].ClusterID != want {
		t.Fatalf("recompute must be idempotent: %+v", again)
	}
}

// Layer 3 — when several contribution rows share a disc but only a later one
// carries the MBID, the backfill must surface the MBID-bearing record (the Eve 6
// bug: an early ""-MBID row was shadowing the MBID row).
func TestBackfillPrefersRichest(t *testing.T) {
	oldDir, oldState := sidecarDataDir, liveState
	t.Cleanup(func() { sidecarDataDir, liveState = oldDir, oldState })
	sidecarDataDir = t.TempDir()
	liveState = &SidecarState{}
	resetDiscMemory()

	toc := fixtureTOC
	dr := &detectResult{toc: &toc, discID: fixtureDiscID, res: &RipResolution{}}
	// Two earlier MBID-less rows, then the row that actually carries the MBID.
	captureMatchContribution(dr, &MatchedRelease{Album: "It's All In Your Head", AlbumArtist: "Eve 6"}, "manual", 1.0)
	captureMatchContribution(dr, &MatchedRelease{Album: "It's All In Your Head", AlbumArtist: "Eve 6"}, "manual", 1.0)
	captureMatchContribution(dr, &MatchedRelease{ReleaseMBID: "10837a8a-mbid", Album: "It's All In Your Head", AlbumArtist: "Eve 6"}, "local_memory", 0.97)

	resetDiscMemory()
	rec, _ := lookupMemory(buildDiscProfile(&toc, fixtureDiscID))
	if rec == nil {
		t.Fatal("backfill did not surface any record")
	}
	if rec.ReleaseMBID != "10837a8a-mbid" {
		t.Errorf("backfill surfaced an MBID-less row (%q); the richest row should win", rec.ReleaseMBID)
	}
}

// Rung ZERO short-circuits before any network call: a seeded disc resolves from
// local_memory and the CD-TEXT reader is never invoked.
func TestResolveDiscRungZero(t *testing.T) {
	toc := fixtureTOC
	seedMemory(&DiscIdentityRecord{
		MBDiscID: fixtureDiscID, Album: "Known Album", AlbumArtist: "Known Artist",
		ReleaseMBID: "rel-known", TrackCount: 12,
	})

	ctReads := 0
	res, profile := resolveDisc(&toc, fixtureDiscID, func() *CDText { ctReads++; return nil })

	if profile == nil {
		t.Fatal("resolveDisc must return a profile")
	}
	if res.Release == nil || res.Release.Album != "Known Album" {
		t.Fatalf("rung-zero did not resolve from memory: %+v", res.Release)
	}
	if res.Confidence != localMemoryConfidence {
		t.Errorf("confidence = %.2f, want %.2f", res.Confidence, localMemoryConfidence)
	}
	if len(res.Candidates) == 0 || res.Candidates[0].Source != "local_memory" {
		t.Errorf("source not local_memory: %+v", res.Candidates)
	}
	if ctReads != 0 {
		t.Errorf("rung zero must precede any disc read; CD-TEXT read %d times", ctReads)
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	if neg {
		b = append([]byte{'-'}, b...)
	}
	return string(b)
}
