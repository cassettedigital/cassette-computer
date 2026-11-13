package main

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// setUpFreshnessTrack builds one track end to end — a real audio file plus a
// folder cover in the library, the same bytes already landed on a card, and
// a manifest entry — so each test below starts from "already fully synced,
// pre-freshness-feature" and only varies what changes next.
func setUpFreshnessTrack(t *testing.T, deviceID, localID string) (card string, rec *usbDeviceRecord, srcDir, onCard string) {
	t.Helper()
	music, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	oldMusic, oldBase := sidecarMusicDir, navidromeBase
	sidecarMusicDir = music
	t.Cleanup(func() { sidecarMusicDir, navidromeBase = oldMusic, oldBase })

	srcDir = filepath.Join(music, "Clairo", "Charm")
	if err := os.MkdirAll(srcDir, 0o755); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(srcDir, "01 - Nomad.flac")
	synthFLAC(t, src)
	if err := os.WriteFile(filepath.Join(srcDir, "cover.jpg"), jpegBytes, 0o644); err != nil {
		t.Fatal(err)
	}

	srv, _ := fakeGetSong(src)
	t.Cleanup(srv.Close)
	navidromeBase = srv.URL

	card = t.TempDir()
	withFakeUSB(t, []usbVolume{{MountPath: card, Name: "CLAIRO", Writable: true}})
	if err := writeUsbMarker(card, usbMarker{DeviceID: deviceID, Label: "CLAIRO"}); err != nil {
		t.Fatal(err)
	}
	rel := "Clairo/Charm/01 - Nomad.flac"
	onCard = usbCardPath(card, rel)
	if err := os.MkdirAll(filepath.Dir(onCard), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := copyFileAtomic(src, onCard); err != nil {
		t.Fatal(err)
	}
	man := readUsbManifest(card)
	man.Tracks[localID] = usbManifestTrack{Path: rel, SubsonicID: "song-clairo", Size: 1, Cover: true}
	if err := writeUsbManifest(card, man); err != nil {
		t.Fatal(err)
	}
	rec = &usbDeviceRecord{DeviceID: deviceID, Label: "CLAIRO"}
	return card, rec, srcDir, onCard
}

// TestConvergeUsbFreshnessBackfillsWithoutRecopying is the single most
// important property of this feature: the day it ships, every already-synced
// track has no baseline at all, and establishing one must never be read as
// "this track changed" — or every card would get a full, pointless re-copy
// the moment the feature rolled out, purely because it rolled out.
func TestConvergeUsbFreshnessBackfillsWithoutRecopying(t *testing.T) {
	card, rec, _, onCard := setUpFreshnessTrack(t, "usb-clairo", "lid-clairo")
	before, err := os.ReadFile(onCard)
	if err != nil {
		t.Fatal(err)
	}
	beforeInfo, err := os.Stat(onCard)
	if err != nil {
		t.Fatal(err)
	}

	liveState.AudioObservations = map[string]trackObservation{
		"lid-clairo": {Fingerprint: "fp-baseline"},
	}

	n, stalled := convergeUsbFreshness(liveState, rec, usbVolume{MountPath: card}, "lossless")
	if n != 0 || stalled {
		t.Fatalf("refreshed=%d stalled=%v, want 0/false — backfill alone must not count as a refresh", n, stalled)
	}

	after, err := os.ReadFile(onCard)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before, after) {
		t.Fatal("the on-card file was rewritten during pure baseline establishment")
	}
	afterInfo, err := os.Stat(onCard)
	if err != nil {
		t.Fatal(err)
	}
	if !beforeInfo.ModTime().Equal(afterInfo.ModTime()) {
		t.Fatal("the on-card file's mtime changed — it was touched when it should not have been")
	}

	got := readUsbManifest(card).Tracks["lid-clairo"]
	if got.LibraryPath == "" {
		t.Fatal("LibraryPath was not backfilled")
	}
	if got.AudioFingerprint != "fp-baseline" {
		t.Fatalf("AudioFingerprint = %q, want the recorded baseline", got.AudioFingerprint)
	}
	if got.CoverSize == 0 || got.CoverModUnix == 0 {
		t.Fatal("cover baseline not recorded")
	}
}

// TestConvergeUsbFreshnessSkipsUnobservedTracks: a track with no
// state.AudioObservations entry at all (library-sync hasn't fingerprinted it
// yet) must never be treated as having no baseline established either way —
// the absence of fresh data is not evidence of staleness.
func TestConvergeUsbFreshnessSkipsUnobservedTracks(t *testing.T) {
	card, rec, _, onCard := setUpFreshnessTrack(t, "usb-clairo2", "lid-clairo2")
	before, _ := os.ReadFile(onCard)

	liveState.AudioObservations = map[string]trackObservation{} // nothing observed yet

	n, _ := convergeUsbFreshness(liveState, rec, usbVolume{MountPath: card}, "lossless")
	if n != 0 {
		t.Fatalf("refreshed = %d, want 0", n)
	}
	after, _ := os.ReadFile(onCard)
	if !bytes.Equal(before, after) {
		t.Fatal("track was re-copied despite no observation existing to compare against")
	}
	if got := readUsbManifest(card).Tracks["lid-clairo2"]; got.AudioFingerprint != "" {
		t.Fatalf("AudioFingerprint = %q, want empty — nothing to record", got.AudioFingerprint)
	}
}

// TestConvergeUsbFreshnessReembedsOnCoverChange: once a baseline exists, a
// changed folder cover (a different pick, a corrected image) gets re-embedded
// — a cheap remux, not a re-copy, and it happens even though the audio
// fingerprint never changed.
func TestConvergeUsbFreshnessReembedsOnCoverChange(t *testing.T) {
	card, rec, srcDir, onCard := setUpFreshnessTrack(t, "usb-clairo3", "lid-clairo3")
	liveState.AudioObservations = map[string]trackObservation{"lid-clairo3": {Fingerprint: "fp-stable"}}

	// Establish the baseline first (a separate, realistic pass).
	if n, _ := convergeUsbFreshness(liveState, rec, usbVolume{MountPath: card}, "lossless"); n != 0 {
		t.Fatalf("baseline pass refreshed = %d, want 0", n)
	}

	// Now the person picks a different cover.
	if err := os.Remove(filepath.Join(srcDir, "cover.jpg")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "cover.jpg"), pngBytes, 0o644); err != nil {
		t.Fatal(err)
	}

	n, stalled := convergeUsbFreshness(liveState, rec, usbVolume{MountPath: card}, "lossless")
	if n != 1 || stalled {
		t.Fatalf("refreshed=%d stalled=%v, want 1/false", n, stalled)
	}
	data, _ := flacArt(onCard)
	if !bytes.Equal(data, pngBytes) {
		t.Fatal("embedded art was not refreshed to the new cover")
	}
	got := readUsbManifest(card).Tracks["lid-clairo3"]
	newStat, err := os.Stat(filepath.Join(srcDir, "cover.jpg"))
	if err != nil {
		t.Fatal(err)
	}
	if got.CoverSize != newStat.Size() || got.CoverModUnix != newStat.ModTime().Unix() {
		t.Fatal("manifest cover baseline was not updated to the new cover's stat")
	}
	// The audio fingerprint baseline must be untouched by a cover-only change.
	if got.AudioFingerprint != "fp-stable" {
		t.Fatalf("AudioFingerprint = %q, want unchanged fp-stable", got.AudioFingerprint)
	}
}

// TestConvergeUsbFreshnessFailedCoverRefreshKeepsOldBaseline: a real embed
// failure (a corrupt new cover) must not zero out a track's existing valid
// baseline — that would make a track that's still genuinely out of sync look
// like it has no cover history at all, and would keep costing a real ffmpeg
// attempt every reconcile pass with less information than before, not more.
func TestConvergeUsbFreshnessFailedCoverRefreshKeepsOldBaseline(t *testing.T) {
	card, rec, srcDir, _ := setUpFreshnessTrack(t, "usb-clairo6", "lid-clairo6")
	liveState.AudioObservations = map[string]trackObservation{"lid-clairo6": {Fingerprint: "fp-stable"}}
	if n, _ := convergeUsbFreshness(liveState, rec, usbVolume{MountPath: card}, "lossless"); n != 0 {
		t.Fatalf("baseline pass refreshed = %d, want 0", n)
	}
	before := readUsbManifest(card).Tracks["lid-clairo6"]
	if before.CoverSize == 0 {
		t.Fatal("test setup: no real baseline to protect")
	}

	// The cover changes to something ffmpeg will refuse outright.
	if err := os.Remove(filepath.Join(srcDir, "cover.jpg")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(srcDir, "cover.jpg"), []byte("not actually a jpeg"), 0o644); err != nil {
		t.Fatal(err)
	}

	convergeUsbFreshness(liveState, rec, usbVolume{MountPath: card}, "lossless")

	after := readUsbManifest(card).Tracks["lid-clairo6"]
	if after.CoverSize != before.CoverSize || after.CoverModUnix != before.CoverModUnix {
		t.Fatalf("baseline changed on a failed embed: before={%d,%d} after={%d,%d}",
			before.CoverSize, before.CoverModUnix, after.CoverSize, after.CoverModUnix)
	}
	if !after.Cover {
		// settled must go back to false so the failure is visibly retried
		// (convergeUsbCovers's own !e.Cover sweep would also pick it up).
		t.Log("Cover correctly flipped to false after the failed attempt")
	} else {
		t.Fatal("Cover should not read as settled after a failed embed")
	}
}

// TestConvergeUsbFreshnessRecopiesOnAudioChange is the actual feature the
// founder asked for: a re-rip (or any in-place edit) changes the file's
// content fingerprint, and the card's copy is refreshed to match — the
// corded counterpart of the phone's track-freshness sweep.
func TestConvergeUsbFreshnessRecopiesOnAudioChange(t *testing.T) {
	card, rec, srcDir, onCard := setUpFreshnessTrack(t, "usb-clairo4", "lid-clairo4")
	liveState.AudioObservations = map[string]trackObservation{"lid-clairo4": {Fingerprint: "fp-original"}}
	if n, _ := convergeUsbFreshness(liveState, rec, usbVolume{MountPath: card}, "lossless"); n != 0 {
		t.Fatalf("baseline pass refreshed = %d, want 0", n)
	}

	beforeBytes, err := os.ReadFile(onCard)
	if err != nil {
		t.Fatal(err)
	}

	// Simulate a re-rip: the library file's bytes change in place (same path,
	// like rip.go's atomic overwrite, deliberately a different duration so
	// the refresh is verifiable by more than a raw byte diff), and
	// library-sync's own independent pass has already recorded the new
	// fingerprint.
	src := filepath.Join(srcDir, "01 - Nomad.flac")
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not on PATH")
	}
	wav2 := filepath.Join(t.TempDir(), "rerip.wav")
	if out, err := exec.Command("ffmpeg", "-v", "error", "-y", "-f", "lavfi",
		"-i", "sine=frequency=440:duration=2", "-ac", "2", "-ar", "44100", wav2).CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg synth wav: %v %s", err, out)
	}
	if out, err := exec.Command("ffmpeg", "-v", "error", "-y", "-i", wav2, src).CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg flac re-encode over src: %v %s", err, out)
	}
	liveState.AudioObservations["lid-clairo4"] = trackObservation{Fingerprint: "fp-rerip"}

	n, stalled := convergeUsbFreshness(liveState, rec, usbVolume{MountPath: card}, "lossless")
	if n != 1 || stalled {
		t.Fatalf("refreshed=%d stalled=%v, want 1/false", n, stalled)
	}
	afterBytes, err := os.ReadFile(onCard)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(beforeBytes, afterBytes) {
		t.Fatal("on-card file bytes unchanged — the re-rip was not picked up at all")
	}
	dur := ffprobeDuration(t, onCard)
	if dur < 1.9 || dur > 2.1 {
		t.Fatalf("on-card duration = %.2fs, want ~2s (the re-ripped length), not the original 1s", dur)
	}
	got := readUsbManifest(card).Tracks["lid-clairo4"]
	if got.AudioFingerprint != "fp-rerip" {
		t.Fatalf("AudioFingerprint = %q, want fp-rerip", got.AudioFingerprint)
	}
	// The re-copy re-embeds the (unchanged) cover as a side effect of going
	// through usbMaterialise, same as any fresh add.
	if data, _ := flacArt(onCard); !bytes.Equal(data, jpegBytes) {
		t.Error("cover art lost across the audio refresh")
	}
}

func ffprobeDuration(t *testing.T, path string) float64 {
	t.Helper()
	out, err := exec.Command("ffprobe", "-v", "error", "-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1", path).Output()
	if err != nil {
		t.Fatalf("ffprobe: %v", err)
	}
	var dur float64
	if _, err := fmt.Sscanf(string(out), "%f", &dur); err != nil {
		t.Fatalf("parse ffprobe duration %q: %v", out, err)
	}
	return dur
}

// TestConvergeUsbFreshnessStableCardMakesNoChanges: once a baseline exists
// and nothing has actually changed, a pass touches neither the audio file
// nor the cover.
func TestConvergeUsbFreshnessStableCardMakesNoChanges(t *testing.T) {
	card, rec, _, onCard := setUpFreshnessTrack(t, "usb-clairo5", "lid-clairo5")
	liveState.AudioObservations = map[string]trackObservation{"lid-clairo5": {Fingerprint: "fp-stable"}}
	if n, _ := convergeUsbFreshness(liveState, rec, usbVolume{MountPath: card}, "lossless"); n != 0 {
		t.Fatalf("baseline pass refreshed = %d, want 0", n)
	}
	before, _ := os.ReadFile(onCard)
	beforeInfo, _ := os.Stat(onCard)

	n, stalled := convergeUsbFreshness(liveState, rec, usbVolume{MountPath: card}, "lossless")
	if n != 0 || stalled {
		t.Fatalf("refreshed=%d stalled=%v, want 0/false on a stable card", n, stalled)
	}
	after, _ := os.ReadFile(onCard)
	afterInfo, _ := os.Stat(onCard)
	if !bytes.Equal(before, after) || !beforeInfo.ModTime().Equal(afterInfo.ModTime()) {
		t.Fatal("a stable card was touched on a no-op pass")
	}
}
