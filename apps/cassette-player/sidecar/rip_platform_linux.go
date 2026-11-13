//go:build linux

// rip_platform_linux.go - the Linux implementation of discPlatform.
//
// Linux is actually closer to macOS here than Windows is: both macOS and Linux
// drive the disc through cd-paranoia, the SAME libcdio tool (Windows ships a
// libcdio-paranoia build too, but the surrounding OS plumbing - presence, eject -
// is pure Win32). So the TOC probe and raw track read below are a direct port of
// rip_platform_darwin.go's cd-paranoia invocations and reuse the OS-neutral
// parseParanoiaTOC + disc-ID math VERBATIM (same +150 MusicBrainz convention, same
// disc-ID hash). Only the OS-forced differences change, mirroring how
// rip_platform_windows.go is shaped:
//
//   - a Linux machine can carry several optical drives (/dev/sr0, /dev/sr1, ...),
//     so every cd-paranoia call names the device it probed with `-d /dev/sr0`
//     (macOS has one drive and passes no -d; this matches Windows's per-drive-
//     letter `-d "D:"`).
//   - there is no IOKit / ioreg / drutil / Disk Arbitration, so drive + media
//     presence come from the CDROM_DRIVE_STATUS ioctl on each /dev/sr* device
//     (the Linux analogue of Windows's IOCTL_STORAGE_CHECK_VERIFY2), not the
//     registry.
//   - eject is the CDROMEJECT ioctl on the device, not diskutil / drutil - and,
//     like the Windows IOCTL_STORAGE_EJECT_MEDIA path, needs no external binary.
//   - there is no auto-mounted CDDA filesystem on Linux either (nothing analogous
//     to macOS's /Volumes .aiff tracks), so ripTrackFallbackToWAV has no honest
//     answer and returns a clear error, same as Windows - the OS-neutral
//     retryFailedTracks + completeness gate already degrade a genuinely unreadable
//     track to "incomplete".
//   - the stall-watchdog kill reuses the SAME POSIX process-group primitives Linux
//     shares with macOS (proc_group_posix.go's setOwnProcessGroup / killProcessGroup,
//     Setpgid + a negative-PID signal) - there is nothing OS-specific left to write
//     here, just call them.
//
// No root is required for the common case: on a typical desktop distro the
// interactive user's session is in the "cdrom" group (or the distro grants direct
// access via udev/polkit), which is enough to open /dev/sr0 for cd-paranoia's SCSI
// pass-through and for these ioctls. A permission-denied open surfaces as a clear
// error (see classifyLinuxProbeFailure) - do not attempt to elevate.

package main

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

// linuxDisc is the Linux discPlatform. It shells out to the system cd-paranoia
// for the TOC probe and raw track read (byte-identical to macOS by construction,
// same as Windows) and uses the Linux CDROM ioctls for presence + eject.
type linuxDisc struct{}

func init() { discOS = linuxDisc{} }

// ── Linux CDROM ioctl constants ─────────────────────────────────────────────────
//
// golang.org/x/sys/unix exports no CDROM_* constants at all for linux (verified:
// `GOOS=linux GOARCH=amd64 go doc golang.org/x/sys/unix` and a grep of the
// generated zerrors_linux_*.go / zsysnum_linux_*.go sources turn up nothing named
// CDROM). These two are hand-rolled from linux/cdrom.h - stable kernel UAPI ioctl
// numbers, unchanged since the CD-ROM ioctl interface was introduced.
const (
	// cdromDriveStatus is CDROM_DRIVE_STATUS (0x5326): returns one of the cds*
	// values below. Its real argument selects which changer "slot" to query;
	// unix.IoctlRetInt always passes 0, which is the correct ("only") slot for an
	// ordinary single-tray drive - the near-universal desktop case. A multi-disc
	// changer would need the real CDSL_CURRENT sentinel instead; out of scope here.
	cdromDriveStatus = 0x5326
	// cdromEject is CDROMEJECT (0x5309): opens the tray. Takes no argument.
	cdromEject = 0x5309
)

// CDROM_DRIVE_STATUS return values, from linux/cdrom.h.
const (
	cdsNoDisc        = 1
	cdsTrayOpen      = 2
	cdsDriveNotReady = 3
	cdsDiscOk        = 4
)

// ── discPlatform: probe / presence ─────────────────────────────────────────────

// probeDrive finds the optical device that has media seated, then reads its TOC
// with `cd-paranoia -Q -d <device>` and parses it with the OS-neutral
// parseParanoiaTOC - so the +150 convention and the disc-ID hash come out
// identical to macOS and Windows. There is no no-spin fast path on Linux (no
// IOKit equivalent), so, like the macOS cd-paranoia fallback and the whole
// Windows probe, this spins the drive. On no drive / no media / unparseable TOC
// it returns the matching structured DriveProbe.
func (linuxDisc) probeDrive() DriveProbe {
	devices := opticalDevices()
	if len(devices) == 0 {
		return DriveProbe{
			DrivePresent:    false,
			DiscPresent:     false,
			PermissionState: "unknown",
			Message:         "No disc drive detected.",
		}
	}
	device := firstDeviceWithMedia(devices)
	if device == "" {
		return DriveProbe{
			DrivePresent:    true,
			DiscPresent:     false,
			PermissionState: "unknown",
			Message:         "Insert an audio CD to rip.",
		}
	}

	var probe DriveProbe
	for attempt := 0; attempt <= maxProbeRetries; attempt++ {
		out, _ := exec.Command(cdParanoiaBin, "-Q", "-d", device).CombinedOutput()
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
		probe = classifyLinuxProbeFailure(text)
		// Media is physically loaded (we confirmed via ioctl), so a parse miss is a
		// scan race or a data disc. Re-probe a few times unless it is a permission
		// wall, mirroring the macOS/Windows "disc present but cd-paranoia missed it"
		// retry.
		retryable := probe.DiscPresent && probe.PermissionState != "denied"
		if retryable && attempt < maxProbeRetries {
			log.Printf("probeDrive: media present on %s but cd-paranoia missed the TOC, re-probing (attempt %d/%d)", device, attempt+1, maxProbeRetries)
			time.Sleep(probeRetryDelay)
			continue
		}
		break
	}
	return probe
}

// classifyLinuxProbeFailure interprets a failed `cd-paranoia -Q` when media is
// known to be loaded (opticalDevices + the CDROM_DRIVE_STATUS ioctl already
// confirmed a disc). It only needs to separate a permission wall from "not a
// readable audio CD"; there is no macOS-style drutil/ioreg truth to cross-check.
func classifyLinuxProbeFailure(text string) DriveProbe {
	low := strings.ToLower(text)
	if strings.Contains(low, "permission denied") || strings.Contains(low, "eacces") || strings.Contains(low, "not permitted") {
		return DriveProbe{
			DrivePresent: true, DiscPresent: true,
			PermissionState: "denied",
			Message:         "Cassette couldn't access the disc drive.",
		}
	}
	// Media is loaded but cd-paranoia read no audio TOC (a data disc, or a scan
	// race). DiscPresent stays true so the retry loop runs; the prose asks for an
	// audio CD, matching the macOS/Windows "no audio tracks" outcome.
	return DriveProbe{
		DrivePresent: true, DiscPresent: true,
		PermissionState: "granted",
		Message:         "Insert an audio CD to rip.",
	}
}

// opticalMediaPresent reports whether any optical drive has media seated, plus the
// device path (e.g. "/dev/sr0") used as both the cd-paranoia `-d` argument and the
// eject target. This is the Linux analogue of the macOS IOKit presence probe and
// the Windows IOCTL_STORAGE_CHECK_VERIFY2 probe; like Windows (and unlike IOKit)
// it cannot see a disc through a full spin-down, since the ioctl opens the device,
// but a seated disc reads present. The 2s cache wrapper (opticalMediaPresentCached,
// OS-neutral) already calls through discOS, so nothing else changes.
func (linuxDisc) opticalMediaPresent() (bool, string) {
	device := firstDeviceWithMedia(opticalDevices())
	if device == "" {
		return false, ""
	}
	return true, device
}

// enhancedLastTrackBound would bound an enhanced-CD's last audio track to the audio
// session lead-out so cd-paranoia never over-reads the inter-session gap. The math
// is OS-neutral (frames = AudioLeadout - TrackOffsets[last] - 1); only the TOC
// source differs. On Linux, as on Windows, the only TOC source is `cd-paranoia -Q`,
// whose text surfaces just the audio tracks - it does not expose the separate
// audio-session lead-out that distinguishes an enhanced CD, so AudioLeadout is
// unknown (0) and this returns (0, 0), exactly as the macOS path does when its
// no-spin TOC is unavailable. The last track then rips by number. Honors
// ripFixtureMode.
func (linuxDisc) enhancedLastTrackBound() (position, audioFrames int) {
	if ripFixtureMode {
		return 0, 0
	}
	// No enhanced-CD lead-out signal available from cd-paranoia -Q; fall through to
	// ripping the last track by number (the safe default).
	return 0, 0
}

// ── discPlatform: track read ───────────────────────────────────────────────────

// ripTrackToWAV extracts one track to wavOut by driving cd-paranoia through the
// SAME span strings macOS and Windows use, so the WAV bytes are identical for a
// clean disc (same reader, same 2352-byte CDDA sectors). maxFrames > 0 bounds the
// read to that many frames from the track start (enhanced-CD last track); 0 rips
// the whole track by number. Preserves ripFixtureMode, the 3-attempt loop, the
// empty-output check, and the fast-return-on-stall contract.
func (linuxDisc) ripTrackToWAV(position, maxFrames int, wavOut string) (attempts int, err error) {
	if ripFixtureMode {
		// Synthesize audio instead of reading a disc (Chunk 4 UI gate) - identical
		// to macOS/Windows so CASSETTE_RIP_FIXTURE works cross-platform.
		freq := fmt.Sprintf("sine=frequency=%d:duration=1", 220+position*10)
		if out, e := exec.Command("ffmpeg", "-v", "error", "-y", "-f", "lavfi",
			"-i", freq, "-ac", "2", "-ar", "44100", wavOut).CombinedOutput(); e != nil {
			return 1, fmt.Errorf("fixture synth: %v: %.150s", e, out)
		}
		return 1, nil
	}

	device := firstDeviceWithMedia(opticalDevices())
	if device == "" {
		return 0, fmt.Errorf("no optical drive with a disc to read track %d", position)
	}

	span := fmt.Sprintf("%d-%d", position, position)
	if maxFrames > 0 {
		// Stop at the audio lead-out instead of over-reading into the gap - the
		// documented cd-paranoia lockup case (same span form as macOS/Windows).
		span = fmt.Sprintf("%d[.0]-%d%s", position, position, framesToParanoiaMSFLinux(maxFrames))
	}

	for attempts = 1; attempts <= ripMaxAttempts; attempts++ {
		if ripStopRequested.Load() {
			return attempts - 1, fmt.Errorf("rip stopped by user")
		}
		runErr := runCDParanoiaWatchedLinux(device, span, wavOut)
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
			// A stall is a deterministic drive hang on this region - retrying just
			// hangs again. Fail fast so the caller's fallback / completeness gate takes over.
			return attempts, err
		}
	}
	return attempts - 1, err
}

// errNoLinuxCDDAFallback is returned by ripTrackFallbackToWAV: Linux has no
// auto-mounted CDDA filesystem to recover a hung track from, so there is no honest
// equivalent of the macOS /Volumes .aiff path (same gap Windows has).
var errNoLinuxCDDAFallback = fmt.Errorf("no CDDA fallback read on Linux")

// ripTrackFallbackToWAV has no honest Linux analogue: there is no auto-mounted
// CDDA filesystem to re-read a hung track from. Returning an error lets the
// OS-neutral retryFailedTracks pass + the completeness gate degrade the track to
// "incomplete" rather than crashing, same as Windows.
func (linuxDisc) ripTrackFallbackToWAV(position int, wavOut string) error {
	return fmt.Errorf("track %d unreadable: %w", position, errNoLinuxCDDAFallback)
}

// framesToParanoiaMSFLinux formats a CD-frame count as cd-paranoia's [mm:ss.ff]
// span address (ff = frames, 0-74), used as a RELATIVE offset within a track.
// Identical math to the macOS/Windows helpers; named distinctly to avoid confusion
// across the per-OS files.
func framesToParanoiaMSFLinux(frames int) string {
	if frames < 0 {
		frames = 0
	}
	return fmt.Sprintf("[%02d:%02d.%02d]", frames/(75*60), (frames/75)%60, frames%75)
}

// ── discPlatform: eject ────────────────────────────────────────────────────────

// ejectDisc opens the optical device and issues the CDROMEJECT ioctl. device is
// the /dev/sr* path opticalMediaPresent handed back; if empty (device not
// threaded through), it falls back to the first optical device found. Honors ctx
// for cancellation/timeout. No external "eject" binary is used, so there is no
// missing-binary failure mode to handle - only the open/ioctl can fail, and both
// return a clean error.
func (linuxDisc) ejectDisc(ctx context.Context, device string) error {
	dev := device
	if dev == "" {
		if devices := opticalDevices(); len(devices) > 0 {
			dev = devices[0]
		}
	}
	if dev == "" {
		log.Printf("eject: no optical drive to eject")
		return fmt.Errorf("Couldn't eject the disc.")
	}

	done := make(chan error, 1)
	go func() { done <- ejectDeviceLinux(dev) }()

	select {
	case <-ctx.Done():
		log.Printf("eject: timed out / cancelled ejecting %s: %v", dev, ctx.Err())
		return fmt.Errorf("Couldn't eject the disc.")
	case err := <-done:
		if err != nil {
			log.Printf("eject: CDROMEJECT on %s failed: %v", dev, err)
			return fmt.Errorf("Couldn't eject the disc.")
		}
		log.Printf("eject: disc ejected from %s", dev)
		return nil
	}
}

// ejectDeviceLinux opens device O_RDONLY|O_NONBLOCK (no write access needed, and
// non-blocking so an already-empty or slow-spinning drive can't hang the open) and
// issues CDROMEJECT.
func ejectDeviceLinux(device string) error {
	fd, err := unix.Open(device, unix.O_RDONLY|unix.O_NONBLOCK, 0)
	if err != nil {
		return err
	}
	defer unix.Close(fd)
	_, err = unix.IoctlRetInt(fd, cdromEject)
	return err
}

// ── discPlatform: kill ─────────────────────────────────────────────────────────

// killRipProcess force-kills an in-flight cd-paranoia read. Linux has real POSIX
// process groups, the same as macOS, so this is not a new mechanism - it just
// calls the shared killProcessGroup helper (proc_group_posix.go, also used by the
// Navidrome supervisor) with SIGKILL against the whole group.
func (linuxDisc) killRipProcess(cmd *exec.Cmd) { killRipProcessGroupLinux(cmd) }

func killRipProcessGroupLinux(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	killProcessGroup(cmd.Process.Pid, syscall.SIGKILL)
}

// ── Linux optical device helpers ───────────────────────────────────────────────

// opticalDevices enumerates Linux optical drive device nodes (/dev/sr0, /dev/sr1,
// ...). filepath.Glob returns matches already sorted, so the result is stable and
// /dev/sr0 (if present) always sorts first.
func opticalDevices() []string {
	matches, _ := filepath.Glob("/dev/sr*")
	return matches
}

// firstDeviceWithMedia returns the first device (from the given candidates) that
// has a disc loaded, or "" if none do.
func firstDeviceWithMedia(devices []string) string {
	for _, d := range devices {
		if deviceHasMedia(d) {
			return d
		}
	}
	return ""
}

// deviceHasMedia reports whether the optical drive at device ("/dev/sr0") has a
// disc loaded, via CDROM_DRIVE_STATUS. Opened O_RDONLY|O_NONBLOCK so a drive with
// no disc (or a slow spin-up) never blocks the open. An open failure (commonly
// EACCES when the running user isn't in the "cdrom" group) reads as "no media"
// here, same as a genuinely empty drive - probeDrive's cd-paranoia pass is what
// eventually surfaces a real permission wall in classifyLinuxProbeFailure, once a
// device with media has been found; if EVERY device fails to open, this degrades
// to "insert a disc" rather than a permission error, which is the same limitation
// Windows's own driveHasMedia has when its IOCTL open is denied.
func deviceHasMedia(device string) bool {
	fd, err := unix.Open(device, unix.O_RDONLY|unix.O_NONBLOCK, 0)
	if err != nil {
		return false
	}
	defer unix.Close(fd)
	status, err := unix.IoctlRetInt(fd, cdromDriveStatus)
	if err != nil {
		return false
	}
	return status == cdsDiscOk
}

// ── Stall watchdog + WAV size (Linux cd-paranoia runner) ───────────────────────
//
// Mirror of the macOS runCDParanoiaWatched / Windows runCDParanoiaWatchedWin: an
// absolute per-track ceiling plus a stall watchdog that kills the read if the WAV
// stops growing. The only changes from macOS are the added `-d <device>` argument
// (Linux, like Windows, can have more than one optical drive) and reusing the
// shared POSIX process-group helpers instead of an inline Setpgid + syscall.Kill
// (same mechanism macOS uses locally; Linux just calls the already-shared copy).

const (
	// ripTrackStallTimeoutLinux kills a read whose WAV hasn't grown this long - a
	// hung frame, not slow error-correction (paranoia still streams during real work).
	ripTrackStallTimeoutLinux = 90 * time.Second
	// ripTrackCeilingLinux is the generous absolute per-track ceiling (a backstop
	// for a stall the size-watch can't see).
	ripTrackCeilingLinux = 20 * time.Minute
	// ripStallCheckEveryLinux is how often the watchdog samples WAV growth.
	ripStallCheckEveryLinux = 10 * time.Second
)

// safeBufferLinux is a concurrency-safe sink for cd-paranoia's combined output;
// the process and Wait()'s goroutine write concurrently, so it must be guarded.
type safeBufferLinux struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *safeBufferLinux) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *safeBufferLinux) tail(n int) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	str := s.b.String()
	if len(str) > n {
		return str[len(str)-n:]
	}
	return str
}

// wavSizeLinux is the current size of the output WAV (0 if not yet created).
func wavSizeLinux(p string) int64 {
	if fi, err := os.Stat(p); err == nil {
		return fi.Size()
	}
	return 0
}

// runCDParanoiaWatchedLinux runs one `cd-paranoia -d <device> -e -w <span> <out>`
// track read under an absolute ceiling AND a stall watchdog. Returns nil on
// success; on a stall, ceiling, user stop, or a genuine cd-paranoia error it
// returns a descriptive error. Never blocks indefinitely. Stores the command into
// activeRipCmd so /api/rip/stop can kill it.
func runCDParanoiaWatchedLinux(device, span, wavOut string) error {
	ctx, cancel := context.WithTimeout(context.Background(), ripTrackCeilingLinux)
	defer cancel()

	cmd := exec.CommandContext(ctx, cdParanoiaBin, "-d", device, "-e", "-w", span, wavOut)
	setOwnProcessGroup(cmd) // own process group (proc_group_posix.go) - same POSIX mechanism as macOS
	cmd.Cancel = func() error { killRipProcessGroupLinux(cmd); return nil }
	out := &safeBufferLinux{}
	cmd.Stdout, cmd.Stderr = out, out

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("cd-paranoia start: %w", err)
	}
	activeRipCmd.Store(cmd)
	defer activeRipCmd.Store(nil)

	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()

	ticker := time.NewTicker(ripStallCheckEveryLinux)
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
				return fmt.Errorf("cd-paranoia exceeded %s ceiling: %.150s", ripTrackCeilingLinux, out.tail(150))
			case werr != nil:
				return fmt.Errorf("cd-paranoia: %v: %.200s", werr, out.tail(200))
			}
			return nil
		case <-ticker.C:
			if ripStopRequested.Load() {
				killRipProcessGroupLinux(cmd)
				<-done
				return fmt.Errorf("rip stopped by user")
			}
			if sz := wavSizeLinux(wavOut); sz > lastSize {
				lastSize = sz
				lastProgress = time.Now()
			} else if time.Since(lastProgress) > ripTrackStallTimeoutLinux {
				killRipProcessGroupLinux(cmd)
				<-done
				return fmt.Errorf("cd-paranoia stalled - WAV stopped growing for %s (hung read killed)", ripTrackStallTimeoutLinux)
			}
		}
	}
}
