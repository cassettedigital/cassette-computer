//go:build darwin

// rip_platform_darwin.go — the macOS implementation of discPlatform.
//
// This is EXACTLY the disc I/O the sidecar has always run on macOS, relocated
// behind the seam without any change in logic: cd-paranoia for the TOC probe and
// raw track read, ioreg/IOKit for the no-spin TOC + media-presence signal, drutil
// for drive status, diskutil/drutil for eject, the auto-mounted /Volumes CDDA
// (afconvert/dd/ffmpeg) fallback read, and the POSIX process-group kill in the
// stall watchdog. A Windows port implements the same interface in its own file;
// nothing here needs to move again.

package main

import (
	"bytes"
	"context"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"
)

// darwinDisc is the macOS discPlatform. Its methods are thin adapters over the
// package functions below, which hold the original implementation verbatim.
type darwinDisc struct{}

func init() { discOS = darwinDisc{} }

func (darwinDisc) probeDrive() DriveProbe                      { return probeDrive() }
func (darwinDisc) opticalMediaPresent() (bool, string)         { return opticalMediaPresent() }
func (darwinDisc) enhancedLastTrackBound() (int, int)          { return enhancedLastTrackBound() }
func (darwinDisc) ripTrackFallbackToWAV(p int, w string) error { return ripTrackFromCDDA(p, w) }
func (darwinDisc) killRipProcess(cmd *exec.Cmd)                { killRipProcessGroup(cmd) }

func (darwinDisc) ripTrackToWAV(position, maxFrames int, wavOut string) (int, error) {
	return ripCDTrack(position, maxFrames, wavOut)
}

// ejectDisc opens the drive / ejects the disc. Prefer the exact path Finder uses
// on the specific mounted disc — `diskutil eject <bsd>` — when Disk Arbitration
// handed us the device: it's the most reliable (and the mechanism the user
// confirmed works on this drive), and the absolute path survives a scrubbed .app
// PATH. Fall back to `drutil tray eject` otherwise.
func (darwinDisc) ejectDisc(ctx context.Context, device string) error {
	if device != "" {
		if out, err := exec.CommandContext(ctx, "/usr/sbin/diskutil", "eject", device).CombinedOutput(); err == nil {
			log.Printf("eject: ejected %s via diskutil", device)
			return nil
		} else {
			log.Printf("eject: `diskutil eject %s` failed: %v: %.150s — falling back to drutil", device, err, string(out))
		}
	}
	if out, err := exec.CommandContext(ctx, "/usr/bin/drutil", "tray", "eject").CombinedOutput(); err != nil {
		log.Printf("eject: `drutil tray eject` failed: %v: %.200s", err, string(out))
		return fmt.Errorf("Couldn't eject the disc.")
	}
	log.Printf("eject: disc ejected via drutil")
	return nil
}

// ── IOKit TOC (no-spin fast path) ──────────────────────────────────────────────

var iokitTOCRe = regexp.MustCompile(`"TOC"\s*=\s*<([0-9a-fA-F]+)>`)

// tocFromIOKit reads + parses the IORegistry TOC. Returns (nil, false) when there's
// no optical media, no TOC property, or the TOC doesn't parse — caller falls back.
func tocFromIOKit() (*TOC, bool) {
	out, err := exec.Command("ioreg", "-c", "IOCDMedia", "-r", "-d", "1").CombinedOutput()
	if err != nil {
		return nil, false
	}
	m := iokitTOCRe.FindSubmatch(out)
	if m == nil {
		return nil, false
	}
	raw, err := hex.DecodeString(string(m[1]))
	if err != nil {
		return nil, false
	}
	return parseIOKitTOC(raw)
}

// logIOKitTOC notes a no-spin TOC read, for parity with the cd-paranoia probe log.
func logIOKitTOC(toc *TOC, discID string) {
	log.Printf("probeDrive: TOC from IOKit (no drive spin) — %d audio tracks, disc %s", len(toc.TrackOffsets), discID)
}

// ── Drive / disc presence (drutil + IOKit + mounted volume) ────────────────────

// macOSDriveTruth asks macOS directly. A mounted audio CD (.aiff tracks under
// /Volumes) is conclusive proof of drive + disc; `drutil status` adds the
// drive-present-but-empty case. Best-effort and ADDITIVE: any parse miss just
// leaves a field false, so we never fabricate ABSENCE — only confirm presence.
func macOSDriveTruth() macTruth {
	// Disk Arbitration (the native watcher) is the most authoritative presence
	// signal — Finder and iTunes use the same framework — so trust it first. This
	// is what lets the disc show up even when cd-paranoia/drutil/the /Volumes scan
	// all read false-negative on a flaky drive or a sandboxed removable-volume read.
	if d := daDisc.Load(); d != nil && d.present {
		return macTruth{drivePresent: true, discPresent: true}
	}
	// IOKit is authoritative and SURVIVES A SPIN-DOWN: Disk Arbitration drops the
	// disc when the AudioCD volume unmounts as the drive winds down, but the media
	// object persists in the IORegistry until the disc is physically ejected.
	if present, _ := opticalMediaPresent(); present {
		return macTruth{drivePresent: true, discPresent: true}
	}
	if mountedAudioCDPresent() {
		return macTruth{drivePresent: true, discPresent: true}
	}
	out, _ := exec.Command("drutil", "status").CombinedOutput()
	return parseDrutilStatus(string(out))
}

// opticalMediaPresent asks IOKit whether optical media is physically loaded — the
// presence signal that survives a drive spin-down. Disk Arbitration (the native
// watcher) drops the disc when the unmounted AudioCD volume disappears, but
// IOCDMedia / IODVDMedia stays registered until the disc is ejected. Reading the
// registry does NOT spin the drive. Returns presence + the whole-disk BSD name
// (for `diskutil eject`).
func opticalMediaPresent() (bool, string) {
	for _, class := range []string{"IOCDMedia", "IODVDMedia"} {
		out, err := exec.Command("ioreg", "-c", class, "-r", "-d", "1").CombinedOutput()
		if err != nil {
			continue
		}
		if ok, bsd := parseIORegOptical(string(out)); ok {
			return true, bsd
		}
	}
	return false, ""
}

// mountedAudioCDPresent reports whether macOS has an audio CD mounted — a /Volumes
// entry holding .aiff track files (the same surface the CDDA rip fallback reads).
// This is the most reliable disc-present signal we have on macOS.
func mountedAudioCDPresent() bool {
	vols, _ := filepath.Glob("/Volumes/*")
	for _, v := range vols {
		if m, _ := filepath.Glob(filepath.Join(v, "*.aiff")); len(m) > 0 {
			return true
		}
	}
	return false
}

// probeDrive runs `cd-paranoia -Q` and classifies the result, cross-checked against
// macOS's own drive/disc truth so a transient post-insert scan miss never reads as
// "no drive". A successful TOC parse means drive + disc + granted; otherwise
// classifyDriveFailure interprets the output WITH the macOS truth, and we re-probe a
// few times when macOS says a readable disc is present but cd-paranoia hasn't caught
// it yet. This is the SINGLE place that reads cd-paranoia's text.
func probeDrive() DriveProbe {
	// Fast path: macOS already read the TOC at insert and keeps it in the IORegistry.
	// Parsing it identifies the disc WITHOUT spinning the drive — so re-detection,
	// search, and alignment never wake the motor; only the actual rip does. cd-paranoia
	// stays the fallback for whatever IOKit can't hand us (non-Mac, odd TOCs, CD-TEXT).
	if toc, ok := tocFromIOKit(); ok {
		discID, _ := toc.DiscID()
		logIOKitTOC(toc, discID)
		return DriveProbe{
			DrivePresent: true, DiscPresent: true,
			PermissionState: "granted",
			Message:         "Disc detected.",
			TOC:             toc,
		}
	}

	var probe DriveProbe
	for attempt := 0; attempt <= maxProbeRetries; attempt++ {
		out, err := exec.Command("cd-paranoia", "-Q").CombinedOutput()
		text := string(out)
		// cd-paranoia -Q prints the TOC to stderr and may still exit non-zero; try
		// to parse regardless, and only classify as a failure if parsing fails.
		if toc, rawBegins, perr := parseParanoiaTOC(text); perr == nil {
			discID, _ := toc.DiscID()
			logTemporaryTOC(text, rawBegins, toc, discID)
			return DriveProbe{
				DrivePresent: true, DiscPresent: true,
				PermissionState: "granted",
				Message:         "Disc detected.",
				TOC:             toc,
			}
		}
		probe = classifyDriveFailure(text, err, macOSDriveTruth())
		// Re-probe only when macOS says a readable disc IS present but cd-paranoia
		// missed it (a mount/scan race) and it isn't a permission wall. Genuine
		// "no disc / no drive" returns immediately (no wasted retries).
		retryable := probe.DiscPresent && probe.PermissionState != "denied"
		if retryable && attempt < maxProbeRetries {
			log.Printf("probeDrive: macOS sees a disc but cd-paranoia missed it — re-probing (attempt %d/%d)", attempt+1, maxProbeRetries)
			time.Sleep(probeRetryDelay)
			continue
		}
		break
	}
	return probe
}

// ── Raw track read (cd-paranoia) + macOS CDDA fallback ─────────────────────────

// findCDDATrackFile locates the auto-mounted .aiff for a track under /Volumes.
func findCDDATrackFile(position int) string {
	vols, _ := filepath.Glob("/Volumes/*")
	for _, v := range vols {
		// Track files are named "<n> <title>.aiff" (no zero-pad). The trailing
		// space keeps "1 …" from matching "11 …".
		if m, _ := filepath.Glob(filepath.Join(v, fmt.Sprintf("%d *.aiff", position))); len(m) > 0 {
			return m[0]
		}
	}
	return ""
}

// waitForCDDATrackFile polls for the macOS CDDA track file, because cd-paranoia and
// the AudioCD filesystem can't hold the drive at once: while cd-paranoia was reading,
// macOS unmounted the /Volumes/<disc> volume, and it takes a moment to remount once
// cd-paranoia releases the device. Without this wait the fallback ran against a
// not-yet-remounted volume and found nothing.
func waitForCDDATrackFile(position int, timeout time.Duration) string {
	deadline := time.Now().Add(timeout)
	for {
		if f := findCDDATrackFile(position); f != "" {
			return f
		}
		if time.Now().After(deadline) {
			return ""
		}
		time.Sleep(cddaPollInterval)
	}
}

const cddaPollInterval = 1 * time.Second

// ripTrackFromCDDA is the fallback read for a track cd-paranoia can't get without
// hanging (the classic case: a hidden-track tail or the gap before a data session,
// which cd-paranoia over-reads into and stalls on). It uses macOS's own CDDA
// extraction — the same audio iTunes would rip.
//
// Two robustness layers over a plain afconvert: (1) wait for the AudioCD volume to
// remount after cd-paranoia let go of the drive; (2) if afconvert aborts (it bails on
// the FIRST unreadable block — a single bad sector at the tail kills the whole track),
// recover the file tolerantly: `dd conv=noerror,sync` skips the bad blocks (zero-fills
// them), then ffmpeg accepts the result. A track that's 99.9% readable lands intact
// with at most a sliver of silence where the disc was unreadable.
func ripTrackFromCDDA(position int, wavOut string) error {
	aiff := waitForCDDATrackFile(position, cddaMountWait)
	if aiff == "" {
		return fmt.Errorf("no macOS CDDA track file for track %d (volume not mounted)", position)
	}
	// Fast path: a clean .aiff converts directly.
	if out, err := exec.Command("afconvert", "-f", "WAVE", "-d", "LEI16", aiff, wavOut).CombinedOutput(); err == nil {
		if fi, e := os.Stat(wavOut); e == nil && fi.Size() > 0 {
			return nil
		}
		_ = out
	}
	// Recovery path: read the .aiff error-tolerantly so one bad block doesn't lose the
	// whole track, then let ffmpeg decode what was recovered.
	recovered := wavOut + ".recover.aiff"
	defer os.Remove(recovered)
	_ = exec.Command("dd", "if="+aiff, "of="+recovered, "bs=4096", "conv=noerror,sync").Run()
	if fi, e := os.Stat(recovered); e != nil || fi.Size() == 0 {
		return fmt.Errorf("CDDA tolerant read produced nothing for track %d", position)
	}
	if out, err := exec.Command("ffmpeg", "-v", "error", "-y", "-i", recovered,
		"-ac", "2", "-ar", "44100", "-sample_fmt", "s16", wavOut).CombinedOutput(); err != nil {
		return fmt.Errorf("ffmpeg CDDA recovery %q: %v: %.150s", recovered, err, out)
	}
	if fi, e := os.Stat(wavOut); e != nil || fi.Size() == 0 {
		return fmt.Errorf("CDDA recovery produced no output for track %d", position)
	}
	log.Printf("rip: track %d recovered via tolerant CDDA read (unreadable blocks zero-filled)", position)
	return nil
}

const cddaMountWait = 15 * time.Second

// enhancedLastTrackBound returns (lastAudioTrackNumber, audioFrames) when the disc in
// the drive is an enhanced CD whose last audio track cd-paranoia would over-read into
// the trailing data session, so the ripper can bound that one track to the audio
// lead-out. Returns (0, 0) for a plain disc (rip by track number as usual) or when the
// TOC isn't available from IOKit. audioFrames is one frame short of the lead-out, so
// the read stops strictly inside the audio regardless of cd-paranoia's span boundary.
func enhancedLastTrackBound() (position, audioFrames int) {
	if ripFixtureMode {
		return 0, 0
	}
	toc, ok := tocFromIOKit()
	if !ok || toc.AudioLeadout <= 0 || toc.AudioLeadout >= toc.LeadoutOffset || len(toc.TrackOffsets) == 0 {
		return 0, 0 // plain audio CD (audio ends at the lead-out) or unknown — no bound
	}
	last := len(toc.TrackOffsets) - 1
	frames := toc.AudioLeadout - toc.TrackOffsets[last] - 1
	if frames <= 0 {
		return 0, 0
	}
	return toc.LastTrack, frames
}

// framesToParanoiaMSF formats a CD-frame count as cd-paranoia's [mm:ss.ff] span
// address (ff = frames, 0–74), used as a RELATIVE offset within a track.
func framesToParanoiaMSF(frames int) string {
	if frames < 0 {
		frames = 0
	}
	return fmt.Sprintf("[%02d:%02d.%02d]", frames/(75*60), (frames/75)%60, frames%75)
}

// ripCDTrack extracts one track. maxFrames > 0 BOUNDS the read to that many frames
// from the track's start — used for the last audio track of an enhanced CD, where
// cd-paranoia's own track length runs into the unreadable inter-session gap. 0 = rip
// the whole track by number (the normal case).
func ripCDTrack(track, maxFrames int, wavOut string) (attempts int, err error) {
	if ripFixtureMode {
		// Synthesize audio instead of reading a disc (Chunk 4 UI gate).
		freq := fmt.Sprintf("sine=frequency=%d:duration=1", 220+track*10)
		if out, e := exec.Command("ffmpeg", "-v", "error", "-y", "-f", "lavfi",
			"-i", freq, "-ac", "2", "-ar", "44100", wavOut).CombinedOutput(); e != nil {
			return 1, fmt.Errorf("fixture synth: %v: %.150s", e, out)
		}
		return 1, nil
	}
	span := fmt.Sprintf("%d-%d", track, track)
	if maxFrames > 0 {
		// Stop at the audio lead-out instead of over-reading into the lead-out/gap —
		// the documented cd-paranoia lockup case on drives that can't read past the
		// audio program.
		span = fmt.Sprintf("%d[.0]-%d%s", track, track, framesToParanoiaMSF(maxFrames))
	}
	for attempts = 1; attempts <= ripMaxAttempts; attempts++ {
		// J4: a user stop aborts immediately — don't burn retries on a cancelled rip.
		if ripStopRequested.Load() {
			return attempts - 1, fmt.Errorf("rip stopped by user")
		}
		// J4: each read runs under a stall watchdog + absolute ceiling, so a hung
		// frame is killed and surfaced as an error (→ retry → incomplete) instead of
		// spinning forever.
		runErr := runCDParanoiaWatched(span, wavOut)
		if runErr == nil {
			if fi, statErr := os.Stat(wavOut); statErr == nil && fi.Size() > 0 {
				return attempts, nil
			}
			err = fmt.Errorf("cd-paranoia produced no output")
			continue
		}
		err = runErr
		if ripStopRequested.Load() {
			return attempts, err // a user stop: stop retrying
		}
		if strings.Contains(runErr.Error(), "stalled") {
			// A stall is a deterministic drive hang on this region — retrying just
			// hangs again. Fail fast so the caller's macOS-CDDA fallback recovers it.
			return attempts, err
		}
	}
	return attempts - 1, err
}

// ── Stall watchdog + process-group kill (POSIX) ────────────────────────────────

const (
	// ripTrackStallTimeout kills a read whose WAV hasn't grown this long — a hung
	// frame, not slow error-correction (paranoia still streams during real work).
	ripTrackStallTimeout = 90 * time.Second
	// ripTrackCeiling is the generous absolute per-track ceiling (a backstop for a
	// stall the size-watch can't see, e.g. a WAV that buffers).
	ripTrackCeiling = 20 * time.Minute
	// ripStallCheckEvery is how often the watchdog samples WAV growth.
	ripStallCheckEvery = 10 * time.Second
)

// safeBuffer is a concurrency-safe sink for cd-paranoia's combined output — the
// watchdog goroutine never reads it, but Wait()'s goroutine and the process write
// concurrently, so the buffer must be guarded.
type safeBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *safeBuffer) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *safeBuffer) tail(n int) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	str := s.b.String()
	if len(str) > n {
		return str[len(str)-n:]
	}
	return str
}

// killRipProcessGroup SIGKILLs the process group of a cd-paranoia run (negative
// PID = the whole group, since it was started with Setpgid).
func killRipProcessGroup(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
}

// wavSize is the current size of the output WAV (0 if not yet created).
func wavSize(p string) int64 {
	if fi, err := os.Stat(p); err == nil {
		return fi.Size()
	}
	return 0
}

// runCDParanoiaWatched runs one cd-paranoia track read under an absolute ceiling
// AND a stall watchdog. Returns nil on success; on a stall, ceiling, user stop, or
// a genuine cd-paranoia error it returns a descriptive error (the caller's retry
// loop + completeness gate take it from there). Never blocks indefinitely.
func runCDParanoiaWatched(span, wavOut string) error {
	ctx, cancel := context.WithTimeout(context.Background(), ripTrackCeiling)
	defer cancel()

	cmd := exec.CommandContext(ctx, cdParanoiaBin, "-e", "-w", span, wavOut)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} // own process group
	cmd.Cancel = func() error { killRipProcessGroup(cmd); return nil }
	out := &safeBuffer{}
	cmd.Stdout, cmd.Stderr = out, out

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("cd-paranoia start: %w", err)
	}
	activeRipCmd.Store(cmd)
	defer activeRipCmd.Store(nil)

	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()

	ticker := time.NewTicker(ripStallCheckEvery)
	defer ticker.Stop()
	var lastSize int64
	lastProgress := time.Now()

	for {
		select {
		case werr := <-done:
			switch {
			case ripStopRequested.Load():
				return fmt.Errorf("rip stopped by user")
			case ctx.Err() == context.DeadlineExceeded:
				return fmt.Errorf("cd-paranoia exceeded %s ceiling: %.150s", ripTrackCeiling, out.tail(150))
			case werr != nil:
				return fmt.Errorf("cd-paranoia: %v: %.200s", werr, out.tail(200))
			}
			return nil
		case <-ticker.C:
			if ripStopRequested.Load() {
				killRipProcessGroup(cmd)
				<-done
				return fmt.Errorf("rip stopped by user")
			}
			if sz := wavSize(wavOut); sz > lastSize {
				lastSize = sz
				lastProgress = time.Now()
			} else if time.Since(lastProgress) > ripTrackStallTimeout {
				killRipProcessGroup(cmd)
				<-done
				return fmt.Errorf("cd-paranoia stalled — WAV stopped growing for %s (hung read killed)", ripTrackStallTimeout)
			}
		}
	}
}
