package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

// The live ingest report (ingest-progress.go): the bookkeeping is tested alone,
// with no network and no Navidrome.

func TestIngestPassStagesAndCounts(t *testing.T) {
	var p ingestPass
	if s := p.snapshot(); s.State != "idle" || s.Stage != "" {
		t.Fatalf("zero pass = %+v, want idle with no stage", s)
	}

	p.begin()
	s := p.snapshot()
	if s.State != "scanning" || s.Stage != ingestStageScanning || s.Total != 0 || s.Checked != 0 {
		t.Fatalf("after begin = %+v, want scanning with nothing counted", s)
	}

	p.setStage(ingestStageLookingUp)
	p.planLookups([]string{"/m/a.flac", "/m/b.flac", "/m/c.flac"})
	s = p.snapshot()
	if s.State != "working" || s.Stage != ingestStageLookingUp || s.Total != 3 || s.Checked != 0 || s.Identified != 0 {
		t.Fatalf("planned = %+v, want working/lookingUp, total 3, nothing checked", s)
	}

	p.noteLookup("/m/a.flac", true)
	p.noteLookup("/m/b.flac", false)
	s = p.snapshot()
	if s.Total != 3 || s.Checked != 2 || s.Identified != 1 {
		t.Fatalf("two lookups = %+v, want total 3, checked 2, identified 1", s)
	}
	p.noteLookup("/m/a.flac", true) // the same outcome again counts once
	if s = p.snapshot(); s.Checked != 2 || s.Identified != 1 {
		t.Fatalf("repeat lookup = %+v, want checked 2, identified 1", s)
	}

	// The run ends before reaching c (budget or time): c drops out of the total.
	p.finishLookups()
	s = p.snapshot()
	if s.State != "working" || s.Stage != ingestStageSaving || s.Total != 2 || s.Checked != 2 || s.Identified != 1 {
		t.Fatalf("finished = %+v, want working/saving, total 2, checked 2, identified 1", s)
	}

	// Once a sync lands, total/identified carry the library-wide numbers as before.
	p.noteSynced(500, 420)
	s = p.snapshot()
	if s.Count != 500 || s.Total != 500 || s.Identified != 420 || s.Checked != 2 {
		t.Fatalf("synced = %+v, want count/total 500, identified 420, checked 2", s)
	}

	p.finish(501, 421)
	s = p.snapshot()
	if s.State != "done" || s.Stage != ingestStageDone || s.Count != 501 || s.Total != 501 || s.Identified != 421 || s.Checked != 2 {
		t.Fatalf("done = %+v, want done with the last sync's numbers and checked 2", s)
	}
}

// The second resolver run of an ingest (after the tag-write rescan) picks up the
// songs the first one's budget didn't reach and retries the ones it couldn't
// reach MusicBrainz for. Neither is counted twice.
func TestIngestPassSecondRunCountsOnce(t *testing.T) {
	var p ingestPass
	p.begin()
	p.setStage(ingestStageLookingUp)
	p.planLookups([]string{"/m/a.flac", "/m/b.flac"})
	p.noteLookup("/m/a.flac", false) // MusicBrainz was down
	p.finishLookups()                // b never reached
	p.noteSynced(100, 90)
	p.setStage(ingestStageSaving)

	// A run that only retries a song already checked stays quietly on saving.
	p.planLookups([]string{"/m/a.flac"})
	if s := p.snapshot(); s.Stage != ingestStageSaving || s.Total != 100 {
		t.Fatalf("retry-only run = %+v, want saving with the library numbers", s)
	}

	// A run with a song not yet looked up goes back to lookingUp.
	p.planLookups([]string{"/m/a.flac", "/m/b.flac"})
	s := p.snapshot()
	if s.Stage != ingestStageLookingUp || s.Total != 2 || s.Checked != 1 || s.Identified != 0 || s.Count != 100 {
		t.Fatalf("second run = %+v, want lookingUp, total 2, checked 1, count 100", s)
	}
	p.noteLookup("/m/a.flac", true) // found this time: identified, not checked again
	p.noteLookup("/m/b.flac", true)
	s = p.snapshot()
	if s.Checked != 2 || s.Identified != 2 {
		t.Fatalf("second run lookups = %+v, want checked 2, identified 2", s)
	}
	p.noteLookup("/m/a.flac", false) // found stays found
	if s = p.snapshot(); s.Identified != 2 {
		t.Fatalf("found song reported missing = %+v, want identified 2", s)
	}
	p.finishLookups()
	if s = p.snapshot(); s.Stage != ingestStageSaving || s.Total != 100 || s.Identified != 90 {
		t.Fatalf("after second run = %+v, want saving with the library numbers", s)
	}
}

func TestIngestPassErrorKeepsOldMeaning(t *testing.T) {
	var p ingestPass
	p.begin()
	p.setStage(ingestStageLookingUp)
	p.addNewSongs([]ingestSong{{ID: "t1", Path: "/m/a.flac", Album: "A", Artist: "X"}})
	p.planLookups([]string{"/m/a.flac", "/m/b.flac"})
	p.noteLookup("/m/a.flac", true)
	p.fail()
	s := p.snapshot()
	if s.State != "error" || s.Stage != ingestStageError || s.Count != 0 || s.Total != 0 || s.Identified != 0 {
		t.Fatalf("error = %+v, want error with count/total/identified 0 as before", s)
	}
	if s.Checked != 1 || len(s.Albums) != 1 || !s.Albums[0].Found {
		t.Fatalf("error = %+v, want checked and the records kept", s)
	}
}

func TestIngestPassAlbumsCappedInOrderAndFlipFound(t *testing.T) {
	var p ingestPass
	p.begin()
	var songs []ingestSong
	for a := 1; a <= 10; a++ {
		for n := 1; n <= 2; n++ {
			songs = append(songs, ingestSong{
				ID:     fmt.Sprintf("t%d-%d", a, n),
				Path:   fmt.Sprintf("/m/Album %02d/%02d.flac", a, n),
				Album:  fmt.Sprintf("Album %02d", a),
				Artist: "Band",
				HasID:  a == 2 && n == 2, // one song of album 2 arrived already tagged
			})
		}
	}
	// The same record spelled differently is still one record.
	songs = append(songs, ingestSong{ID: "t1-3", Path: "/m/Album 01/03.flac", Album: "ALBUM 01", Artist: "band"})
	p.addNewSongs(songs)

	s := p.snapshot()
	if len(s.Albums) != ingestAlbumsMax {
		t.Fatalf("albums = %d, want %d", len(s.Albums), ingestAlbumsMax)
	}
	for i, a := range s.Albums {
		want := fmt.Sprintf("Album %02d", i+1)
		if a.Album != want || a.Artist != "Band" || a.TrackID != fmt.Sprintf("t%d-1", i+1) {
			t.Fatalf("album %d = %+v, want %s by Band with its first song's id", i, a, want)
		}
		if a.Found != (i == 1) {
			t.Fatalf("album %d found = %v, want only album 2 (already tagged) found", i, a.Found)
		}
	}

	p.setStage(ingestStageLookingUp)
	p.planLookups([]string{"/m/Album 03/01.flac", "/m/Album 04/01.flac", "/m/Album 09/01.flac", "/m/Album 01/03.flac"})
	p.noteLookup("/m/Album 03/01.flac", true)
	p.noteLookup("/m/Album 04/01.flac", false)
	p.noteLookup("/m/Album 09/01.flac", true) // past the cap: counted, no record added
	p.noteLookup("/m/Album 01/03.flac", true) // the differently spelled song flips album 1
	s = p.snapshot()
	if len(s.Albums) != ingestAlbumsMax || s.Identified != 3 || s.Checked != 4 {
		t.Fatalf("after lookups = %+v, want 8 albums, identified 3, checked 4", s)
	}
	gotFound := []bool{}
	for _, a := range s.Albums {
		gotFound = append(gotFound, a.Found)
	}
	if want := []bool{true, true, true, false, false, false, false, false}; !reflect.DeepEqual(gotFound, want) {
		t.Fatalf("found = %v, want %v", gotFound, want)
	}
}

// The resolver walks the folder; Navidrome reports the same file. A name can
// come back in another Unicode form, so the paths are matched by key.
func TestIngestPassMatchesPathsAcrossUnicodeForms(t *testing.T) {
	var p ingestPass
	p.begin()
	p.addNewSongs([]ingestSong{{ID: "t1", Path: "/m/Café/01.flac", Album: "Café", Artist: "X"}})
	p.setStage(ingestStageLookingUp)
	p.planLookups([]string{"/m/Café/01.flac"})
	p.noteLookup("/m/Café/01.flac", true)
	if s := p.snapshot(); !s.Albums[0].Found {
		t.Fatalf("album not found across Unicode forms: %+v", s)
	}
}

func TestIngestPassBeginResetsEverything(t *testing.T) {
	var p ingestPass
	p.begin()
	p.addNewSongs([]ingestSong{{ID: "t1", Path: "/m/a.flac", Album: "A", Artist: "X"}})
	p.setStage(ingestStageLookingUp)
	p.planLookups([]string{"/m/a.flac"})
	p.noteLookup("/m/a.flac", true)
	p.finishLookups()
	p.finish(10, 9)

	p.begin()
	s := p.snapshot()
	want := ingestProgress{State: "scanning", Stage: ingestStageScanning}
	if !reflect.DeepEqual(s, want) {
		t.Fatalf("after a second begin = %+v, want %+v", s, want)
	}
	// The old ingest's songs are gone: a lookup of one counts fresh.
	p.setStage(ingestStageLookingUp)
	p.planLookups([]string{"/m/a.flac"})
	if s = p.snapshot(); s.Total != 1 || s.Checked != 0 || s.Identified != 0 || len(s.Albums) != 0 {
		t.Fatalf("new ingest = %+v, want a fresh count", s)
	}
}

func TestIngestSnapshotAlbumsAreACopy(t *testing.T) {
	var p ingestPass
	p.begin()
	p.addNewSongs([]ingestSong{{ID: "t1", Path: "/m/a.flac", Album: "A", Artist: "X"}})
	s := p.snapshot()
	p.setStage(ingestStageLookingUp)
	p.planLookups([]string{"/m/a.flac"})
	p.noteLookup("/m/a.flac", true)
	if s.Albums[0].Found {
		t.Fatal("a snapshot taken earlier changed under its reader")
	}
}

// The JSON the window reads: every old field keeps its name, the new ones are
// stage, checked and albums. An idle hub says exactly what it said before.
func TestIngestProgressJSON(t *testing.T) {
	var p ingestPass
	idle, err := json.Marshal(p.snapshot())
	if err != nil {
		t.Fatal(err)
	}
	if string(idle) != `{"state":"idle","at":"0001-01-01T00:00:00Z"}` {
		t.Fatalf("idle JSON = %s", idle)
	}

	p.begin()
	p.setStage(ingestStageLookingUp)
	p.addNewSongs([]ingestSong{
		{ID: "nd-1", Path: "/m/A/01.flac", Album: "Blue", Artist: "Joni Mitchell"},
		{ID: "nd-9", Path: "/m/B/01.flac", Album: "Hejira", Artist: "Joni Mitchell"},
	})
	p.planLookups([]string{"/m/A/01.flac", "/m/A/02.flac", "/m/B/01.flac"})
	p.noteLookup("/m/A/01.flac", true)
	p.at = time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	got, err := json.Marshal(p.snapshot())
	if err != nil {
		t.Fatal(err)
	}
	want := `{"state":"working","stage":"lookingUp","total":3,"checked":1,"identified":1,` +
		`"albums":[{"album":"Blue","artist":"Joni Mitchell","trackId":"nd-1","found":true},` +
		`{"album":"Hejira","artist":"Joni Mitchell","trackId":"nd-9","found":false}],` +
		`"at":"2026-11-20T12:00:00Z"}`
	if string(got) != want {
		t.Fatalf("mid-lookup JSON =\n%s\nwant\n%s", got, want)
	}
}

func TestIngestNewSongs(t *testing.T) {
	str := func(s string) *string { return &s }
	tracks := []librarySyncTrack{
		{SubsonicTrackID: "old", Path: "/m/Old/01.flac", AlbumName: "Old", ArtistName: "Was Here"},
		{SubsonicTrackID: "n2", Path: "/m/B/02.flac", AlbumName: "B", ArtistName: "Solo"},
		{SubsonicTrackID: "n1", Path: "/m/A/01.flac", AlbumName: "A", ArtistName: "Feat Guy", AlbumArtist: str("The Band"), MusicBrainzRecordingID: str("mbid")},
		{SubsonicTrackID: "n3", Path: "/m/A/03.m4a", AlbumName: "A", ArtistName: "Feat Guy", AlbumArtist: str("The Band")},
		{SubsonicTrackID: "", Path: "/m/A/04.flac", AlbumName: "A"},
	}
	records := map[string][2]bool{ // path → seen, holds a match
		"/m/Old/01.flac": {true, true},
		"/m/A/03.m4a":    {true, true},
	}
	record := func(path string) (bool, bool) { r := records[path]; return r[0], r[1] }

	// Against the last sync: everything it didn't report is new, in path order.
	got := ingestNewSongs(tracks, map[string]struct{}{"old": {}}, record)
	want := []ingestSong{
		{ID: "n1", Path: "/m/A/01.flac", Album: "A", Artist: "The Band", HasID: true},
		{ID: "n3", Path: "/m/A/03.m4a", Album: "A", Artist: "The Band", HasID: true},
		{ID: "n2", Path: "/m/B/02.flac", Album: "B", Artist: "Solo"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("against last sync:\n got %+v\nwant %+v", got, want)
	}

	// Nothing synced since the hub started: new = files the resolver has no record of.
	got = ingestNewSongs(tracks, nil, record)
	want = []ingestSong{
		{ID: "n1", Path: "/m/A/01.flac", Album: "A", Artist: "The Band", HasID: true},
		{ID: "n2", Path: "/m/B/02.flac", Album: "B", Artist: "Solo"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("no last sync:\n got %+v\nwant %+v", got, want)
	}
}

// The live setters are safe to call while the window reads the report.
func TestLiveIngestProgressConcurrentReads(t *testing.T) {
	t.Cleanup(func() { updateIngest(func(p *ingestPass) { *p = ingestPass{} }) })
	updateIngest(func(p *ingestPass) {
		p.begin()
		p.addNewSongs([]ingestSong{{ID: "t0", Path: "/m/0/00.flac", Album: "0", Artist: "X"}})
		p.setStage(ingestStageLookingUp)
	})
	var paths []string
	for i := 0; i < 200; i++ {
		paths = append(paths, fmt.Sprintf("/m/%d/%02d.flac", i%3, i))
	}
	report := liveIngestProgress{}
	report.lookupsPlanned(paths)

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for _, p := range paths {
			report.lookupChecked(p, true)
		}
		report.lookupsFinished()
	}()
	for i := 0; i < 200; i++ {
		if _, err := json.Marshal(ingestSnapshot()); err != nil {
			t.Fatal(err)
		}
	}
	wg.Wait()
	s := ingestSnapshot()
	if s.Stage != ingestStageSaving || s.Total != 200 || s.Checked != 200 || s.Identified != 200 || !s.Albums[0].Found {
		t.Fatalf("live report = %+v, want saving with 200 of 200 found", s)
	}
}

// progressLog records what the resolver tells its listener, in order.
type progressLog struct{ events []string }

func (l *progressLog) lookupsPlanned(paths []string) {
	l.events = append(l.events, "planned "+strings.Join(paths, ","))
}
func (l *progressLog) lookupChecked(path string, found bool) {
	l.events = append(l.events, fmt.Sprintf("checked %s %v", path, found))
}
func (l *progressLog) lookupsFinished() { l.events = append(l.events, "finished") }

// The resolver names every song it will check before the first lookup, reports
// each as it lands, and says when it is done. These songs need no network: one
// already carries its id, one has no tags to look up by.
func TestResolverReportsProgress(t *testing.T) {
	root := t.TempDir()
	old := sidecarMusicDir
	sidecarMusicDir = root
	t.Cleanup(func() { sidecarMusicDir = old })
	folderArtSinceNanos.Store(0) // no folder art written in a test
	album := filepath.Join(root, "Band", "Album")
	if err := os.MkdirAll(album, 0o755); err != nil {
		t.Fatal(err)
	}
	tagged := filepath.Join(album, "01.m4a")
	if err := os.WriteFile(tagged, buildM4A(true), 0o644); err != nil {
		t.Fatal(err)
	}
	untagged := filepath.Join(album, "02.mp3")
	writeTestMP3(t, untagged, 0, 0o644)
	if err := os.WriteFile(filepath.Join(album, "03.aac"), []byte("raw aac"), 0o644); err != nil {
		t.Fatal(err)
	}
	cached := filepath.Join(album, "04.m4a")
	if err := os.WriteFile(cached, buildM4A(true), 0o644); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(cached)
	if err != nil {
		t.Fatal(err)
	}
	state := &SidecarState{MBIDResolutionState: map[string]*MBIDFileState{
		cached: {Resolved: true, MBID: testMBID, Reason: ReasonResolved, FileModifiedAt: fi.ModTime()},
	}}

	var log progressLog
	if _, _, err := resolveMBIDsOnce(context.Background(), state, &log); err != nil {
		t.Fatal(err)
	}
	want := []string{
		"planned " + tagged + "," + untagged, // the .aac can't be read and 04 is cached: neither is planned
		"checked " + tagged + " true",
		"checked " + untagged + " false",
		"finished",
	}
	if !reflect.DeepEqual(log.events, want) {
		t.Fatalf("resolver reported\n%s\nwant\n%s", strings.Join(log.events, "\n"), strings.Join(want, "\n"))
	}

	// With no one listening (the hourly sync) it runs the same and says nothing.
	if _, _, err := resolveMBIDsOnce(context.Background(), state, nil); err != nil {
		t.Fatal(err)
	}
}

func TestCanReadTagsMatchesReadTags(t *testing.T) {
	for _, name := range []string{"a.flac", "a.MP3", "a.m4a"} {
		if !canReadTags(name) {
			t.Errorf("canReadTags(%q) = false, want true", name)
		}
	}
	for _, name := range []string{"a.aac", "a.wav", "a"} {
		if canReadTags(name) {
			t.Errorf("canReadTags(%q) = true, want false", name)
		}
		if _, err := readTags(name); err != errUnsupportedFormat {
			t.Errorf("readTags(%q) = %v, want errUnsupportedFormat", name, err)
		}
	}
}
