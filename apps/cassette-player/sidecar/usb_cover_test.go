package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"
)

// synthWav writes a one-second sine wave WAV — real, decodable audio, not a
// placeholder string, since usbEmbedCoverArt's ffmpeg call demuxes the source
// file for real. Skips the test if ffmpeg is absent.
func synthWav(t *testing.T, path string) {
	t.Helper()
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not on PATH")
	}
	if out, err := exec.Command("ffmpeg", "-v", "error", "-y", "-f", "lavfi",
		"-i", "sine=frequency=440:duration=1", "-ac", "2", "-ar", "44100", path).CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg synth wav: %v %s", err, out)
	}
}

// synthMP3 and synthFLAC produce real, decodable audio files (not the literal
// "MP3BYTES"-style stand-ins the other usb tests use), because a real ffmpeg
// remux — what usbEmbedCoverArt actually runs — needs a real audio stream to
// map.
func synthMP3(t *testing.T, path string) {
	t.Helper()
	wav := path + ".wav"
	synthWav(t, wav)
	if out, err := exec.Command("ffmpeg", "-v", "error", "-y", "-i", wav,
		"-c:a", "libmp3lame", "-b:a", "128k", path).CombinedOutput(); err != nil {
		t.Skipf("ffmpeg has no mp3 encoder: %v %s", err, out)
	}
}

func synthFLAC(t *testing.T, path string) {
	t.Helper()
	wav := path + ".wav"
	synthWav(t, wav)
	if _, err := exec.LookPath("flac"); err == nil {
		if out, err := exec.Command("flac", "-s", "-f", "-o", path, wav).CombinedOutput(); err != nil {
			t.Fatalf("flac encode: %v %s", err, out)
		}
		return
	}
	if out, err := exec.Command("ffmpeg", "-v", "error", "-y", "-i", wav, path).CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg flac encode: %v %s", err, out)
	}
}

func TestUsbFindFolderCover(t *testing.T) {
	dir := t.TempDir()
	if _, ok := usbFindFolderCover(dir); ok {
		t.Fatal("an empty album folder must not report a cover")
	}
	if err := os.WriteFile(filepath.Join(dir, "01 - track.mp3"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, ok := usbFindFolderCover(dir); ok {
		t.Fatal("a non-cover file must not be picked up")
	}
	// materializeCoverForAlbumDir can write cover.webp or cover.gif depending on
	// the source MIME (imageExt, cover-art.go) — both must be found, not just jpg/png.
	if err := os.WriteFile(filepath.Join(dir, "cover.webp"), jpegBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	got, ok := usbFindFolderCover(dir)
	if !ok || filepath.Base(got) != "cover.webp" {
		t.Fatalf("cover.webp not found: %q %v", got, ok)
	}

	dir2 := t.TempDir()
	// front.* is in coverBaseNames (Navidrome's default priority) even though
	// the sidecar's own writer never produces it — a pre-existing library file.
	if err := os.WriteFile(filepath.Join(dir2, "front.gif"), jpegBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	got2, ok2 := usbFindFolderCover(dir2)
	if !ok2 || filepath.Base(got2) != "front.gif" {
		t.Fatalf("front.gif not found: %q %v", got2, ok2)
	}
}

func TestCopyFolderCoverOnceSkipsWhenDestinationAlreadyHasAny(t *testing.T) {
	src, dst := t.TempDir(), t.TempDir()
	if err := os.WriteFile(filepath.Join(src, "cover.jpg"), jpegBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dst, "folder.png"), pngBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	copyFolderCoverOnce(src, dst)
	if _, err := os.Stat(filepath.Join(dst, "cover.jpg")); !os.IsNotExist(err) {
		t.Fatal("a destination that already has a cover (any name) must not get a second one")
	}
}

// TestUsbMaterialiseEmbedsCoverIntoLosslessCopy: a straight copy (no
// transcode) still gets the album's folder cover embedded into it, for a
// hardware player that reads per-file art and never a sibling cover.jpg.
func TestUsbMaterialiseEmbedsCoverIntoLosslessCopy(t *testing.T) {
	srcDir, dstDir := t.TempDir(), t.TempDir()
	src := filepath.Join(srcDir, "01 - track.flac")
	synthFLAC(t, src)
	if err := os.WriteFile(filepath.Join(srcDir, "cover.jpg"), jpegBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(src)
	if err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(dstDir, "01 - track.flac")

	n, cover, err := usbMaterialise(usbCopyJob{src: src, dst: dst, need: fi.Size()})
	if err != nil {
		t.Fatalf("materialise: %v", err)
	}
	if !cover.settled {
		t.Error("settled should be true once art is embedded")
	}
	data, mime := flacArt(dst)
	if len(data) == 0 {
		t.Fatal("no art embedded in the copied flac")
	}
	if !bytes.Equal(data, jpegBytes) {
		t.Error("embedded art bytes don't match the folder cover")
	}
	if mime != "image/jpeg" {
		t.Errorf("mime = %q, want image/jpeg", mime)
	}
	// The manifest/meter size must reflect the file as it actually landed
	// (with the picture block), not the pre-embed estimate.
	if fi2, _ := os.Stat(dst); fi2 != nil && n != fi2.Size() {
		t.Errorf("returned size %d != actual %d", n, fi2.Size())
	}
}

// TestUsbMaterialiseEmbedsCoverIntoTranscode: the download-quality path (an
// MP3 streamed from Navidrome) gets the cover embedded too, not just the
// lossless copy path.
func TestUsbMaterialiseEmbedsCoverIntoTranscode(t *testing.T) {
	srcDir, dstDir := t.TempDir(), t.TempDir()
	if err := os.WriteFile(filepath.Join(srcDir, "cover.jpg"), jpegBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	mp3 := filepath.Join(t.TempDir(), "stream.mp3")
	synthMP3(t, mp3)
	body, err := os.ReadFile(mp3)
	if err != nil {
		t.Fatal(err)
	}

	nav := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write(body)
	}))
	defer nav.Close()
	oldBase := navidromeBase
	navidromeBase = nav.URL
	t.Cleanup(func() { navidromeBase = oldBase })

	// src only needs to name the album folder the cover lives in — the bytes
	// come from the fake Navidrome stream, matching how a real transcode job
	// resolves the library path for its folder but not its audio.
	src := filepath.Join(srcDir, "01 - track.flac")
	dst := filepath.Join(dstDir, "01 - track.mp3")

	n, cover, err := usbMaterialise(usbCopyJob{
		src: src, dst: dst, subsonicID: "song1", transcode: true, kbps: 128, ext: "mp3",
	})
	if err != nil {
		t.Fatalf("materialise: %v", err)
	}
	if !cover.settled {
		t.Error("settled should be true once art is embedded")
	}
	data, mime := mp3Art(dst)
	if len(data) == 0 {
		t.Fatal("no art embedded in the transcoded mp3")
	}
	if !bytes.Equal(data, jpegBytes) {
		t.Error("embedded art bytes don't match the folder cover")
	}
	if mime != "image/jpeg" {
		t.Errorf("mime = %q, want image/jpeg", mime)
	}
	if fi, _ := os.Stat(dst); fi != nil && n != fi.Size() {
		t.Errorf("returned size %d != actual %d", n, fi.Size())
	}
}

// TestUsbMaterialiseSurvivesNoCover: an album with no folder cover (the
// common case before materializeCoverForAlbumDir has run, or a genuinely
// uncovered album) still lands the track — no cover to embed is not a
// failure, and settles as done rather than something to keep retrying: an
// uncovered album staying uncovered is an accepted state here, the same way
// an album page honestly saying "no art yet" isn't a gap to force-fill, and
// retrying it forever would repeat the exact unbounded-work shape BUG-356
// was.
func TestUsbMaterialiseSurvivesNoCover(t *testing.T) {
	srcDir, dstDir := t.TempDir(), t.TempDir()
	src := filepath.Join(srcDir, "01 - track.flac")
	synthFLAC(t, src)
	fi, err := os.Stat(src)
	if err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(dstDir, "01 - track.flac")

	n, cover, err := usbMaterialise(usbCopyJob{src: src, dst: dst, need: fi.Size()})
	if err != nil {
		t.Fatalf("materialise: %v", err)
	}
	if !cover.settled {
		t.Error("an uncovered album must settle as done, not be retried forever")
	}
	if n != fi.Size() {
		t.Errorf("size = %d, want %d (uncovered file, untouched)", n, fi.Size())
	}
	if data, _ := flacArt(dst); len(data) != 0 {
		t.Error("no cover existed; nothing should have been embedded")
	}
}

// TestUsbMaterialiseSurvivesUnembeddableCover: a "cover" that isn't a real
// image (ffmpeg will refuse it) must not cost the track — the copy that
// already landed stays exactly as it was, just without art. Unlike a
// genuinely absent cover, this settles as NOT done: the person might replace
// the source cover, so it's worth checking again later.
func TestUsbMaterialiseSurvivesUnembeddableCover(t *testing.T) {
	srcDir, dstDir := t.TempDir(), t.TempDir()
	src := filepath.Join(srcDir, "01 - track.flac")
	synthFLAC(t, src)
	if err := os.WriteFile(filepath.Join(srcDir, "cover.jpg"), []byte("not actually a jpeg"), 0o644); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(src)
	if err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(dstDir, "01 - track.flac")

	n, cover, err := usbMaterialise(usbCopyJob{src: src, dst: dst, need: fi.Size()})
	if err != nil {
		t.Fatalf("materialise must still succeed: %v", err)
	}
	if cover.settled {
		t.Error("a failed embed attempt should NOT settle — it's worth retrying if the cover self-heals")
	}
	if n != fi.Size() {
		t.Errorf("size = %d, want %d", n, fi.Size())
	}
	if _, statErr := os.Stat(dst); statErr != nil {
		t.Fatal("the track file must survive a failed embed attempt")
	}
	if _, statErr := os.Stat(dst + ".art" + usbPartialExt); !os.IsNotExist(statErr) {
		t.Fatal("a failed embed must not leave its temp file behind")
	}
}

// fakeGetSong serves /rest/getSong with a fixed real path and counts calls,
// so a test can assert convergeUsbCovers stops touching the network once a
// track has settled instead of rechecking it forever.
func fakeGetSong(path string) (*httptest.Server, *int32) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"subsonic-response": map[string]any{"status": "ok", "song": map[string]any{"path": path}},
		})
	}))
	return srv, &calls
}

// TestConvergeUsbCoversBackfillsAndSettles: the actual scenario this pass
// exists for — an album synced before cover-embedding existed. One pass
// embeds it and marks the manifest; a second pass, with nothing left owed,
// never touches the network again.
func TestConvergeUsbCoversBackfillsAndSettles(t *testing.T) {
	music, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	oldMusic, oldBase := sidecarMusicDir, navidromeBase
	sidecarMusicDir = music
	t.Cleanup(func() { sidecarMusicDir, navidromeBase = oldMusic, oldBase })

	srcDir := filepath.Join(music, "Spoon", "Ga Ga Ga Ga Ga")
	if err := os.MkdirAll(srcDir, 0o755); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(srcDir, "01 - Don't Make Me a Target.flac")
	synthFLAC(t, src)
	if err := os.WriteFile(filepath.Join(srcDir, "cover.jpg"), jpegBytes, 0o644); err != nil {
		t.Fatal(err)
	}

	srv, calls := fakeGetSong(src)
	defer srv.Close()
	navidromeBase = srv.URL

	card := t.TempDir()
	withFakeUSB(t, []usbVolume{{MountPath: card, Name: "SPOON", Writable: true}})
	if err := writeUsbMarker(card, usbMarker{DeviceID: "usb-spoon", Label: "SPOON"}); err != nil {
		t.Fatal(err)
	}
	rel := "Spoon/Ga Ga Ga Ga Ga/01 - Don't Make Me a Target.flac"
	onCard := usbCardPath(card, rel)
	if err := os.MkdirAll(filepath.Dir(onCard), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := copyFileAtomic(src, onCard); err != nil {
		t.Fatal(err)
	}
	man := readUsbManifest(card)
	man.Tracks["lid-spoon"] = usbManifestTrack{Path: rel, SubsonicID: "song-spoon", Size: 1} // Cover: false, the pre-0.5.15 shape
	if err := writeUsbManifest(card, man); err != nil {
		t.Fatal(err)
	}
	rec := &usbDeviceRecord{DeviceID: "usb-spoon", Label: "SPOON"}

	if n := convergeUsbCovers(liveState, rec, usbVolume{MountPath: card}); n != 1 {
		t.Fatalf("settled = %d, want 1", n)
	}
	if data, _ := flacArt(onCard); !bytes.Equal(data, jpegBytes) {
		t.Fatal("cover not actually embedded on the card file")
	}
	got := readUsbManifest(card).Tracks["lid-spoon"]
	if !got.Cover {
		t.Fatal("manifest entry not marked Cover: true after settling")
	}
	if calls1 := atomic.LoadInt32(calls); calls1 != 1 {
		t.Fatalf("getSong called %d times on the backfill pass, want 1", calls1)
	}

	// Second pass: nothing owed, so convergeUsbCovers must exit on the
	// manifest scan alone — zero further network calls.
	if n := convergeUsbCovers(liveState, rec, usbVolume{MountPath: card}); n != 0 {
		t.Fatalf("second pass settled = %d, want 0 (already done)", n)
	}
	if calls2 := atomic.LoadInt32(calls); calls2 != 1 {
		t.Fatalf("getSong called again on an already-settled track: %d calls, want still 1", calls2)
	}
}

// TestConvergeUsbCoversSettlesAnUncoveredAlbumWithoutRetryingForever is the
// regression case: an album that genuinely has no cover must still settle,
// or a card with even one uncovered album would hit the network for it on
// every single sync pass forever — the exact unbounded-work shape BUG-356
// was.
func TestConvergeUsbCoversSettlesAnUncoveredAlbumWithoutRetryingForever(t *testing.T) {
	music, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	oldMusic, oldBase := sidecarMusicDir, navidromeBase
	sidecarMusicDir = music
	t.Cleanup(func() { sidecarMusicDir, navidromeBase = oldMusic, oldBase })

	srcDir := filepath.Join(music, "Obscure Artist", "No Cover Album")
	if err := os.MkdirAll(srcDir, 0o755); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(srcDir, "01 - Track.flac")
	synthFLAC(t, src)
	// Deliberately no cover.jpg in srcDir.

	srv, calls := fakeGetSong(src)
	defer srv.Close()
	navidromeBase = srv.URL

	card := t.TempDir()
	withFakeUSB(t, []usbVolume{{MountPath: card, Name: "OBSCURE", Writable: true}})
	if err := writeUsbMarker(card, usbMarker{DeviceID: "usb-obscure", Label: "OBSCURE"}); err != nil {
		t.Fatal(err)
	}
	rel := "Obscure Artist/No Cover Album/01 - Track.flac"
	onCard := usbCardPath(card, rel)
	if err := os.MkdirAll(filepath.Dir(onCard), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := copyFileAtomic(src, onCard); err != nil {
		t.Fatal(err)
	}
	man := readUsbManifest(card)
	man.Tracks["lid-obscure"] = usbManifestTrack{Path: rel, SubsonicID: "song-obscure", Size: 1}
	if err := writeUsbManifest(card, man); err != nil {
		t.Fatal(err)
	}
	rec := &usbDeviceRecord{DeviceID: "usb-obscure", Label: "OBSCURE"}

	convergeUsbCovers(liveState, rec, usbVolume{MountPath: card})
	got := readUsbManifest(card).Tracks["lid-obscure"]
	if !got.Cover {
		t.Fatal("an uncovered album must still settle to Cover: true, or it's retried forever")
	}
	if calls1 := atomic.LoadInt32(calls); calls1 != 1 {
		t.Fatalf("getSong called %d times on the first pass, want 1", calls1)
	}

	convergeUsbCovers(liveState, rec, usbVolume{MountPath: card})
	if calls2 := atomic.LoadInt32(calls); calls2 != 1 {
		t.Fatalf("getSong called again for an album confirmed to have no cover: %d calls, want still 1", calls2)
	}
}

func TestUSBEmbedIfCovered_M4ASettledWithoutTouching(t *testing.T) {
	srcDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(srcDir, "cover.jpg"), []byte("\xff\xd8\xff"), 0o644); err != nil {
		t.Fatal(err)
	}
	dst := filepath.Join(t.TempDir(), "01 - Track.m4a")
	if err := os.WriteFile(dst, []byte("m4a bytes"), 0o644); err != nil {
		t.Fatal(err)
	}
	n, outcome := usbEmbedIfCovered(dst, srcDir, 9)
	if !outcome.settled || n != 9 {
		t.Errorf("m4a copy: (size %d, settled %v), want (9, true)", n, outcome.settled)
	}
	if b, _ := os.ReadFile(dst); string(b) != "m4a bytes" {
		t.Error("m4a copy was modified")
	}
}
