package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFatSafeSegment(t *testing.T) {
	cases := map[string]string{
		`AC/DC`:             "AC_DC",
		`What's Going On?`:  "What's Going On_",
		`Title: Sub`:        "Title_ Sub",
		`"Quoted" <tag>|x`:  "_Quoted_ _tag__x",
		`trailing dots...`:  "trailing dots",
		`trailing space   `: "trailing space",
		"":                  "_",
		"...":               "_",
		"Björk":             "Björk",
	}
	for in, want := range cases {
		if got := fatSafeSegment(in); got != want {
			t.Errorf("fatSafeSegment(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestUsbRelPathMirrorsLibraryLayout(t *testing.T) {
	old := sidecarMusicDir
	tmp := t.TempDir()
	sidecarMusicDir = tmp
	defer func() { sidecarMusicDir = old }()

	// macOS stores a Finder "/" as ":" on disk; FAT can hold neither.
	src := filepath.Join(tmp, "AC:DC", "Back in Black", "01 - Hells Bells.flac")
	rel, err := usbRelPath(src)
	if err != nil {
		t.Fatal(err)
	}
	if rel != "AC_DC/Back in Black/01 - Hells Bells.flac" {
		t.Fatalf("rel = %q", rel)
	}
	if _, err := usbRelPath(filepath.Join(tmp, "..", "outside.flac")); err == nil {
		t.Fatal("a file outside the music folder must be refused")
	}
	if _, err := usbRelPath("/etc/passwd"); err == nil {
		t.Fatal("an absolute path outside the music folder must be refused")
	}
}

func TestUsbCardPathNeverLeavesTheCassetteFolder(t *testing.T) {
	mount := "/Volumes/CARD"
	got := usbCardPath(mount, "../../Other/track.flac")
	want := filepath.Join(mount, usbFolderName, "Other", "track.flac")
	if got != want {
		t.Fatalf("usbCardPath climbed out: %q", got)
	}
}

func TestUsbHasRoom(t *testing.T) {
	if !usbHasRoom(-1, 1<<30) {
		t.Fatal("unknown free space must not block")
	}
	if usbHasRoom(usbFreeReserveBytes+10, 100) {
		t.Fatal("a copy that eats into the reserve must be refused")
	}
	if !usbHasRoom(usbFreeReserveBytes+1000, 100) {
		t.Fatal("a copy that leaves the reserve intact must be allowed")
	}
}

func TestCopyFileAtomicLeavesNoPartial(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src.flac")
	if err := os.WriteFile(src, []byte("flac bytes"), 0o644); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(dir, "card", "Cassette", "Artist", "Album", "01 - Song.flac")
	if err := copyFileAtomic(src, dst); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(dst)
	if err != nil || string(got) != "flac bytes" {
		t.Fatalf("copy mismatch: %q %v", got, err)
	}
	if _, err := os.Stat(dst + usbPartialExt); !os.IsNotExist(err) {
		t.Fatal("partial file left behind after a successful copy")
	}
	if err := copyFileAtomic(filepath.Join(dir, "missing.flac"), dst+".2"); err == nil {
		t.Fatal("copying a missing source must fail")
	}
	if _, err := os.Stat(dst + ".2" + usbPartialExt); !os.IsNotExist(err) {
		t.Fatal("partial file left behind after a failed copy")
	}
}

func TestMarkerAndManifestRoundTrip(t *testing.T) {
	mount := t.TempDir()
	if m, err := readUsbMarker(mount); err != nil || m != nil {
		t.Fatalf("a fresh volume has no marker: %v %v", m, err)
	}
	if usbMounted(mount) {
		t.Fatal("a volume with no marker is not a mounted device")
	}
	if err := writeUsbMarker(mount, usbMarker{DeviceID: "usb-abc", Label: "ECHO MINI"}); err != nil {
		t.Fatal(err)
	}
	m, err := readUsbMarker(mount)
	if err != nil || m == nil || m.DeviceID != "usb-abc" || m.Label != "ECHO MINI" {
		t.Fatalf("marker round trip: %+v %v", m, err)
	}
	if !usbMounted(mount) {
		t.Fatal("a volume with a marker counts as mounted")
	}

	man := readUsbManifest(mount)
	if len(man.Tracks) != 0 {
		t.Fatal("fresh manifest must be empty")
	}
	man.Tracks["id1"] = usbManifestTrack{Path: "A/B/01.flac", Size: 3}
	man.Tracks["id2"] = usbManifestTrack{Path: "A/B/02.flac", Size: 3}
	if err := writeUsbManifest(mount, man); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(mount, usbFolderName, "A", "B"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(mount, usbFolderName, "A", "B", "01.flac"), []byte("abc"), 0o644); err != nil {
		t.Fatal(err)
	}
	pruned, n := pruneUsbManifest(mount, readUsbManifest(mount))
	if n != 1 || len(pruned.Tracks) != 1 {
		t.Fatalf("prune: dropped %d, kept %d", n, len(pruned.Tracks))
	}
	if _, ok := pruned.Tracks["id1"]; !ok {
		t.Fatal("the track still on the card must survive the prune")
	}
}

func TestDecodeAlbumTarget(t *testing.T) {
	artist, album, ok := decodeAlbumTarget("AC%2FDC::Back%20in%20Black%20%2B%20More")
	if !ok || artist != "AC/DC" || album != "Back in Black + More" {
		t.Fatalf("decode: %q %q %v", artist, album, ok)
	}
	if _, _, ok := decodeAlbumTarget("localid@abc"); ok {
		t.Fatal("a remove target is not an album target")
	}
}
