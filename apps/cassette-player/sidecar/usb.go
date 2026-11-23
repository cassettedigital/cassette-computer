// Corded devices — USB players and memory cards as sync targets.
//
// A phone pairs itself: it registers with the cloud, polls for instructions and
// pulls bytes from the hub. A USB player can do none of that, so the hub stands
// in for it. This file is that stand-in. The hub watches for removable volumes,
// recognises the ones a person has ADDED (never a drive that merely showed up),
// registers them with the cloud as devices, and copies music onto them through
// the same intent queue the phones use, so from the web they look like one more
// device tile with a coverage meter.
//
// Safety rules, in order of importance:
//   - Nothing is a device until a person clicks Add. A stranger volume is only
//     ever listed, never written to.
//   - Recognition is the marker file inside the Cassette folder on the card. A
//     wiped card loses its marker and becomes a stranger again.
//   - The hub only writes and deletes inside <mount>/Cassette/. Everything else
//     on the card belongs to the person and is never read as inventory or touched.
//   - What is on the card is known from the manifest the hub writes there, keyed
//     on the hub's own track id, never inferred from filenames.
//   - Each track lands under a temporary name and is renamed only once complete,
//     so a yanked cable never leaves a half file the player tries to play.
//   - Removes come only from the cloud's reconciler, behind its own gates; a pass
//     that loses the card mid-way puts the instruction back to pending so the
//     next plug-in resumes it.
//
// Cloud protocol (the phone's, reused verbatim, all over the hub's own bearer):
//   POST /api/sync/devices                        register / presence (platform "usb")
//   POST /api/sync/device-inventory               full_state on each plug-in (the cloud
//                                                 reconciles on it), diffs after
//   GET  /api/sync/account                        the download quality to apply
//   GET  /api/sync/intents?state=pending          the queue (filtered to this device)
//   GET  /api/sync/intents/{id}/tracks            resolve one instruction to tracks
//   PUT  /api/sync/intents/{id}                   syncing / complete / failed / pending
//
// The hub never sends the X-Cassette-Device-Id header for a USB device, and the
// cloud skips the token↔device stamp for platform "usb": the hub's own token
// must never be bound to a card, or removing the card would revoke the hub.

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	usbFolderName     = "Cassette"
	usbMarkerFile     = ".cassette-device.json"
	usbManifestFile   = ".cassette-manifest.json"
	usbPartialExt     = ".partial"
	usbDeviceIDPrefix = "usb-"

	// How often the hub looks for plugged-in devices.
	usbPollInterval = 3 * time.Second
	// While a device is mounted: how often it re-registers so its tile's light
	// stays live (the cloud's reachable window is five minutes).
	usbPresenceInterval = 2 * time.Minute
	// While mounted: how often the cloud reconciler is asked for a fresh diff, so
	// an album marked on the web lands without unplugging and replugging.
	usbReconcileInterval = 10 * time.Minute
	// While mounted: how often the pending queue is checked (a Sync Now click on
	// the web queues instructions the hub has to notice).
	usbIntentPollInterval = 20 * time.Second
	// Room to leave on the card so the player's own metadata/db writes never hit
	// a full volume because of us.
	usbFreeReserveBytes = int64(64 << 20)
	// A conversion writes the new file before the old one goes, so it only needs
	// the new file to fit with a little margin: the old file's bytes come back
	// right after. This is how a card full of originals frees itself.
	usbReplaceMarginBytes = int64(8 << 20)

	// A transcoded track streams out of Navidrome (ffmpeg) at well over realtime;
	// this bounds a wedged encode, not a slow one.
	usbTranscodeTimeout = 10 * time.Minute

	// Embedding a cover is a remux, not an encode — near instant. This bounds a
	// wedged ffmpeg, not a slow one.
	usbEmbedTimeout = 2 * time.Minute

	// A ".partial" untouched this long is a copy the hub never finished (quit or
	// slept mid-track), not one in progress.
	usbStalePartialAge = 10 * time.Minute

	// Tracks materialise a few at a time: a transcode is one ffmpeg at ~90% of a
	// core for ~2 s, so one-at-a-time made a first fill of a library an hour
	// (2026-09-15, 1,600 tracks). Bounded so a laptop stays usable; the card and
	// the manifest are still written by one goroutine at a time.
	usbCopyWorkersMax = 3

	usbManifestVersion = 1
)

// usbCopyWorkers is how many tracks materialise concurrently on this machine.
func usbCopyWorkers() int {
	n := runtime.NumCPU() / 2
	if n < 1 {
		n = 1
	}
	if n > usbCopyWorkersMax {
		n = usbCopyWorkersMax
	}
	return n
}

// usbCopyJob is one track to put on the card: where it comes from, where it
// lands, and how (a copy of the original, or a transcode from Navidrome).
type usbCopyJob struct {
	localID    string
	subsonicID string
	title      string
	src        string // the library file (resolved)
	rel        string // manifest-relative destination
	dst        string // absolute destination on the card
	transcode  bool
	kbps       int
	ext        string
	need       int64 // bytes the room guard reserved for it
}

// usbCoverOutcome is what one track's cover-embed attempt (or check) resolved
// to, threaded from usbEmbedIfCovered through usbMaterialise /
// usbEmbedExistingCover to the onDone callback that writes the manifest.
type usbCoverOutcome struct {
	// settled is whether the cover step is now settled for this track — true
	// whether art was actually found and embedded, or the album genuinely has
	// none (nothing more this step can do about that); false only when an
	// embed was attempted and failed, worth trying again later. Recorded on
	// the manifest entry (usbManifestTrack.Cover) so convergeUsbCovers's
	// backfill pass never retries a track forever just because its album has
	// no cover — see that field's own doc comment for why this distinction
	// is load-bearing, not cosmetic (BUG-356 was exactly this failure shape).
	settled bool
	// size and modUnix are the SOURCE folder cover's stat at the moment it
	// was embedded (zero when there was none) — the cheap gate
	// convergeUsbFreshness later compares against to notice the person
	// picked a different cover, without ever hashing a cover file.
	size    int64
	modUnix int64
}

type usbCopyResult struct {
	job   usbCopyJob
	size  int64
	cover usbCoverOutcome
	err   error
}

// usbMaterialise performs one job: copy or transcode into place, then embeds
// the album's folder cover into the file, so a player with a screen but no
// companion app (which reads per-file art, never a sibling cover.jpg) still
// shows one. Safe to run concurrently with other jobs (distinct destinations).
func usbMaterialise(job usbCopyJob) (int64, usbCoverOutcome, error) {
	n := job.need
	var err error
	if job.transcode {
		n, err = streamToFileAtomic(usbTranscodeURL(job.subsonicID, job.ext, job.kbps), job.dst)
	} else {
		err = copyFileAtomic(job.src, job.dst)
	}
	if err != nil {
		return 0, usbCoverOutcome{}, err
	}
	n2, outcome := usbEmbedIfCovered(job.dst, filepath.Dir(job.src), n)
	return n2, outcome, nil
}

// usbEmbedIfCovered embeds dst's album folder cover (read from srcDir) into
// dst in place, if one exists. Returns the file's final size (fallback if
// nothing changed) and the outcome: settled=true when art was embedded OR the
// album genuinely has no cover to embed (accepted, same as an album page
// honestly showing no art rather than a gap to force); settled=false only
// when embedding was attempted and failed, so a later pass tries again — the
// person may replace the source cover (the hub never rewrites one it can't
// read, BUG-775). Never an error: a missing or corrupt cover is cosmetic, never
// worth failing (or re-queueing) the track over.
func usbEmbedIfCovered(dst, srcDir string, fallbackSize int64) (size int64, outcome usbCoverOutcome) {
	// A lossless copy of a read-only file (M4A) keeps the art Apple embedded and is
	// never remuxed: settled, or it would be retried as owed on every pass.
	if _, ok := usbFfmpegContainerFormat(filepath.Ext(dst)); !ok {
		return fallbackSize, usbCoverOutcome{settled: true}
	}
	cover, ok := usbFindFolderCover(srcDir)
	if !ok {
		return fallbackSize, usbCoverOutcome{settled: true} // nothing to embed; not owed again
	}
	coverStat, statErr := os.Stat(cover)
	if statErr != nil {
		return fallbackSize, usbCoverOutcome{settled: true} // found via ReadDir a moment ago; treat as gone
	}
	if err := usbEmbedCoverArt(dst, cover); err != nil {
		log.Printf("usb: embed cover into %q failed: %v", dst, err)
		return fallbackSize, usbCoverOutcome{settled: false}
	}
	newSize := fallbackSize
	if fi, statErr := os.Stat(dst); statErr == nil {
		newSize = fi.Size() // the manifest/meter should reflect the file as embedded
	}
	return newSize, usbCoverOutcome{settled: true, size: coverStat.Size(), modUnix: coverStat.ModTime().Unix()}
}

// usbEmbedExistingCover is usbMaterialise's counterpart for a track ALREADY
// on the card (convergeUsbCovers's backfill pass, for a track that landed
// before cover-embedding existed; convergeUsbFreshness's cover-refresh pass,
// for one whose source cover changed): no copy or transcode, just the same
// in-place embed.
func usbEmbedExistingCover(job usbCopyJob) (int64, usbCoverOutcome, error) {
	fi, err := os.Stat(job.dst)
	if err != nil {
		return 0, usbCoverOutcome{}, err
	}
	n, outcome := usbEmbedIfCovered(job.dst, filepath.Dir(job.src), fi.Size())
	return n, outcome, nil
}

// usbFfmpegContainerFormat maps a destination extension to the ffmpeg muxer
// name for it. Only FLAC (a lossless copy) and MP3 (a copy, or the transcoder's
// output) are ever remuxed; anything else, such as a lossless M4A copy, is
// refused rather than guessed at (usbEmbedIfCovered skips it up front).
func usbFfmpegContainerFormat(ext string) (string, bool) {
	switch strings.ToLower(ext) {
	case ".mp3":
		return "mp3", true
	case ".flac":
		return "flac", true
	}
	return "", false
}

// usbEmbedCoverArt remuxes cover into dst's picture stream in place (temp file
// + rename, like every other card write): the audio is never re-encoded, only
// an attached-picture stream is added, so this is a fast copy, not a
// transcode. Works for both mp3 (ID3 APIC) and flac (METADATA_BLOCK_PICTURE)
// destinations — ffmpeg maps the attached-picture disposition the same way
// for either container. The output format is passed explicitly (`-f`) rather
// than sniffed from the temp file's name, since that name ends in
// usbPartialExt, not the real extension.
func usbEmbedCoverArt(dst, cover string) error {
	format, ok := usbFfmpegContainerFormat(filepath.Ext(dst))
	if !ok {
		return fmt.Errorf("embedding art into %q: unsupported format", filepath.Base(dst))
	}
	tmp := dst + ".art" + usbPartialExt
	args := []string{
		"-v", "error", "-y",
		"-i", dst, "-i", cover,
		"-map", "0:a", "-map", "1:v",
		"-c:a", "copy", "-c:v", "copy",
		"-disposition:v", "attached_pic",
	}
	if format == "mp3" {
		args = append(args,
			"-id3v2_version", "3",
			"-metadata:s:v", "title=Album cover",
			"-metadata:s:v", "comment=Cover (front)",
		)
	}
	args = append(args, "-f", format, tmp)

	ctx, cancel := context.WithTimeout(context.Background(), usbEmbedTimeout)
	defer cancel()
	if out, err := exec.CommandContext(ctx, "ffmpeg", args...).CombinedOutput(); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("ffmpeg embed: %v: %.200s", err, out)
	}
	if err := os.Rename(tmp, dst); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	usbScrub(dst)
	return nil
}

// usbRunCopies runs jobs through `do` with at most `workers` in flight and
// hands every result to onDone from ONE goroutine, in completion order, so the
// manifest, the folder cover and the progress counter are never touched by two
// jobs at once. Returns once every job has been reported.
func usbRunCopies(jobs []usbCopyJob, workers int, do func(usbCopyJob) (int64, usbCoverOutcome, error), onDone func(usbCopyResult)) {
	if len(jobs) == 0 {
		return
	}
	if workers < 1 {
		workers = 1
	}
	if workers > len(jobs) {
		workers = len(jobs)
	}
	queue := make(chan usbCopyJob)
	results := make(chan usbCopyResult)
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for job := range queue {
				size, cover, err := do(job)
				results <- usbCopyResult{job: job, size: size, cover: cover, err: err}
			}
		}()
	}
	go func() {
		for _, j := range jobs {
			queue <- j
		}
		close(queue)
		wg.Wait()
		close(results)
	}()
	for r := range results {
		onDone(r)
	}
}

// usbMarker is the identity file at <mount>/Cassette/.cassette-device.json.
// Its presence, and a device id the hub knows, is what makes a volume a device.
type usbMarker struct {
	DeviceID   string    `json:"deviceId"`
	Label      string    `json:"label"`
	VolumeUUID string    `json:"volumeUuid,omitempty"`
	AddedAt    time.Time `json:"addedAt"`
}

// usbManifestTrack is one track the hub put on the card.
type usbManifestTrack struct {
	// Path is relative to <mount>/Cassette, forward slashes.
	Path         string    `json:"path"`
	SubsonicID   string    `json:"subsonicId,omitempty"`
	Size         int64     `json:"size"`
	DownloadedAt time.Time `json:"downloadedAt"`
	// Tier the file was written at: lossless (the original), high or efficient
	// (an MP3 from the transcoder). Empty on entries written before tiers were
	// recorded; see usbEntryTier. The card converges to the account's tier, so
	// a mismatch here is work to do, not history.
	Tier string `json:"tier,omitempty"`
	// Cover is whether the cover step has settled for this track — true once
	// art was embedded OR its album was confirmed to have none to embed;
	// false only means "not checked yet" or "checked and worth retrying"
	// (see usbEmbedIfCovered). False (the zero value) on every entry written
	// before cover-embedding existed, which is what makes it double as a
	// backlog marker: convergeUsbCovers only ever looks at false entries, and
	// an album with genuinely no cover still settles to true so it is never
	// re-checked forever (BUG-356 was exactly that failure shape elsewhere).
	Cover bool `json:"cover,omitempty"`

	// The fields below are convergeUsbFreshness's baseline: what the source
	// looked like the last time this track was materialised, so a later pass
	// can notice a re-rip or a changed cover with cheap local checks — no
	// Navidrome round trip, no re-hashing a file that hasn't moved. Empty/zero
	// on every entry written before this existed. A MISSING baseline is never
	// itself evidence of staleness — see convergeUsbFreshness's file comment
	// for why that distinction has to hold, or day one of this feature would
	// force a full re-copy of every already-synced card.

	// LibraryPath is the resolved absolute source path as of the last
	// materialise. Cached so later passes can stat it (and its album's
	// folder) directly instead of resolving it via Navidrome's getSong again.
	LibraryPath string `json:"libraryPath,omitempty"`
	// AudioFingerprint is the source file's content fingerprint (the same
	// signal library-sync already computes for phones' own freshness
	// checking, audio-fingerprint.go) as of the last materialise.
	AudioFingerprint string `json:"audioFingerprint,omitempty"`
	// CoverSize/CoverModUnix are the source folder cover's stat as of the
	// last embed — deliberately a stat, not a hash: a false-positive refresh
	// here only costs a cheap remux, so there's no need for the rigor (or the
	// I/O) audio staleness detection needs.
	CoverSize    int64 `json:"coverSize,omitempty"`
	CoverModUnix int64 `json:"coverModUnix,omitempty"`
}

// usbManifest is the hub's record of what it put on the card, keyed by
// cassette_local_id. It is the device's inventory; filenames are never read
// back to infer ownership.
type usbManifest struct {
	Version int                         `json:"version"`
	Tracks  map[string]usbManifestTrack `json:"tracks"`
}

// usbDeviceRecord is the hub's persisted memory of an added device
// (SidecarState.UsbDevices). Losing it makes the card a stranger again, which
// is the safe direction.
type usbDeviceRecord struct {
	DeviceID   string    `json:"deviceId"`
	Label      string    `json:"label"`
	VolumeUUID string    `json:"volumeUuid,omitempty"`
	AddedAt    time.Time `json:"addedAt"`
	Paused     bool      `json:"paused,omitempty"`
	LastSyncAt time.Time `json:"lastSyncAt,omitempty"`
	LastError  string    `json:"lastError,omitempty"`
}

// usbProgress is the live copy progress for one device.
type usbProgress struct {
	Done    int    `json:"done"`
	Total   int    `json:"total"`
	Current string `json:"current,omitempty"`
	// "copying" (adds), "converting" (re-encoding what's already on the card
	// to the account's tier), or "refreshing" (a re-ripped track or a
	// changed cover catching up, convergeUsbFreshness); empty when idle.
	Phase string `json:"phase,omitempty"`
}

// usbLiveState is the in-memory, per-device runtime picture (never persisted).
type usbLiveState struct {
	Mounted        bool
	MountPath      string
	MountedAt      time.Time
	Syncing        bool
	Progress       usbProgress
	lastPresence   time.Time
	lastReconcile  time.Time
	lastIntentPoll time.Time
	pendingIntents int
	// fullAtFree > 0 means the card ran out of room at that many free bytes:
	// adds hold (only removes drain) until free space grows past it or the card
	// is re-plugged. Otherwise the reconciler re-queues every missing album on
	// every pass and the hub fails each one again (BUG-356).
	fullAtFree int64
	// tier is the account download quality as last read from the cloud
	// (refreshed with presence, every couple of minutes while plugged in).
	tier string
}

var (
	usbMu   sync.Mutex
	usbLive = map[string]*usbLiveState{}
	// usbPasses counts sync passes in flight, so a caller (tests, a future
	// clean shutdown) can wait for the background work to settle.
	usbPasses sync.WaitGroup
)

// ─── Marker + manifest (the only things the hub writes besides music) ────────

func usbFolder(mount string) string { return filepath.Join(mount, usbFolderName) }

func usbMarkerPath(mount string) string { return filepath.Join(usbFolder(mount), usbMarkerFile) }

func usbManifestPath(mount string) string { return filepath.Join(usbFolder(mount), usbManifestFile) }

// readUsbMarker returns the marker on the volume, nil when there is none, or an
// error when one exists but can't be read (treated as absent by callers).
func readUsbMarker(mount string) (*usbMarker, error) {
	b, err := os.ReadFile(usbMarkerPath(mount))
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var m usbMarker
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	if strings.TrimSpace(m.DeviceID) == "" {
		return nil, errors.New("marker has no deviceId")
	}
	return &m, nil
}

func writeUsbMarker(mount string, m usbMarker) error {
	if err := os.MkdirAll(usbFolder(mount), 0o755); err != nil {
		return err
	}
	return writeJSONAtomic(usbMarkerPath(mount), m)
}

func readUsbManifest(mount string) usbManifest {
	m := usbManifest{Version: usbManifestVersion, Tracks: map[string]usbManifestTrack{}}
	b, err := os.ReadFile(usbManifestPath(mount))
	if err != nil {
		return m
	}
	var parsed usbManifest
	if err := json.Unmarshal(b, &parsed); err != nil || parsed.Tracks == nil {
		return m
	}
	parsed.Version = usbManifestVersion
	return parsed
}

func writeUsbManifest(mount string, m usbManifest) error {
	if err := os.MkdirAll(usbFolder(mount), 0o755); err != nil {
		return err
	}
	return writeJSONAtomic(usbManifestPath(mount), m)
}

// writeJSONAtomic writes to a sibling temp file and renames, so a yanked cable
// mid-write leaves the previous file intact rather than a truncated one.
func writeJSONAtomic(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + usbPartialExt
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		return err
	}
	usbScrub(path)
	return nil
}

// pruneUsbManifest drops entries whose file is no longer on the card (the
// person deleted it from the player's own menu, say). Returns the pruned
// manifest and how many entries went.
func pruneUsbManifest(mount string, m usbManifest) (usbManifest, int) {
	pruned := 0
	for id, t := range m.Tracks {
		if _, err := os.Stat(usbCardPath(mount, t.Path)); err != nil {
			delete(m.Tracks, id)
			pruned++
		}
	}
	return m, pruned
}

// usbCardPath maps a manifest-relative path back to the absolute path on the
// card. Always under <mount>/Cassette; a relative path that tries to climb out
// is clamped to the folder itself (and would then never match a real file).
func usbCardPath(mount, rel string) string {
	clean := filepath.Clean("/" + filepath.FromSlash(rel))
	return filepath.Join(usbFolder(mount), clean)
}

// usbMounted reports whether the added device is still plugged in: its marker
// is readable at the mount path. Checked before every file operation.
func usbMounted(mount string) bool {
	_, err := os.Stat(usbMarkerPath(mount))
	return err == nil
}

// ─── Paths on the card ───────────────────────────────────────────────────────

// fatSafeSegment makes one path segment legal on FAT32/exFAT (the filesystems
// nearly every player ships with): the characters those refuse, plus control
// characters, become underscores; trailing dots and spaces go.
func fatSafeSegment(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r < 0x20 || r == 0x7f:
			b.WriteRune('_')
		case strings.ContainsRune(`\/:*?"<>|`, r):
			b.WriteRune('_')
		default:
			b.WriteRune(r)
		}
	}
	out := strings.TrimRight(b.String(), ". ")
	if out == "" {
		return "_"
	}
	return out
}

// usbRelPath returns the manifest-relative path a library file gets on the
// card: its own path relative to the music folder, segment by segment made
// FAT-safe. The person's folder layout and file names travel with the music;
// the hub invents no naming scheme of its own.
func usbRelPath(src string) (string, error) {
	musicDir, err := filepath.Abs(sidecarMusicDir)
	if err != nil {
		return "", err
	}
	// A song in a folder Cassette reads where it is goes by its place in that folder (library-folders.go).
	if root := linkedRootFor(src); root != "" {
		musicDir = root
	}
	rel, err := filepath.Rel(filepath.Clean(musicDir), filepath.Clean(src))
	if err != nil {
		return "", err
	}
	if rel == "." || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("%q is not inside the music folder", src)
	}
	parts := strings.Split(filepath.ToSlash(rel), "/")
	for i, p := range parts {
		parts[i] = fatSafeSegment(p)
	}
	return strings.Join(parts, "/"), nil
}

// usbHasRoom is the free-space guard: unknown free space (negative) never
// blocks; otherwise the file must fit with the reserve to spare.
func usbHasRoom(freeBytes, fileSize int64) bool {
	if freeBytes < 0 {
		return true
	}
	return freeBytes-fileSize >= usbFreeReserveBytes
}

// copyFileAtomic copies src to dst via dst+".partial" and a rename, fsyncing
// before the rename. A failure at any point removes the partial file.
func copyFileAtomic(src, dst string) (err error) {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	tmp := dst + usbPartialExt
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = out.Close()
			_ = os.Remove(tmp)
		}
	}()
	if _, err = io.Copy(out, in); err != nil {
		return err
	}
	if err = out.Sync(); err != nil {
		return err
	}
	if err = out.Close(); err != nil {
		return err
	}
	if err = os.Rename(tmp, dst); err != nil {
		return err
	}
	usbScrub(dst)
	return nil
}

// usbScrub strips OS-stamped attributes from something the hub just wrote on
// the card (see usbPlatform.scrubFile).
func usbScrub(path string) {
	if usbOS != nil {
		usbOS.scrubFile(path)
	}
}

// usbSweepAppleDouble walks the hub's own folder on the card, deletes every
// "._" AppleDouble sidecar and scrubs the attributes that would make macOS
// write them again, and drops any ".partial" a killed copy left behind once it
// has sat untouched for a while (a live copy is written continuously). Only
// ever runs inside <mount>/Cassette.
func usbSweepAppleDouble(root string) (removed int) {
	stale := time.Now().Add(-usbStalePartialAge)
	_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !d.IsDir() && strings.HasPrefix(d.Name(), "._") {
			if os.Remove(p) == nil {
				removed++
			}
			return nil
		}
		if !d.IsDir() && strings.HasSuffix(d.Name(), usbPartialExt) {
			if fi, err := d.Info(); err == nil && fi.ModTime().Before(stale) {
				if os.Remove(p) == nil {
					removed++
				}
			}
			return nil
		}
		usbScrub(p)
		return nil
	})
	return removed
}

// streamToFileAtomic pulls one HTTP audio stream (a Navidrome transcode) into
// dst via dst+".partial" and a rename. Navidrome answers an error as an XML or
// JSON envelope with status 200, so the content type is checked before a byte
// is kept. Returns the bytes written.
func streamToFileAtomic(src, dst string) (n int64, err error) {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return 0, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), usbTranscodeTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, src, nil)
	if err != nil {
		return 0, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("stream → HTTP %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); strings.Contains(ct, "xml") || strings.Contains(ct, "json") || strings.Contains(ct, "text/") {
		return 0, fmt.Errorf("stream answered %s, not audio", ct)
	}
	tmp := dst + usbPartialExt
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
	if err != nil {
		return 0, err
	}
	defer func() {
		if err != nil {
			_ = out.Close()
			_ = os.Remove(tmp)
		}
	}()
	if n, err = io.Copy(out, resp.Body); err != nil {
		return 0, err
	}
	if n == 0 {
		err = errors.New("stream was empty")
		return 0, err
	}
	if err = out.Sync(); err != nil {
		return 0, err
	}
	if err = out.Close(); err != nil {
		return 0, err
	}
	if err = os.Rename(tmp, dst); err != nil {
		return 0, err
	}
	usbScrub(dst)
	return n, nil
}

// ─── Download quality (the account tier, applied to the card) ────────────────

// usbAccountTier reads the account's download quality, the same setting the
// phone applies to its downloads. Unreachable cloud → copy originals, said in
// the log, never silently.
func usbAccountTier() string {
	var parsed struct {
		DownloadQuality string `json:"downloadQuality"`
	}
	if err := cloudJSON(http.MethodGet, "/api/sync/account", nil, &parsed); err != nil {
		log.Printf("usb: download quality unavailable (%v); copying originals this pass", err)
		return "lossless"
	}
	switch parsed.DownloadQuality {
	case "high", "efficient":
		return parsed.DownloadQuality
	}
	return "lossless"
}

// usbTierParams maps the tier to what lands on the card: lossless = the
// original file; high = MP3 256; efficient = MP3 128 (the labels the device
// page shows). The MP3s come out of Navidrome's transcoder (bundled ffmpeg).
func usbTierParams(tier string) (transcode bool, kbps int, ext string) {
	switch tier {
	case "high":
		return true, 256, "mp3"
	case "efficient":
		return true, 128, "mp3"
	}
	return false, 0, ""
}

// usbEstimateBytes sizes a transcode before it exists, for the room guard:
// bitrate × duration, plus a tenth for headers and encoder slack. Unknown
// duration assumes five minutes.
func usbEstimateBytes(kbps int, duration *int) int64 {
	secs := 300
	if duration != nil && *duration > 0 {
		secs = *duration
	}
	return int64(kbps) * 1000 / 8 * int64(secs) * 11 / 10
}

// usbTranscodeURL is Navidrome's stream endpoint asked for a specific format
// and ceiling bitrate (Subsonic API `format` + `maxBitRate`).
func usbTranscodeURL(subsonicID, ext string, kbps int) string {
	return subsonicStreamURL(subsonicID) + "&format=" + url.QueryEscape(ext) + "&maxBitRate=" + strconv.Itoa(kbps)
}

// usbEntryTier is what a manifest entry was written at. Entries from before
// tiers were recorded are the original file unless they are MP3s, whose
// bitrate is not knowable from the name: those are left alone ("unknown").
func usbEntryTier(e usbManifestTrack) string {
	if e.Tier != "" {
		return e.Tier
	}
	if strings.EqualFold(filepath.Ext(e.Path), ".mp3") {
		return "unknown"
	}
	return "lossless"
}

// usbHasRoomToReplace is the room guard for a conversion: the replacement must
// fit now (with a small margin); the file it replaces is freed straight after.
func usbHasRoomToReplace(freeBytes, need int64) bool {
	if freeBytes < 0 {
		return true
	}
	return freeBytes-need >= usbReplaceMarginBytes
}

// usbAudioFingerprintSnapshot copies state.AudioObservations' current
// fingerprints (cassette_local_id → content fingerprint) under librarySyncMu
// — the SAME lock library-sync.go's attachAudioFingerprints already holds
// while writing that map. Without this, USB convergence reading the map
// concurrently with an hourly (or ingest-triggered) library-sync pass would
// be a real, race-detector-flagged concurrent map access, not a theoretical
// one. Taken once per convergence pass and worked from as a plain local copy
// afterward, rather than holding the lock per track, so a long USB pass
// never blocks library-sync (or vice versa) for its duration.
func usbAudioFingerprintSnapshot(state *SidecarState) map[string]string {
	out := map[string]string{}
	if state == nil {
		return out
	}
	librarySyncMu.Lock()
	defer librarySyncMu.Unlock()
	for id, obs := range state.AudioObservations {
		out[id] = obs.Fingerprint
	}
	return out
}

// convergeUsbTiers re-materialises every track on the card whose tier is not
// the account's current tier: a FLAC original becomes an MP3 at the chosen
// bitrate (and frees most of its space), an MP3 becomes the original again
// when the tier goes back to Lossless. The track's identity (cassette_local_id)
// never changes, so the cloud inventory needs no update. Returns how many
// converted and whether it stopped early (card unplugged or out of room).
func convergeUsbTiers(state *SidecarState, rec *usbDeviceRecord, vol usbVolume, tier string) (converted int, stalled bool) {
	mount := vol.MountPath
	manifest := readUsbManifest(mount)
	audioNow := usbAudioFingerprintSnapshot(state)
	transcode, kbps, ext := usbTierParams(tier)
	var ids []string
	for id, e := range manifest.Tracks {
		if t := usbEntryTier(e); t != "unknown" && t != tier {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return 0, false
	}
	sort.Slice(ids, func(i, j int) bool { return manifest.Tracks[ids[i]].Path < manifest.Tracks[ids[j]].Path })
	log.Printf("usb: %s converging %d tracks to %s", rec.DeviceID, len(ids), tier)

	// Plan first, one track at a time: resolve, size, and reserve room against
	// a running free-space figure so concurrent jobs can't overshoot the card.
	freeLeft := usbOS.freeBytes(mount)
	var jobs []usbCopyJob
	for _, id := range ids {
		if !usbMounted(mount) {
			return 0, true
		}
		e := manifest.Tracks[id]
		src, err := resolveSongFile(e.SubsonicID, trackHint{})
		if err != nil {
			log.Printf("usb: convert %q: library file not found (%v); left as is", e.Path, err)
			continue
		}
		rel, err := usbRelPath(src)
		if err != nil {
			log.Printf("usb: convert %q: %v", e.Path, err)
			continue
		}
		var need int64
		if transcode {
			rel = strings.TrimSuffix(rel, filepath.Ext(rel)) + "." + ext
			need = usbEstimateBytes(kbps, nil)
		} else {
			fi, err := os.Stat(src)
			if err != nil {
				continue
			}
			need = fi.Size()
		}
		if !usbHasRoomToReplace(freeLeft, need) {
			usbSetFull(rec.DeviceID, usbOS.freeBytes(mount))
			usbNoteError(state, rec, fmt.Sprintf("Not enough room on %s to convert", rec.Label))
			log.Printf("usb: %s: no room to convert (%d MB free); holding", rec.DeviceID, freeLeft>>20)
			stalled = true
			break
		}
		if freeLeft >= 0 {
			freeLeft -= need
		}
		jobs = append(jobs, usbCopyJob{
			localID: id, subsonicID: e.SubsonicID, title: filepath.Base(e.Path),
			src: src, rel: rel, dst: usbCardPath(mount, rel),
			transcode: transcode, kbps: kbps, ext: ext, need: need,
		})
	}

	done := 0
	usbSetProgress(rec.DeviceID, 0, len(jobs), "", "converting")
	usbRunCopies(jobs, usbCopyWorkers(), usbMaterialise, func(r usbCopyResult) {
		done++
		usbSetProgress(rec.DeviceID, done, len(jobs), r.job.title, "converting")
		if r.err != nil {
			log.Printf("usb: convert %q failed: %v", r.job.rel, r.err)
			return
		}
		prev := manifest.Tracks[r.job.localID]
		old := usbCardPath(mount, prev.Path)
		// A same-name replacement (high ↔ efficient, both .mp3) was renamed over
		// the old file already; a different name leaves the old one to remove.
		if r.job.dst != old {
			_ = os.Remove(old)
			_ = os.Remove(filepath.Join(filepath.Dir(old), "._"+filepath.Base(old)))
		}
		next := usbManifestTrack{
			Path: r.job.rel, SubsonicID: r.job.subsonicID, Size: r.size, DownloadedAt: time.Now(), Tier: tier,
			Cover: r.cover.settled, LibraryPath: r.job.src, AudioFingerprint: audioNow[r.job.localID],
			// See the matching comment in convergeUsbFreshness's cover-refresh
			// pass: a failed embed attempt must not zero out a real prior
			// baseline this track already had.
			CoverSize: prev.CoverSize, CoverModUnix: prev.CoverModUnix,
		}
		if r.cover.settled {
			next.CoverSize, next.CoverModUnix = r.cover.size, r.cover.modUnix
		}
		manifest.Tracks[r.job.localID] = next
		if err := writeUsbManifest(mount, manifest); err != nil {
			log.Printf("usb: manifest write failed: %v", err)
		}
		converted++
	})
	usbSetProgress(rec.DeviceID, len(jobs), len(jobs), "", "")
	if !usbMounted(mount) {
		return converted, true
	}
	return converted, stalled
}

// convergeUsbCovers backfills embedded art onto tracks that landed on the
// card before cover-embedding existed (BUG-366): unlike convergeUsbTiers,
// this never copies or transcodes anything — usbEmbedExistingCover remuxes
// the file that's already there, so it's cheap even across a whole card.
// Manifest entries written before the Cover field existed default to false
// (JSON's zero value), which is exactly what marks them as owed here; each
// settles to true once checked (see usbManifestTrack.Cover) — including an
// album confirmed to have no cover — so a steady-state card never repeats
// this work, and this function's own len(ids) == 0 check exits without
// touching disk or network once every track has settled. Returns how many
// tracks the pass settled either way, for the log line only.
func convergeUsbCovers(state *SidecarState, rec *usbDeviceRecord, vol usbVolume) (settled int) {
	mount := vol.MountPath
	manifest := readUsbManifest(mount)
	audioNow := usbAudioFingerprintSnapshot(state)
	var ids []string
	for id, e := range manifest.Tracks {
		if !e.Cover {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return 0
	}
	sort.Slice(ids, func(i, j int) bool { return manifest.Tracks[ids[i]].Path < manifest.Tracks[ids[j]].Path })
	log.Printf("usb: %s checking cover art on %d tracks", rec.DeviceID, len(ids))

	var jobs []usbCopyJob
	for _, id := range ids {
		if !usbMounted(mount) {
			return 0
		}
		e := manifest.Tracks[id]
		src, err := resolveSongFile(e.SubsonicID, trackHint{})
		if err != nil {
			// Library file not found this pass — try again next time, same as
			// convergeUsbTiers does for the same failure.
			continue
		}
		jobs = append(jobs, usbCopyJob{
			localID: id, subsonicID: e.SubsonicID, title: filepath.Base(e.Path),
			src: src, rel: e.Path, dst: usbCardPath(mount, e.Path),
		})
	}

	usbRunCopies(jobs, usbCopyWorkers(), usbEmbedExistingCover, func(r usbCopyResult) {
		if r.err != nil {
			log.Printf("usb: cover check %q failed: %v", r.job.rel, r.err)
			return
		}
		entry := manifest.Tracks[r.job.localID]
		entry.Size = r.size
		entry.Cover = r.cover.settled
		// Seed the freshness baseline here too, since this pass already
		// resolved the source path — one less getSong round trip owed later.
		entry.LibraryPath = r.job.src
		entry.CoverSize, entry.CoverModUnix = r.cover.size, r.cover.modUnix
		if entry.AudioFingerprint == "" {
			entry.AudioFingerprint = audioNow[r.job.localID]
		}
		manifest.Tracks[r.job.localID] = entry
		if err := writeUsbManifest(mount, manifest); err != nil {
			log.Printf("usb: manifest write failed: %v", err)
		}
		if r.cover.settled {
			settled++
		}
	})
	return settled
}

// convergeUsbFreshness is the corded counterpart of the phone's
// track-freshness check (apps/cassette/.../track-freshness/route.ts):
// noticing a track the person re-ripped, re-tagged, or otherwise changed in
// place, and a folder cover they swapped, so the card catches up instead of
// carrying stale bytes forever. A phone has to poll a cloud endpoint for this
// because it has no filesystem access to the hub's library; the hub already
// does, and already computes an audio content fingerprint for every library
// track on its own hourly cycle (library-sync.go → attachAudioFingerprints)
// for exactly this purpose — this function is mostly just reading that.
//
// Three phases, in order:
//
//  1. Backfill: a manifest entry with no LibraryPath yet (every entry that
//     predates this feature) gets one resolved and its current
//     AudioFingerprint/CoverSize/CoverModUnix recorded as a BASELINE. This
//     never re-copies anything — a missing baseline is not evidence the file
//     changed, only that nobody had looked yet. Getting this wrong (treating
//     "unknown" as "stale") would force a full re-copy of an entire library
//     purely because the feature shipped — the same runaway-work shape
//     BUG-356 was, just triggered by a rollout instead of a loop.
//  2. Cover drift: a settled entry whose SOURCE folder cover's size or mtime
//     no longer matches its recorded baseline gets re-embedded in place — a
//     cheap remux (usbEmbedExistingCover), not a re-copy. A stat, not a
//     hash, is enough here: a false positive only costs that remux, and
//     Cassette's own cover writes always bump mtime on a real change.
//  3. Audio drift: a settled entry whose current content fingerprint
//     (state.AudioObservations, the SAME signal phones already use) no
//     longer matches its recorded baseline is genuinely stale — the person
//     re-ripped it, or the file changed underneath it some other way. This
//     is the one case worth a real re-copy or re-transcode, through the same
//     usbMaterialise pipeline an ordinary add uses, so it also re-embeds
//     whatever cover is current.
//
// Returns how many tracks were actually refreshed (cover, audio, or both —
// counted once) and whether it stopped early (unplugged or out of room).
func convergeUsbFreshness(state *SidecarState, rec *usbDeviceRecord, vol usbVolume, tier string) (refreshed int, stalled bool) {
	mount := vol.MountPath
	manifest := readUsbManifest(mount)
	if len(manifest.Tracks) == 0 {
		return 0, false
	}
	audioNow := usbAudioFingerprintSnapshot(state)

	// Phase 1: establish a baseline for any entry that doesn't have one yet.
	// Costs one getSong round trip per track, same as convergeUsbCovers's own
	// backfill — but only once, ever, per track: LibraryPath being set is
	// what takes it out of this phase for good.
	var unbacked []string
	for id, e := range manifest.Tracks {
		if e.LibraryPath == "" {
			unbacked = append(unbacked, id)
		}
	}
	sort.Strings(unbacked)
	backfilled := 0
	for _, id := range unbacked {
		if !usbMounted(mount) {
			return refreshed, true
		}
		e := manifest.Tracks[id]
		src, err := resolveSongFile(e.SubsonicID, trackHint{})
		if err != nil {
			continue // try again next reconcile pass
		}
		e.LibraryPath = src
		if fp, ok := audioNow[id]; ok {
			e.AudioFingerprint = fp
		}
		if size, modUnix, ok := usbCoverStat(filepath.Dir(src)); ok {
			e.CoverSize, e.CoverModUnix = size, modUnix
		}
		manifest.Tracks[id] = e
		backfilled++
	}
	if backfilled > 0 {
		if err := writeUsbManifest(mount, manifest); err != nil {
			log.Printf("usb: manifest write failed: %v", err)
		}
		log.Printf("usb: %s established a freshness baseline for %d tracks", rec.DeviceID, backfilled)
	}

	// Phase 2: cover drift. Cheap — a stat per track, no network, no hash.
	var coverStale []string
	for id, e := range manifest.Tracks {
		if e.LibraryPath == "" {
			continue // just failed to backfill; nothing to compare yet
		}
		size, modUnix, ok := usbCoverStat(filepath.Dir(e.LibraryPath))
		if !ok || (size == e.CoverSize && modUnix == e.CoverModUnix) {
			continue
		}
		coverStale = append(coverStale, id)
	}
	if len(coverStale) > 0 {
		sort.Strings(coverStale)
		log.Printf("usb: %s re-embedding %d tracks whose folder cover changed", rec.DeviceID, len(coverStale))
		var jobs []usbCopyJob
		for _, id := range coverStale {
			e := manifest.Tracks[id]
			jobs = append(jobs, usbCopyJob{
				localID: id, subsonicID: e.SubsonicID, title: filepath.Base(e.Path),
				src: e.LibraryPath, rel: e.Path, dst: usbCardPath(mount, e.Path),
			})
		}
		usbRunCopies(jobs, usbCopyWorkers(), usbEmbedExistingCover, func(r usbCopyResult) {
			if r.err != nil {
				log.Printf("usb: cover refresh %q failed: %v", r.job.rel, r.err)
				return
			}
			e := manifest.Tracks[r.job.localID]
			e.Size = r.size
			e.Cover = r.cover.settled
			// Only a SETTLED outcome's stat is meaningful — a failed attempt
			// (usbEmbedIfCovered's settled:false branch) reports zero, and
			// writing that over a real prior baseline would make a track
			// that's still genuinely stale look like it has none at all.
			// Leaving the old baseline in place keeps it correctly flagged
			// for the next reconcile pass instead.
			if r.cover.settled {
				e.CoverSize, e.CoverModUnix = r.cover.size, r.cover.modUnix
			}
			manifest.Tracks[r.job.localID] = e
			if err := writeUsbManifest(mount, manifest); err != nil {
				log.Printf("usb: manifest write failed: %v", err)
			}
			refreshed++
		})
	}

	// Phase 3: audio drift — the real re-rip case. Only a RECORDED baseline
	// that no longer matches counts; see the file comment on why "no
	// baseline yet" must never be read as staleness.
	var audioStale []string
	remeasured := 0
	for id, e := range manifest.Tracks {
		if e.AudioFingerprint == "" {
			continue
		}
		if fp, ok := audioNow[id]; ok && fp != e.AudioFingerprint {
			// Measured a new way (BUG-882, audio-fingerprint.go): the same file, so take it as the baseline
			// instead of copying the whole library over again.
			if fingerprintKind(fp) != fingerprintKind(e.AudioFingerprint) {
				e.AudioFingerprint = fp
				manifest.Tracks[id] = e
				remeasured++
				continue
			}
			audioStale = append(audioStale, id)
		}
	}
	if remeasured > 0 {
		if err := writeUsbManifest(mount, manifest); err != nil {
			log.Printf("usb: %s couldn't record %d re-measured tracks: %v", rec.DeviceID, remeasured, err)
		}
	}
	if len(audioStale) == 0 {
		return refreshed, false
	}
	sort.Strings(audioStale)
	log.Printf("usb: %s re-copying %d tracks whose library file changed", rec.DeviceID, len(audioStale))

	transcode, kbps, ext := usbTierParams(tier)
	freeLeft := usbOS.freeBytes(mount)
	var jobs []usbCopyJob
	for _, id := range audioStale {
		if !usbMounted(mount) {
			return refreshed, true
		}
		e := manifest.Tracks[id]
		src, err := resolveSongFile(e.SubsonicID, trackHint{})
		if err != nil {
			log.Printf("usb: refresh %q: library file not found (%v); left as is", e.Path, err)
			continue
		}
		var need int64
		if transcode {
			need = usbEstimateBytes(kbps, nil)
		} else {
			fi, err := os.Stat(src)
			if err != nil {
				continue
			}
			need = fi.Size()
		}
		if !usbHasRoomToReplace(freeLeft, need) {
			usbSetFull(rec.DeviceID, usbOS.freeBytes(mount))
			usbNoteError(state, rec, fmt.Sprintf("Not enough room on %s to refresh updated tracks", rec.Label))
			stalled = true
			break
		}
		if freeLeft >= 0 {
			freeLeft -= need
		}
		// Same tier, same path: convergeUsbTiers already ran this pass, so
		// e.Path is already at the account's current tier — this is a
		// content refresh, not a format change.
		jobs = append(jobs, usbCopyJob{
			localID: id, subsonicID: e.SubsonicID, title: filepath.Base(e.Path),
			src: src, rel: e.Path, dst: usbCardPath(mount, e.Path),
			transcode: transcode, kbps: kbps, ext: ext, need: need,
		})
	}

	done := 0
	usbSetProgress(rec.DeviceID, 0, len(jobs), "", "refreshing")
	usbRunCopies(jobs, usbCopyWorkers(), usbMaterialise, func(r usbCopyResult) {
		done++
		usbSetProgress(rec.DeviceID, done, len(jobs), r.job.title, "refreshing")
		if r.err != nil {
			log.Printf("usb: refresh %q failed: %v", r.job.rel, r.err)
			return
		}
		e := manifest.Tracks[r.job.localID]
		e.Size = r.size
		e.DownloadedAt = time.Now()
		e.LibraryPath = r.job.src
		e.Cover = r.cover.settled
		if r.cover.settled { // see the matching comment in the cover-refresh pass above
			e.CoverSize, e.CoverModUnix = r.cover.size, r.cover.modUnix
		}
		if fp, ok := audioNow[r.job.localID]; ok {
			e.AudioFingerprint = fp
		}
		manifest.Tracks[r.job.localID] = e
		if err := writeUsbManifest(mount, manifest); err != nil {
			log.Printf("usb: manifest write failed: %v", err)
		}
		refreshed++
	})
	usbSetProgress(rec.DeviceID, len(jobs), len(jobs), "", "")
	if !usbMounted(mount) {
		return refreshed, true
	}
	return refreshed, stalled
}

// usbSetFull records that the card ran out of room at `free` bytes; adds hold
// from here until usbTick sees free space grow past it.
func usbSetFull(deviceID string, free int64) {
	if free <= 0 {
		free = 1
	}
	usbMu.Lock()
	if live := usbLive[deviceID]; live != nil {
		live.fullAtFree = free
	}
	usbMu.Unlock()
}

// usbFindFolderCover returns dir's folder cover file, if it has one — the
// same cover.*/folder.*/front.* set Navidrome's default priority and the
// rip/resolve pipeline treat as an album's art (coverBaseNames, cover-art.go),
// whatever its image extension (materializeCoverForAlbumDir can write
// .jpg/.png/.webp/.gif depending on the source). Used both to copy the
// sibling file onto a device and to find the bytes to embed into each track.
func usbFindFolderCover(dir string) (path string, ok bool) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", false
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		ext := filepath.Ext(name)
		if !coverBaseNames[strings.ToLower(strings.TrimSuffix(name, ext))] {
			continue
		}
		switch strings.ToLower(ext) {
		case ".jpg", ".jpeg", ".png", ".webp", ".gif":
			return filepath.Join(dir, name), true
		}
	}
	return "", false
}

// usbCoverStat is usbFindFolderCover plus a stat, in one call — the cheap
// gate convergeUsbFreshness compares against a manifest entry's recorded
// CoverSize/CoverModUnix. ok is false when the album has no folder cover at
// all right now (never treated as a regression to chase).
func usbCoverStat(dir string) (size int64, modUnix int64, ok bool) {
	cover, found := usbFindFolderCover(dir)
	if !found {
		return 0, 0, false
	}
	fi, err := os.Stat(cover)
	if err != nil {
		return 0, 0, false
	}
	return fi.Size(), fi.ModTime().Unix(), true
}

// copyFolderCoverOnce copies srcDir's folder cover into dstDir, once — a
// dstDir that already has one (any name) is left alone.
func copyFolderCoverOnce(srcDir, dstDir string) {
	if _, already := usbFindFolderCover(dstDir); already {
		return
	}
	src, ok := usbFindFolderCover(srcDir)
	if !ok {
		return
	}
	dst := filepath.Join(dstDir, filepath.Base(src))
	if err := copyFileAtomic(src, dst); err != nil {
		log.Printf("usb: folder cover copy failed for %q: %v", srcDir, err)
	}
}

// ─── Cloud wire shapes (subset of @discovery/cassette-contract) ──────────────

type usbIntentJSON struct {
	ID             string `json:"id"`
	Scope          string `json:"scope"`
	TargetID       string `json:"target_id"`
	TargetDeviceID string `json:"target_device_id"`
	State          string `json:"state"`
	IntentKind     string `json:"intent_kind"`
	CreatedAt      string `json:"created_at"`
}

type usbIntentTrackJSON struct {
	SubsonicTrackID string  `json:"subsonic_track_id"`
	CassetteLocalID string  `json:"cassette_local_id"`
	Title           *string `json:"title"`
	Duration        *int    `json:"duration"`
}

type usbInventoryItem struct {
	CassetteLocalID string  `json:"cassette_local_id"`
	DownloadedAt    string  `json:"downloaded_at"`
	MBID            *string `json:"mbid"`
}

// decodeAlbumTarget splits an album intent's target_id
// (encodeURIComponent(artist) + "::" + encodeURIComponent(album)). Mirrors
// decodeAlbumTargetId in apps/cassette/src/lib/sync-intents.ts.
func decodeAlbumTarget(target string) (artist, album string, ok bool) {
	i := strings.Index(target, "::")
	if i < 0 {
		return "", "", false
	}
	a, err1 := url.PathUnescape(target[:i])
	b, err2 := url.PathUnescape(target[i+2:])
	if err1 != nil || err2 != nil {
		return "", "", false
	}
	return a, b, true
}

func cloudJSON(method, path string, body any, out any) error {
	status, respBody, err := cassetteAPI(method, path, body)
	if err != nil {
		return err
	}
	if status < 200 || status >= 300 {
		return fmt.Errorf("%s %s → %d (%.200s)", method, path, status, string(respBody))
	}
	if out != nil && len(respBody) > 0 {
		return json.Unmarshal(respBody, out)
	}
	return nil
}

// usbRegisterDevice is registration and presence in one: the cloud upserts the
// row and bumps last_seen_at, which is what lights the tile.
func usbRegisterDevice(rec *usbDeviceRecord, vol usbVolume) error {
	model := strings.TrimSpace(vol.Filesystem)
	if model == "" {
		model = "USB storage"
	}
	return cloudJSON(http.MethodPost, "/api/sync/devices", map[string]any{
		"device_id":    rec.DeviceID,
		"device_label": rec.Label,
		"platform":     "usb",
		"model":        model,
		"app_version":  "hub",
	}, nil)
}

func usbPutIntentState(id, state, errMsg string) {
	body := map[string]any{"state": state}
	if errMsg != "" {
		body["error_message"] = errMsg
	}
	if err := cloudJSON(http.MethodPut, "/api/sync/intents/"+url.PathEscape(id), body, nil); err != nil {
		log.Printf("usb: intent %s → %s failed: %v", id, state, err)
	}
}

// usbFetchPendingIntents returns this device's queue in creation order: the
// pending instructions, plus any left "syncing" by an earlier pass that never
// finished (the hub was quit or the Mac slept mid-album). Only one pass ever
// runs per device, so a syncing instruction seen at the start of a pass is an
// interrupted one, and re-running it is safe: tracks already on the card are
// skipped by the manifest check and only the rest are copied.
func usbFetchPendingIntents(deviceID string) ([]usbIntentJSON, error) {
	var mine []usbIntentJSON
	for _, state := range []string{"syncing", "pending"} {
		var parsed struct {
			Intents []usbIntentJSON `json:"intents"`
		}
		if err := cloudJSON(http.MethodGet, "/api/sync/intents?state="+state, nil, &parsed); err != nil {
			return nil, err
		}
		for _, it := range parsed.Intents {
			if it.TargetDeviceID == deviceID {
				mine = append(mine, it)
			}
		}
	}
	sort.SliceStable(mine, func(i, j int) bool { return mine[i].CreatedAt < mine[j].CreatedAt })
	return mine, nil
}

func usbFetchIntentTracks(id string) ([]usbIntentTrackJSON, error) {
	var parsed struct {
		Tracks []usbIntentTrackJSON `json:"tracks"`
	}
	if err := cloudJSON(http.MethodGet, "/api/sync/intents/"+url.PathEscape(id)+"/tracks", nil, &parsed); err != nil {
		return nil, err
	}
	return parsed.Tracks, nil
}

func usbPostInventoryFull(rec *usbDeviceRecord, m usbManifest) error {
	items := make([]usbInventoryItem, 0, len(m.Tracks))
	for id, t := range m.Tracks {
		items = append(items, usbInventoryItem{CassetteLocalID: id, DownloadedAt: t.DownloadedAt.UTC().Format(time.RFC3339)})
	}
	return cloudJSON(http.MethodPost, "/api/sync/device-inventory", map[string]any{
		"device_id":    rec.DeviceID,
		"device_label": rec.Label,
		"full_state":   true,
		"items":        items,
	}, nil)
}

func usbPostInventoryDiff(rec *usbDeviceRecord, added []usbInventoryItem, removed []string) error {
	if len(added) == 0 && len(removed) == 0 {
		return nil
	}
	rem := make([]map[string]string, 0, len(removed))
	for _, id := range removed {
		rem = append(rem, map[string]string{"cassette_local_id": id})
	}
	return cloudJSON(http.MethodPost, "/api/sync/device-inventory", map[string]any{
		"device_id":    rec.DeviceID,
		"device_label": rec.Label,
		"added":        added,
		"removed":      rem,
	}, nil)
}

// ─── State helpers ───────────────────────────────────────────────────────────

func usbRecord(state *SidecarState, deviceID string) *usbDeviceRecord {
	if state == nil {
		return nil
	}
	stateMu.Lock() // the add and forget doors write this map from other goroutines (BUG-788)
	defer stateMu.Unlock()
	return state.UsbDevices[deviceID]
}

func usbSaveState(state *SidecarState) {
	if err := saveState(state); err != nil {
		log.Printf("usb: could not persist state: %v", err)
	}
}

// ─── Watcher ─────────────────────────────────────────────────────────────────

// startUsbWatcher runs forever: every few seconds it lists removable volumes,
// notices added devices arriving and leaving, keeps their presence fresh, and
// schedules sync passes. Run with `go`.
func startUsbWatcher(state *SidecarState) {
	if usbOS == nil || state == nil {
		return
	}
	t := time.NewTicker(usbPollInterval)
	defer t.Stop()
	for range t.C {
		usbTick(state)
	}
}

func usbTick(state *SidecarState) {
	vols, err := usbOS.listRemovableVolumes()
	if err != nil {
		return
	}
	present := map[string]usbVolume{}
	for _, v := range vols {
		m, err := readUsbMarker(v.MountPath)
		if err != nil || m == nil {
			continue
		}
		if usbRecord(state, m.DeviceID) == nil {
			continue // a marker this hub never added: a stranger until re-added
		}
		present[m.DeviceID] = v
	}

	now := time.Now()
	usbMu.Lock()
	defer usbMu.Unlock()
	for id, live := range usbLive {
		if _, ok := present[id]; !ok && live.Mounted {
			live.Mounted = false
			live.MountPath = ""
			live.Progress = usbProgress{}
			log.Printf("usb: %s unplugged", id)
		}
	}
	for id, v := range present {
		live := usbLive[id]
		if live == nil {
			live = &usbLiveState{}
			usbLive[id] = live
		}
		if !live.Mounted {
			live.Mounted = true
			live.MountPath = v.MountPath
			live.MountedAt = now
			live.lastPresence = time.Time{}
			live.lastReconcile = time.Time{}
			live.lastIntentPoll = time.Time{}
			live.fullAtFree = 0 // a re-plug earns one fresh attempt
			log.Printf("usb: %s plugged in at %q", id, v.MountPath)
		}
		rec := usbRecord(state, id)
		if rec == nil || rec.Paused || live.Syncing {
			continue
		}
		// A full card holds adds until room appears (the person unlit albums, or
		// deleted from the player itself). Lift when free space has grown past
		// where it stalled by at least the reserve.
		if live.fullAtFree > 0 {
			if free := usbOS.freeBytes(v.MountPath); free > live.fullAtFree+usbFreeReserveBytes {
				log.Printf("usb: %s has room again (%d MB free); resuming", id, free>>20)
				live.fullAtFree = 0
			}
		}
		held := live.fullAtFree > 0
		reconcile := !held && (live.lastReconcile.IsZero() || now.Sub(live.lastReconcile) >= usbReconcileInterval)
		pollEvery := usbIntentPollInterval
		if held {
			pollEvery = usbPresenceInterval // only removes can drain; look less often
		}
		poll := live.lastIntentPoll.IsZero() || now.Sub(live.lastIntentPoll) >= pollEvery
		if reconcile || poll {
			live.Syncing = true
			usbPasses.Add(1)
			id, v, reconcile := id, v, reconcile
			goSafe("usb sync "+id, func() {
				defer usbPasses.Done()
				syncUsbDevice(state, id, v, reconcile)
			})
		}
	}
}

// syncUsbDevice is one pass for one plugged-in device: presence, then (on a
// reconcile pass) a full inventory report and a reconcile request, then the
// pending queue drained in order. Exactly one pass runs per device at a time.
//
// A FULL card holds: no reconcile request, no full inventory report (the cloud
// reconciles on those too), and only remove instructions drain, since they
// are what frees room. Adds resume when usbTick sees the room come back.
func syncUsbDevice(state *SidecarState, deviceID string, vol usbVolume, reconcile bool) {
	defer func() {
		usbMu.Lock()
		if live := usbLive[deviceID]; live != nil {
			live.Syncing = false
			live.Progress = usbProgress{}
			live.lastIntentPoll = time.Now()
			if reconcile {
				live.lastReconcile = time.Now()
			}
		}
		usbMu.Unlock()
	}()

	rec := usbRecord(state, deviceID)
	if rec == nil {
		return
	}
	if _, ok := bearer(); !ok {
		return // hub not paired: nothing can move
	}
	mount := vol.MountPath
	if !usbMounted(mount) {
		return
	}

	usbMu.Lock()
	live := usbLive[deviceID]
	presenceDue := live != nil && (live.lastPresence.IsZero() || time.Since(live.lastPresence) >= usbPresenceInterval)
	held := live != nil && live.fullAtFree > 0
	usbMu.Unlock()
	if presenceDue {
		if err := usbRegisterDevice(rec, vol); err != nil {
			log.Printf("usb: presence for %s failed: %v", deviceID, err)
		} else {
			usbMu.Lock()
			if live != nil {
				live.lastPresence = time.Now()
			}
			usbMu.Unlock()
		}
	}
	// The download quality rides the presence cadence: a change on the web
	// reaches the card within a couple of minutes, without a cloud call per pass.
	usbMu.Lock()
	tier := ""
	if live != nil {
		tier = live.tier
	}
	usbMu.Unlock()
	if tier == "" || presenceDue || reconcile {
		tier = usbAccountTier()
		usbMu.Lock()
		if live != nil {
			live.tier = tier
		}
		usbMu.Unlock()
	}

	// Converge what is already on the card to the tier BEFORE adding more: on a
	// card full of originals this is what makes the room. Conversion runs even
	// while held, since freeing room is the way out of a hold.
	changed := false
	if n, stalled := convergeUsbTiers(state, rec, vol, tier); n > 0 || stalled {
		changed = changed || n > 0
		if n > 0 {
			log.Printf("usb: %s converted %d tracks to %s", deviceID, n, tier)
		}
		usbMu.Lock()
		if live != nil && live.fullAtFree > 0 {
			if free := usbOS.freeBytes(mount); free > live.fullAtFree+usbFreeReserveBytes {
				live.fullAtFree = 0
			}
		}
		held = live != nil && live.fullAtFree > 0
		usbMu.Unlock()
	}
	if held {
		reconcile = false
	}

	// Backfill cover art onto whatever landed before this capability existed
	// (BUG-366). Cheap and self-limiting (see convergeUsbCovers): a converged
	// card costs one manifest read and exits, so this runs every pass, held
	// or not — it neither frees nor consumes meaningful room either way.
	if n := convergeUsbCovers(state, rec, vol); n > 0 {
		changed = true
		log.Printf("usb: %s settled cover art on %d tracks", deviceID, n)
	}

	// Notice a re-rip or a changed cover on whatever's already on the card —
	// the corded counterpart of the phone's track-freshness check. Gated to
	// the reconcile cadence (~10 min while mounted), not every pass: unlike
	// convergeUsbCovers's near-free early exit, this walks the whole manifest
	// with real stat calls even in the steady state. Skipped while held, same
	// as reconcile itself — a full card has no business doing a discretionary
	// refresh of content it already has instead of using what little room
	// exists for what's actually missing.
	if reconcile {
		if n, stalled := convergeUsbFreshness(state, rec, vol, tier); n > 0 || stalled {
			changed = changed || n > 0
			if n > 0 {
				log.Printf("usb: %s refreshed %d tracks whose source changed", deviceID, n)
			}
		}
	}

	if reconcile {
		manifest, pruned := pruneUsbManifest(mount, readUsbManifest(mount))
		if pruned > 0 {
			log.Printf("usb: %s manifest lost %d tracks that are no longer on the card", deviceID, pruned)
			if err := writeUsbManifest(mount, manifest); err != nil {
				log.Printf("usb: manifest write failed: %v", err)
			}
		}
		// The full-state report is also the reconcile request: the cloud runs
		// its reconciler on every complete snapshot, as an AUTOMATIC pass, so
		// the failed-add backoff applies. (The manual sync-now endpoint would
		// bypass that backoff, which is exactly the loop BUG-356 describes.)
		if err := usbPostInventoryFull(rec, manifest); err != nil {
			log.Printf("usb: inventory report for %s failed: %v", deviceID, err)
			usbNoteError(state, rec, "Could not report what's on the card: "+err.Error())
			return
		}
	}

	intents, err := usbFetchPendingIntents(deviceID)
	if err != nil {
		log.Printf("usb: intent poll for %s failed: %v", deviceID, err)
		return
	}
	usbMu.Lock()
	if live != nil {
		live.pendingIntents = len(intents)
	}
	usbMu.Unlock()
	if len(intents) == 0 && !changed {
		return
	}

	for _, it := range intents {
		if !usbMounted(mount) {
			return
		}
		isRemove := it.IntentKind == "remove" || strings.HasPrefix(it.TargetID, "localid@")
		if held && !isRemove {
			continue // full: leave adds pending, they resume when room appears
		}
		processUsbIntent(state, rec, vol, it, tier)
		changed = true
		usbMu.Lock()
		held = live != nil && live.fullAtFree > 0
		usbMu.Unlock()
	}
	if changed {
		if n := usbSweepAppleDouble(usbFolder(mount)); n > 0 {
			log.Printf("usb: %s swept %d AppleDouble sidecars", deviceID, n)
		}
		rec.LastSyncAt = time.Now()
		if !held {
			rec.LastError = ""
		}
		usbSaveState(state)
	}
}

func usbNoteError(state *SidecarState, rec *usbDeviceRecord, msg string) {
	rec.LastError = msg
	usbSaveState(state)
}

func usbSetProgress(deviceID string, done, total int, current, phase string) {
	usbMu.Lock()
	if live := usbLive[deviceID]; live != nil {
		live.Progress = usbProgress{Done: done, Total: total, Current: current, Phase: phase}
	}
	usbMu.Unlock()
}

// processUsbIntent applies one instruction to the card. Adds copy files in
// (originals, or a Navidrome transcode when the account's download quality
// asks for one), a few tracks at a time; removes take out only what the
// manifest says the hub put there. Running out of room fails THIS instruction
// once and puts the device on hold; the rest of the queue stays pending for
// when room appears.
func processUsbIntent(state *SidecarState, rec *usbDeviceRecord, vol usbVolume, it usbIntentJSON, tier string) {
	mount := vol.MountPath
	usbPutIntentState(it.ID, "syncing", "")
	tracks, err := usbFetchIntentTracks(it.ID)
	if err != nil {
		usbPutIntentState(it.ID, "failed", "Could not resolve tracks: "+err.Error())
		return
	}
	manifest := readUsbManifest(mount)
	audioNow := usbAudioFingerprintSnapshot(state)

	if it.IntentKind == "remove" || strings.HasPrefix(it.TargetID, "localid@") {
		var removed []string
		for _, t := range tracks {
			entry, ok := manifest.Tracks[t.CassetteLocalID]
			if !ok {
				continue // never ours: never touched
			}
			p := usbCardPath(mount, entry.Path)
			if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
				log.Printf("usb: remove %q failed: %v", p, err)
				continue
			}
			delete(manifest.Tracks, t.CassetteLocalID)
			removed = append(removed, t.CassetteLocalID)
			_ = os.Remove(filepath.Join(filepath.Dir(p), "._"+filepath.Base(p)))
			_ = os.Remove(filepath.Dir(p)) // drops the album folder only if empty
		}
		if err := writeUsbManifest(mount, manifest); err != nil {
			log.Printf("usb: manifest write failed: %v", err)
		}
		if err := usbPostInventoryDiff(rec, nil, removed); err != nil {
			log.Printf("usb: inventory diff (remove) failed: %v", err)
		}
		usbPutIntentState(it.ID, "complete", "")
		return
	}

	artist, album, _ := decodeAlbumTarget(it.TargetID)
	transcode, kbps, ext := usbTierParams(tier)
	total := len(tracks)
	failed := 0
	lastErr := ""

	// Plan first, one track at a time: resolve, size, and reserve room against
	// a running free-space figure so concurrent jobs can't overshoot the card.
	freeLeft := usbOS.freeBytes(mount)
	roomOut := false
	var jobs []usbCopyJob
	for _, t := range tracks {
		if !usbMounted(mount) {
			usbPutIntentState(it.ID, "pending", "")
			return
		}
		if entry, ok := manifest.Tracks[t.CassetteLocalID]; ok {
			if _, err := os.Stat(usbCardPath(mount, entry.Path)); err == nil {
				continue // already on the card
			}
		}
		title := ""
		if t.Title != nil {
			title = *t.Title
		}
		// The library file is resolved even for a transcode: its place in the
		// library is where the track lives on the card too.
		src, err := resolveSongFile(t.SubsonicTrackID, trackHint{AlbumArtist: artist, Album: album, Title: title})
		if err != nil {
			failed++
			lastErr = "a track could not be found in the library"
			log.Printf("usb: resolve %q (%s) failed: %v", title, t.SubsonicTrackID, err)
			continue
		}
		rel, err := usbRelPath(src)
		if err != nil {
			failed++
			lastErr = "a track sits outside the library folder"
			log.Printf("usb: %v", err)
			continue
		}
		var need int64
		if transcode {
			rel = strings.TrimSuffix(rel, filepath.Ext(rel)) + "." + ext
			need = usbEstimateBytes(kbps, t.Duration)
		} else {
			fi, err := os.Stat(src)
			if err != nil {
				failed++
				lastErr = "a track could not be read"
				continue
			}
			need = fi.Size()
		}
		if !usbHasRoom(freeLeft, need) {
			roomOut = true
			break
		}
		if freeLeft >= 0 {
			freeLeft -= need
		}
		jobs = append(jobs, usbCopyJob{
			localID: t.CassetteLocalID, subsonicID: t.SubsonicTrackID, title: title,
			src: src, rel: rel, dst: usbCardPath(mount, rel),
			transcode: transcode, kbps: kbps, ext: ext, need: need,
		})
	}

	// Materialise what fits, a few at a time; the manifest and folder cover are
	// only ever touched from the single onDone goroutine.
	var added []usbInventoryItem
	done := 0
	usbSetProgress(rec.DeviceID, 0, total, "", "copying")
	usbRunCopies(jobs, usbCopyWorkers(), usbMaterialise, func(r usbCopyResult) {
		done++
		usbSetProgress(rec.DeviceID, done, total, r.job.title, "copying")
		if r.err != nil {
			failed++
			lastErr = "a track could not be copied"
			log.Printf("usb: copy %q → %q failed: %v", r.job.src, r.job.dst, r.err)
			return
		}
		copyFolderCoverOnce(filepath.Dir(r.job.src), filepath.Dir(r.job.dst))
		now := time.Now()
		manifest.Tracks[r.job.localID] = usbManifestTrack{
			Path: r.job.rel, SubsonicID: r.job.subsonicID, Size: r.size, DownloadedAt: now, Tier: tier,
			Cover: r.cover.settled, LibraryPath: r.job.src, CoverSize: r.cover.size, CoverModUnix: r.cover.modUnix,
			AudioFingerprint: audioNow[r.job.localID],
		}
		if err := writeUsbManifest(mount, manifest); err != nil {
			log.Printf("usb: manifest write failed: %v", err)
		}
		added = append(added, usbInventoryItem{
			CassetteLocalID: r.job.localID,
			DownloadedAt:    now.UTC().Format(time.RFC3339),
		})
	})
	usbSetProgress(rec.DeviceID, total, total, "", "")
	if err := usbPostInventoryDiff(rec, added, nil); err != nil {
		log.Printf("usb: inventory diff (add) failed: %v", err)
	}

	if !usbMounted(mount) {
		// Cable pulled mid-album: hand the instruction back so the next
		// plug-in resumes it; what already landed is in the manifest.
		usbPutIntentState(it.ID, "pending", "")
		return
	}
	if roomOut {
		free := usbOS.freeBytes(mount)
		usbSetFull(rec.DeviceID, free)
		msg := fmt.Sprintf("Not enough room on %s", rec.Label)
		usbNoteError(state, rec, msg)
		usbPutIntentState(it.ID, "failed", msg)
		log.Printf("usb: %s is full (%d MB free); holding adds until room appears", rec.DeviceID, free>>20)
		return
	}
	if failed > 0 {
		usbPutIntentState(it.ID, "failed", fmt.Sprintf("%d of %d tracks did not land: %s", failed, total, lastErr))
		return
	}
	usbPutIntentState(it.ID, "complete", "")
}

// ─── HTTP handlers (local API, behind corsMiddleware) ────────────────────────

type usbVolumeView struct {
	usbVolume
	// Known is set when the marker on the volume names a device this hub added.
	Known *usbKnownView `json:"known,omitempty"`
	// MarkerForeign is true when a marker exists but this hub never added the
	// device (another hub did, or the record was lost). Add re-adopts it under
	// the same id so the cloud row is reused.
	MarkerForeign bool `json:"markerForeign,omitempty"`
}

type usbKnownView struct {
	DeviceID string      `json:"deviceId"`
	Label    string      `json:"label"`
	Paused   bool        `json:"paused"`
	Syncing  bool        `json:"syncing"`
	Full     bool        `json:"full"`
	Progress usbProgress `json:"progress"`
	Pending  int         `json:"pending"`
}

func usbKnownViewFor(rec *usbDeviceRecord) *usbKnownView {
	usbMu.Lock()
	defer usbMu.Unlock()
	v := &usbKnownView{DeviceID: rec.DeviceID, Label: rec.Label, Paused: rec.Paused}
	if live := usbLive[rec.DeviceID]; live != nil {
		v.Syncing = live.Syncing
		v.Full = live.fullAtFree > 0
		v.Progress = live.Progress
		v.Pending = live.pendingIntents
	}
	return v
}

func handleUsbVolumes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	_, paired := bearer()
	vols, err := usbOS.listRemovableVolumes()
	if err != nil {
		writePlaybackJSON(w, http.StatusOK, map[string]any{"ok": false, "paired": paired, "error": err.Error(), "volumes": []any{}})
		return
	}
	views := make([]usbVolumeView, 0, len(vols))
	for _, v := range vols {
		view := usbVolumeView{usbVolume: v}
		if m, err := readUsbMarker(v.MountPath); err == nil && m != nil {
			if rec := usbRecord(liveState, m.DeviceID); rec != nil {
				view.Known = usbKnownViewFor(rec)
			} else {
				view.MarkerForeign = true
			}
		}
		views = append(views, view)
	}
	writePlaybackJSON(w, http.StatusOK, map[string]any{"ok": true, "paired": paired, "volumes": views})
}

func handleUsbStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	type view struct {
		DeviceID   string      `json:"deviceId"`
		Label      string      `json:"label"`
		Paused     bool        `json:"paused"`
		Mounted    bool        `json:"mounted"`
		MountPath  string      `json:"mountPath,omitempty"`
		Syncing    bool        `json:"syncing"`
		Full       bool        `json:"full"`
		Progress   usbProgress `json:"progress"`
		LastSyncAt string      `json:"lastSyncAt,omitempty"`
		LastError  string      `json:"lastError,omitempty"`
	}
	var out []view
	if liveState != nil {
		usbMu.Lock()
		for id, rec := range liveState.UsbDevices {
			v := view{DeviceID: id, Label: rec.Label, Paused: rec.Paused, LastError: rec.LastError}
			if !rec.LastSyncAt.IsZero() {
				v.LastSyncAt = rec.LastSyncAt.UTC().Format(time.RFC3339)
			}
			if live := usbLive[id]; live != nil {
				v.Mounted, v.MountPath, v.Syncing, v.Progress = live.Mounted, live.MountPath, live.Syncing, live.Progress
				v.Full = live.fullAtFree > 0
			}
			out = append(out, v)
		}
		usbMu.Unlock()
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Label < out[j].Label })
	if out == nil {
		out = []view{}
	}
	writePlaybackJSON(w, http.StatusOK, map[string]any{"ok": true, "devices": out})
}

func handleUsbAdd(w http.ResponseWriter, r *http.Request) {
	var req struct {
		MountPath string `json:"mountPath"`
		Label     string `json:"label"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		writePlaybackJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "bad JSON"})
		return
	}
	if liveState == nil {
		writePlaybackJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "hub not ready"})
		return
	}
	vols, err := usbOS.listRemovableVolumes()
	if err != nil {
		writePlaybackJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	var vol *usbVolume
	for i := range vols {
		if vols[i].MountPath == req.MountPath {
			vol = &vols[i]
			break
		}
	}
	// Only a volume the OS currently lists as removable can be added: never an
	// arbitrary path, never an internal disk.
	if vol == nil {
		writePlaybackJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "That drive isn't plugged in."})
		return
	}
	if !vol.Writable {
		writePlaybackJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "That drive is read-only."})
		return
	}

	deviceID := usbDeviceIDPrefix + newUUID()
	if m, err := readUsbMarker(vol.MountPath); err == nil && m != nil && strings.HasPrefix(m.DeviceID, usbDeviceIDPrefix) {
		deviceID = m.DeviceID // re-adopt: reuse the cloud row this card already has
	}
	label := strings.TrimSpace(req.Label)
	if label == "" {
		label = vol.Name
	}
	if label == "" {
		label = "USB player"
	}
	if len(label) > 80 {
		label = label[:80]
	}
	now := time.Now()
	if err := writeUsbMarker(vol.MountPath, usbMarker{DeviceID: deviceID, Label: label, VolumeUUID: vol.VolumeUUID, AddedAt: now}); err != nil {
		writePlaybackJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": "Could not write to that drive: " + err.Error()})
		return
	}
	rec := &usbDeviceRecord{DeviceID: deviceID, Label: label, VolumeUUID: vol.VolumeUUID, AddedAt: now}
	usbMu.Lock()
	stateMu.Lock()
	if liveState.UsbDevices == nil {
		liveState.UsbDevices = map[string]*usbDeviceRecord{}
	}
	liveState.UsbDevices[deviceID] = rec
	stateMu.Unlock()
	usbMu.Unlock()
	usbSaveState(liveState)

	cloudOK := true
	if err := usbRegisterDevice(rec, *vol); err != nil {
		cloudOK = false
		log.Printf("usb: cloud registration for %s failed (watcher will retry): %v", deviceID, err)
	} else {
		usbMu.Lock()
		live := usbLive[deviceID]
		if live == nil {
			live = &usbLiveState{}
			usbLive[deviceID] = live
		}
		live.lastPresence = now
		usbMu.Unlock()
	}
	log.Printf("usb: added %q as %s at %q", label, deviceID, vol.MountPath)
	writePlaybackJSON(w, http.StatusOK, map[string]any{"ok": true, "deviceId": deviceID, "label": label, "cloud": cloudOK})
}

func handleUsbPause(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DeviceID string `json:"deviceId"`
		Paused   bool   `json:"paused"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		writePlaybackJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "bad JSON"})
		return
	}
	rec := usbRecord(liveState, req.DeviceID)
	if rec == nil {
		writePlaybackJSON(w, http.StatusNotFound, map[string]any{"ok": false, "error": "unknown device"})
		return
	}
	usbMu.Lock()
	rec.Paused = req.Paused
	usbMu.Unlock()
	usbSaveState(liveState)
	writePlaybackJSON(w, http.StatusOK, map[string]any{"ok": true, "deviceId": rec.DeviceID, "paused": rec.Paused})
}

// handleUsbForget drops the hub's memory of a device and its marker. The music
// already on the card stays: it is theirs now. The cloud row is the web's to
// remove (unpair is session-only there, by design).
func handleUsbForget(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DeviceID string `json:"deviceId"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&req); err != nil {
		writePlaybackJSON(w, http.StatusBadRequest, map[string]any{"ok": false, "error": "bad JSON"})
		return
	}
	rec := usbRecord(liveState, req.DeviceID)
	if rec == nil {
		writePlaybackJSON(w, http.StatusOK, map[string]any{"ok": true, "forgotten": false})
		return
	}
	usbMu.Lock()
	mount := ""
	if live := usbLive[req.DeviceID]; live != nil && live.Mounted {
		mount = live.MountPath
	}
	delete(usbLive, req.DeviceID)
	stateMu.Lock()
	delete(liveState.UsbDevices, req.DeviceID)
	stateMu.Unlock()
	usbMu.Unlock()
	usbSaveState(liveState)
	if mount != "" {
		if err := os.Remove(usbMarkerPath(mount)); err != nil && !os.IsNotExist(err) {
			log.Printf("usb: could not remove marker at %q: %v", mount, err)
		}
	}
	log.Printf("usb: forgot %s", req.DeviceID)
	writePlaybackJSON(w, http.StatusOK, map[string]any{"ok": true, "forgotten": true})
}
