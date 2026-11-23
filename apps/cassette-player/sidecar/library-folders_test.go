package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// withLinked publishes the given folders as the ones Cassette reads, for one test.
func withLinked(t *testing.T, state *SidecarState, paths ...string) {
	t.Helper()
	prev := linkedRoots()
	for _, p := range paths {
		state.LinkedFolders = append(state.LinkedFolders, linkedFolder{Path: p, LibraryID: 2})
	}
	publishLinkedRoots(state)
	t.Cleanup(func() { linkedRootsVal.Store(prev) })
}

func put(t *testing.T, p string, b []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, b, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestPathWithin(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "Volumes", "NAS", "Music")
	cases := map[string]bool{
		root:                                  true,
		filepath.Join(root, "A", "B.flac"):    true,
		filepath.Join(root+" Extra", "x.mp3"): false, // a sibling with the same start is not inside
		filepath.Dir(root):                    false,
	}
	for p, want := range cases {
		if got := pathWithin(root, p); got != want {
			t.Errorf("pathWithin(%q, %q) = %v, want %v", root, p, got, want)
		}
	}
}

func TestNothingIsWrittenIntoAReadFolder(t *testing.T) {
	dir := t.TempDir()
	read := filepath.Join(dir, "Their Music")
	song := filepath.Join(read, "Artist", "Album", "01 - Song.flac")
	put(t, song, []byte("fLaC not really"))
	state := &SidecarState{}
	withLinked(t, state, read)

	if err := songHeld(song); !errors.Is(err, errSongHeld) {
		t.Fatalf("songHeld on a read folder's song = %v, want errSongHeld", err)
	}
	if !matchHeldOnHubSide(song) {
		t.Fatal("a read folder's song should hold its MusicBrainz match on the hub's side")
	}
	if err := writeMBIDTag(song, "11111111-2222-3333-4444-555555555555"); !errors.Is(err, errSongHeld) {
		t.Fatalf("writeMBIDTag into a read folder = %v, want errSongHeld", err)
	}
	// The backstop: the shared write refuses any file there, a picture included.
	cover := filepath.Join(read, "Artist", "Album", "cover.jpg")
	if err := atomicWriteFile(cover, []byte("x"), 0o644); !errors.Is(err, errSongHeld) {
		t.Fatalf("atomicWriteFile into a read folder = %v, want refusal", err)
	}
	if _, err := os.Stat(cover); !os.IsNotExist(err) {
		t.Fatal("a picture was written into a folder Cassette only reads")
	}
	// Folder art: refused even for a folder made after the hub started watching.
	folderArtSinceNanos.Store(time.Now().Add(-time.Hour).UnixNano())
	t.Cleanup(func() { folderArtSinceNanos.Store(0) })
	if folderArtAllowed(filepath.Dir(song)) {
		t.Fatal("folder art allowed in a folder Cassette only reads")
	}
	// The song itself is untouched.
	if b, _ := os.ReadFile(song); string(b) != "fLaC not really" {
		t.Fatal("the song in the read folder changed")
	}
}

func TestOutsideAReadFolderWritesAsBefore(t *testing.T) {
	dir := t.TempDir()
	state := &SidecarState{}
	withLinked(t, state, filepath.Join(dir, "Their Music"))
	p := filepath.Join(dir, "Cassette", "x.txt")
	put(t, p, []byte("a"))
	if err := atomicWriteFile(p, []byte("b"), 0o644); err != nil {
		t.Fatalf("a write outside every read folder failed: %v", err)
	}
}

func TestAnEmptyReadFolderIsAwayNotEmptied(t *testing.T) {
	dir := t.TempDir()
	here := filepath.Join(dir, "Here")
	put(t, filepath.Join(here, "a.flac"), []byte("x"))
	mountPoint := filepath.Join(dir, "Unplugged")
	_ = os.MkdirAll(mountPoint, 0o755)
	put(t, filepath.Join(mountPoint, ".DS_Store"), []byte("x"))
	gone := filepath.Join(dir, "Gone")

	if !linkedFolderHere(here) {
		t.Fatal("a folder with music should be here")
	}
	if linkedFolderHere(mountPoint) {
		t.Fatal("an empty mount point (a drive that's away) should read as away")
	}
	if linkedFolderHere(gone) {
		t.Fatal("a folder that isn't there should read as away")
	}

	prevMusic := sidecarMusicDir
	sidecarMusicDir = here
	t.Cleanup(func() { sidecarMusicDir = prevMusic })
	state := &SidecarState{LinkedFolders: []linkedFolder{{Path: here}, {Path: mountPoint}}}
	away := awayFolders(state)
	if len(away) != 1 || away[0] != mountPoint {
		t.Fatalf("awayFolders = %v, want just the unplugged one", away)
	}
}

func TestTheMusicFolderIsNeverStartedOverWhenItsDriveIsAway(t *testing.T) {
	dir := t.TempDir()
	onDrive := filepath.Join(dir, "Volumes", "Drive", "Cassette")
	if err := makeMusicFolder(onDrive); err == nil {
		t.Fatal("made a Cassette folder for a drive that isn't there")
	}
	if _, err := os.Stat(filepath.Dir(onDrive)); !os.IsNotExist(err) {
		t.Fatal("created the drive's folder on this disk")
	}
	fresh := filepath.Join(dir, "Music", "Cassette")
	_ = os.MkdirAll(filepath.Dir(fresh), 0o755)
	if err := makeMusicFolder(fresh); err != nil {
		t.Fatalf("a fresh install's Cassette folder wasn't made: %v", err)
	}
}

func TestCheckLinkableRefusesOverlaps(t *testing.T) {
	dir := t.TempDir()
	prevMusic, prevData := sidecarMusicDir, sidecarDataDir
	sidecarMusicDir = filepath.Join(dir, "Music", "Cassette")
	sidecarDataDir = filepath.Join(dir, "data")
	t.Cleanup(func() { sidecarMusicDir, sidecarDataDir = prevMusic, prevData })
	for _, p := range []string{sidecarMusicDir, sidecarDataDir, filepath.Join(dir, "Lib")} {
		_ = os.MkdirAll(p, 0o755)
	}
	state := &SidecarState{}
	withLinked(t, state, filepath.Join(dir, "Lib"))

	refused := []string{
		sidecarMusicDir,
		filepath.Join(dir, "Music"), // holds the Cassette folder
		sidecarDataDir,
		filepath.Join(dir, "Lib"),
		"relative/path",
		filepath.Join(dir, "missing"),
	}
	for _, p := range refused {
		if _, err := checkLinkable(state, p); err == nil {
			t.Errorf("checkLinkable(%q) allowed it", p)
		}
	}
	other := filepath.Join(dir, "Other")
	_ = os.MkdirAll(other, 0o755)
	if _, err := checkLinkable(state, other); err != nil {
		t.Errorf("checkLinkable(%q) = %v, want allowed", other, err)
	}
}

func TestMoveDestination(t *testing.T) {
	dir := t.TempDir()
	empty := filepath.Join(dir, "Empty")
	_ = os.MkdirAll(empty, 0o755)
	if got, err := moveDestination(empty, ""); err != nil || got != mustReal(empty) {
		t.Fatalf("empty folder: %q %v", got, err)
	}
	full := filepath.Join(dir, "Drive")
	put(t, filepath.Join(full, "other.txt"), []byte("x"))
	if got, err := moveDestination(full, ""); err != nil || got != filepath.Join(mustReal(full), "Cassette") {
		t.Fatalf("a drive with things on it: %q %v", got, err)
	}
	put(t, filepath.Join(full, "Cassette", "x.flac"), []byte("x"))
	if _, err := moveDestination(full, ""); err == nil {
		t.Fatal("moved into a Cassette folder that already holds music")
	}
	// A copy left part-done is picked up.
	if got, err := moveDestination(full, filepath.Join(mustReal(full), "Cassette")); err != nil || got != filepath.Join(mustReal(full), "Cassette") {
		t.Fatalf("resume: %q %v", got, err)
	}
}

func mustReal(p string) string {
	r, err := filepath.EvalSymlinks(p)
	if err != nil {
		return p
	}
	return r
}

func TestCopyTreeKeepsEverythingAndLeavesTheOriginal(t *testing.T) {
	dir := t.TempDir()
	from, to := filepath.Join(dir, "from"), filepath.Join(dir, "to")
	song := filepath.Join(from, "Artist", "Album", "01.flac")
	put(t, song, []byte("music"))
	put(t, filepath.Join(from, "Artist", "Album", "cover.jpg"), []byte("pic"))
	old := time.Date(2019, 5, 1, 12, 0, 0, 0, time.UTC)
	_ = os.Chtimes(song, old, old)

	moveMu.Lock()
	moveNow = &moveProgress{}
	moveMu.Unlock()
	t.Cleanup(func() { moveMu.Lock(); moveNow = nil; moveMu.Unlock() })

	if err := copyTree(from, to); err != nil {
		t.Fatal(err)
	}
	if err := checkCopied(from, to); err != nil {
		t.Fatal(err)
	}
	got, err := os.Stat(filepath.Join(to, "Artist", "Album", "01.flac"))
	if err != nil || !got.ModTime().Equal(old) {
		t.Fatalf("the copy lost its date: %v %v", got, err)
	}
	if _, err := os.Stat(song); err != nil {
		t.Fatal("the original was touched")
	}
	// Nothing half-written is left behind.
	_ = filepath.WalkDir(to, func(p string, d os.DirEntry, _ error) error {
		if filepath.Ext(p) == ".cassette-moving" {
			t.Errorf("left a partial file: %s", p)
		}
		return nil
	})
}

func TestRebase(t *testing.T) {
	from := filepath.Join(string(filepath.Separator), "Users", "a", "Music", "Cassette")
	to := filepath.Join(string(filepath.Separator), "Volumes", "Drive", "Cassette")
	if got := rebase(filepath.Join(from, "A", "x.flac"), from, to); got != filepath.Join(to, "A", "x.flac") {
		t.Fatalf("rebase = %q", got)
	}
	other := filepath.Join(string(filepath.Separator), "Volumes", "NAS", "x.flac")
	if got := rebase(other, from, to); got != other {
		t.Fatalf("rebase moved a path outside the folder: %q", got)
	}
}

func TestAFolderFollowsItsDriveToANewLetter(t *testing.T) {
	dir := t.TempDir()
	prevData := sidecarDataDir
	sidecarDataDir = filepath.Join(dir, "data") // saveState writes here
	_ = os.MkdirAll(sidecarDataDir, 0o755)
	t.Cleanup(func() { sidecarDataDir = prevData })

	oldPlace := filepath.Join(dir, "E", "Music") // E: is gone
	newPlace := filepath.Join(dir, "F", "Music") // the same drive, now F:
	put(t, filepath.Join(newPlace, "A", "B", "01.flac"), []byte("x"))
	added := time.Now()
	state := &SidecarState{
		LinkedFolders:       []linkedFolder{{Path: oldPlace, LibraryID: 0, AddedAt: added, Drive: "1A2B3C4D", OnDrive: "Music"}},
		MBIDResolutionState: map[string]*MBIDFileState{filepath.Join(oldPlace, "A", "B", "01.flac"): {Resolved: true}},
	}
	withLinked(t, &SidecarState{}) // keep the published list tidy after
	publishLinkedRoots(state)

	prev := lookForDrive
	lookForDrive = func(serial, rel string) (string, bool) {
		if serial == "1A2B3C4D" && rel == "Music" {
			return newPlace, true
		}
		return "", false
	}
	t.Cleanup(func() { lookForDrive = prev })

	if !followMovedDrives(state) {
		t.Fatal("didn't follow the drive to its new letter")
	}
	if got := state.LinkedFolders[0].Path; got != newPlace {
		t.Fatalf("folder is at %q, want %q", got, newPlace)
	}
	if !inLinkedFolder(filepath.Join(newPlace, "A", "B", "01.flac")) {
		t.Fatal("the new place isn't read-only to the hub")
	}
	if _, ok := state.MBIDResolutionState[filepath.Join(newPlace, "A", "B", "01.flac")]; !ok {
		t.Fatal("what the hub knew about the song didn't move with it")
	}
	// A drive that isn't anywhere leaves the folder away, untouched.
	state.LinkedFolders[0].Drive = "FFFFFFFF"
	state.LinkedFolders[0].Path = oldPlace
	if followMovedDrives(state) {
		t.Fatal("followed a drive that isn't there")
	}
}
