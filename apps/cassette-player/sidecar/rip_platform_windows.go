//go:build windows

// rip_platform_windows.go - the Windows implementation of discPlatform.
//
// This mirrors the macOS disc I/O (rip_platform_darwin.go) as faithfully as the
// platform allows. The lowest-risk way to keep the ripped WAV bytes identical to
// macOS for the same disc is to drive the SAME libcdio tool: we ship
// cd-paranoia.exe (from the libcdio-paranoia build - the exact codebase macOS's
// cd-paranoia is a port of) in bin/ and run the identical `-Q` probe and
// `-e -w <span> <out>` raw-read invocations, reusing the OS-neutral
// parseParanoiaTOC and the +150 disc-ID math verbatim. The only differences from
// macOS are the ones the OS forces:
//
//   - a Windows machine can carry several optical drive letters, so every
//     cd-paranoia call names the drive it probed with `-d "D:"` (macOS has one
//     drive and passes no -d).
//   - there is no IOKit / ioreg / drutil / Disk Arbitration, so drive + media
//     presence come from Win32 device IOCTLs (GetLogicalDrives + GetDriveType,
//     then IOCTL_STORAGE_CHECK_VERIFY2) instead of the registry.
//   - eject is IOCTL_STORAGE_EJECT_MEDIA on the raw device handle, not
//     diskutil / drutil.
//   - there is no auto-mounted /Volumes CDDA filesystem, so the macOS .aiff
//     recovery read (ripTrackFallbackToWAV) has no honest analogue and returns a
//     clear error - the OS-neutral retryFailedTracks + completeness gate already
//     degrade a genuinely unreadable track to "incomplete".
//   - the stall-watchdog kill is a process-tree taskkill / TerminateProcess
//     (Windows has no POSIX process groups or SIGKILL).
//
// No admin / UAC is required: Windows Vista and later grant the interactive user
// full read+write access to removable optical device objects by default, which is
// exactly what cd-paranoia's SCSI pass-through and these IOCTLs need. An
// ERROR_ACCESS_DENIED here means a Remote Desktop session or a Removable Storage
// group policy, not missing elevation - surface it, do not elevate.

package main

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"golang.org/x/sys/windows"
)

// windowsDisc is the Windows discPlatform. It shells out to the bundled
// cd-paranoia.exe for the TOC probe and raw track read (byte-identical to macOS
// by construction) and uses Win32 device IOCTLs for presence + eject.
type windowsDisc struct{}

func init() { discOS = windowsDisc{} }

// ── Win32 device constants ─────────────────────────────────────────────────────
//
// None of these IOCTL codes are predefined in golang.org/x/sys/windows, so they
// are declared here via the CTL_CODE formula
// ((DeviceType<<16)|(Access<<14)|(Function<<2)|Method). Get a value wrong and
// DeviceIoControl returns ERROR_INVALID_FUNCTION.
const (
	// IOCTL_STORAGE_CHECK_VERIFY2 - FILE_ANY_ACCESS, so it works on a 0-access
	// handle; used for the frequent media-presence poll without needing read/write.
	ioctlStorageCheckVerify2 = 0x2D0800
	// IOCTL_STORAGE_EJECT_MEDIA - spits the disc out (read-access IOCTL).
	ioctlStorageEjectMedia = 0x2D4808
)

// driveTypeCDROM is GetDriveType's return for an optical drive (DRIVE_CDROM = 5).
// Declared locally so the classification does not depend on the constant's
// presence in a given x/sys/windows version.
const driveTypeCDROM = 5

// errNoWindowsCDDAFallback is returned by ripTrackFallbackToWAV: Windows has no
// auto-mounted CDDA filesystem to recover a hung track from, so there is no honest
// equivalent of the macOS /Volumes .aiff path. A truly unreadable track is handled
// by the OS-neutral retry pass + completeness gate as "incomplete".
var errNoWindowsCDDAFallback = fmt.Errorf("no CDDA fallback read on Windows")

// ── discPlatform: probe / presence ─────────────────────────────────────────────

// probeDrive finds the optical drive letter that has media seated, then reads its
// TOC with `cd-paranoia -Q -d "<drive>"` and parses it with the OS-neutral
// parseParanoiaTOC - so the +150 convention and the disc-ID hash come out
// identical to macOS. There is no ioreg no-spin fast path on Windows, so this
// (like the macOS cd-paranoia fallback) spins the drive. On no drive / no media /
// unparseable TOC it returns the matching structured DriveProbe.
func (windowsDisc) probeDrive() DriveProbe {
	letters := opticalDriveLetters()
	if len(letters) == 0 {
		return DriveProbe{
			DrivePresent:    false,
			DiscPresent:     false,
			PermissionState: "unknown",
			Message:         "No disc drive detected.",
		}
	}
	device := firstDriveWithMedia(letters)
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
		probe = classifyWindowsProbeFailure(text)
		// Media is physically loaded (we confirmed via IOCTL), so a parse miss is a
		// scan race or a data disc. Re-probe a few times unless it is a permission
		// wall, mirroring the macOS "disc present but cd-paranoia missed it" retry.
		retryable := probe.DiscPresent && probe.PermissionState != "denied"
		if retryable && attempt < maxProbeRetries {
			log.Printf("probeDrive: media present on %s but cd-paranoia missed the TOC - re-probing (attempt %d/%d)", device, attempt+1, maxProbeRetries)
			time.Sleep(probeRetryDelay)
			continue
		}
		break
	}
	return probe
}

// classifyWindowsProbeFailure interprets a failed `cd-paranoia -Q` when media is
// known to be loaded (opticalDriveLetters + IOCTL already confirmed a disc). It
// only needs to separate a permission wall from "not a readable audio CD"; there
// is no ioreg/drutil truth to cross-check on Windows.
func classifyWindowsProbeFailure(text string) DriveProbe {
	low := strings.ToLower(text)
	if strings.Contains(low, "permission denied") || strings.Contains(low, "access is denied") || strings.Contains(low, "access denied") {
		return DriveProbe{
			DrivePresent:    true,
			DiscPresent:     true,
			PermissionState: "denied",
			Message:         "Cassette couldn't access the disc drive.",
		}
	}
	// Media is loaded but cd-paranoia read no audio TOC (a data disc, or a scan
	// race). DiscPresent stays true so the retry loop runs; the prose asks for an
	// audio CD, matching the macOS "no audio tracks" outcome.
	return DriveProbe{
		DrivePresent:    true,
		DiscPresent:     true,
		PermissionState: "granted",
		Message:         "Insert an audio CD to rip.",
	}
}

// opticalMediaPresent reports whether any optical drive has media seated, plus the
// drive letter (e.g. "D:") used as both the cd-paranoia `-d` argument and the eject
// device. This is the Windows analogue of the macOS IOKit presence probe; unlike
// IOKit it cannot see a disc through a full spin-down (the IOCTL opens the device),
// but a seated disc reads present. The 2s cache wrapper (opticalMediaPresentCached,
// OS-neutral) already calls through discOS, so nothing else changes.
func (windowsDisc) opticalMediaPresent() (bool, string) {
	device := firstDriveWithMedia(opticalDriveLetters())
	if device == "" {
		return false, ""
	}
	return true, device
}

// enhancedLastTrackBound would bound an enhanced-CD's last audio track to the audio
// session lead-out so cd-paranoia never over-reads the inter-session gap. The math
// is OS-neutral (frames = AudioLeadout - TrackOffsets[last] - 1); only the TOC
// source differs. On Windows the only TOC source is `cd-paranoia -Q`, whose text
// surfaces just the audio tracks - it does not expose the separate audio-session
// lead-out that distinguishes an enhanced CD, so AudioLeadout is unknown (0) and
// this returns (0, 0), exactly as the macOS path does when its no-spin TOC is
// unavailable. The last track then rips by number. A future native
// IOCTL_CDROM_READ_TOC_EX read that populates AudioLeadout would light this up with
// no other change. Honors ripFixtureMode.
func (windowsDisc) enhancedLastTrackBound() (position, audioFrames int) {
	if ripFixtureMode {
		return 0, 0
	}
	// No enhanced-CD lead-out signal available from cd-paranoia -Q; fall through to
	// ripping the last track by number (the safe default).
	return 0, 0
}

// ── discPlatform: track read ───────────────────────────────────────────────────

// ripTrackToWAV extracts one track to wavOut by driving the bundled cd-paranoia.exe
// through the SAME span strings macOS uses, so the WAV bytes are identical for a
// clean disc (same reader, same 2352-byte CDDA sectors). maxFrames > 0 bounds the
// read to that many frames from the track start (enhanced-CD last track); 0 rips the
// whole track by number. Preserves ripFixtureMode, the 3-attempt loop, the
// empty-output check, and the fast-return-on-stall contract.
func (windowsDisc) ripTrackToWAV(position, maxFrames int, wavOut string) (attempts int, err error) {
	if ripFixtureMode {
		// Synthesize audio instead of reading a disc (Chunk 4 UI gate) - identical
		// to the macOS fixture so CASSETTE_RIP_FIXTURE works cross-platform.
		freq := fmt.Sprintf("sine=frequency=%d:duration=1", 220+position*10)
		if out, e := exec.Command("ffmpeg", "-v", "error", "-y", "-f", "lavfi",
			"-i", freq, "-ac", "2", "-ar", "44100", wavOut).CombinedOutput(); e != nil {
			return 1, fmt.Errorf("fixture synth: %v: %.150s", e, out)
		}
		return 1, nil
	}

	device := firstDriveWithMedia(opticalDriveLetters())
	if device == "" {
		return 0, fmt.Errorf("no optical drive with a disc to read track %d", position)
	}

	span := fmt.Sprintf("%d-%d", position, position)
	if maxFrames > 0 {
		// Stop at the audio lead-out instead of over-reading into the gap - the
		// documented cd-paranoia lockup case (same span form as macOS).
		span = fmt.Sprintf("%d[.0]-%d%s", position, position, framesToParanoiaMSFWin(maxFrames))
	}

	for attempts = 1; attempts <= ripMaxAttempts; attempts++ {
		if ripStopRequested.Load() {
			return attempts - 1, fmt.Errorf("rip stopped by user")
		}
		runErr := runCDParanoiaWatchedWin(device, span, wavOut)
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

// ripTrackFallbackToWAV has no honest Windows analogue: there is no auto-mounted
// CDDA filesystem to re-read a hung track from. Returning an error lets the
// OS-neutral retryFailedTracks pass + the completeness gate degrade the track to
// "incomplete" rather than crashing. A future tolerant native re-read
// (IOCTL_CDROM_RAW_READ with error tolerance) could replace this.
func (windowsDisc) ripTrackFallbackToWAV(position int, wavOut string) error {
	return fmt.Errorf("track %d unreadable: %w", position, errNoWindowsCDDAFallback)
}

// framesToParanoiaMSFWin formats a CD-frame count as cd-paranoia's [mm:ss.ff] span
// address (ff = frames, 0-74), used as a RELATIVE offset within a track. Identical
// math to the macOS framesToParanoiaMSF; named distinctly to avoid confusion across
// the per-OS files.
func framesToParanoiaMSFWin(frames int) string {
	if frames < 0 {
		frames = 0
	}
	return fmt.Sprintf("[%02d:%02d.%02d]", frames/(75*60), (frames/75)%60, frames%75)
}

// ── discPlatform: eject ────────────────────────────────────────────────────────

// ejectDisc opens the optical device and issues IOCTL_STORAGE_EJECT_MEDIA. device
// is the drive letter opticalMediaPresent handed back ("D:"); it is normalized to
// the raw device path \\.\D: for the CreateFile open. Honors ctx for
// cancellation/timeout. GENERIC_READ is enough - eject is a read-access IOCTL and
// needs no admin.
func (windowsDisc) ejectDisc(ctx context.Context, device string) error {
	letter := deviceLetter(device)
	if letter == "" {
		// No device threaded through - fall back to the first optical drive.
		if letters := opticalDriveLetters(); len(letters) > 0 {
			letter = letters[0]
		}
	}
	if letter == "" {
		log.Printf("eject: no optical drive to eject")
		return fmt.Errorf("Couldn't eject the disc.")
	}

	done := make(chan error, 1)
	go func() {
		h, err := openOpticalDevice(letter, windows.GENERIC_READ)
		if err != nil {
			done <- err
			return
		}
		defer windows.CloseHandle(h)
		var bytesReturned uint32
		done <- windows.DeviceIoControl(h, ioctlStorageEjectMedia, nil, 0, nil, 0, &bytesReturned, nil)
	}()

	select {
	case <-ctx.Done():
		log.Printf("eject: timed out / cancelled ejecting %s: %v", letter, ctx.Err())
		return fmt.Errorf("Couldn't eject the disc.")
	case err := <-done:
		if err != nil {
			log.Printf("eject: IOCTL_STORAGE_EJECT_MEDIA on %s failed: %v", letter, err)
			return fmt.Errorf("Couldn't eject the disc.")
		}
		log.Printf("eject: disc ejected from %s", letter)
		return nil
	}
}

// ── discPlatform: kill ─────────────────────────────────────────────────────────

// killRipProcess force-kills an in-flight cd-paranoia.exe read. Windows has no
// POSIX process groups or SIGKILL, so it terminates the whole process tree with
// `taskkill /PID <pid> /T /F` (mirroring what the Tauri shell's reap path does) and
// also calls Process.Kill() as a backstop - so the drive handle is released before
// the next attempt opens the device.
func (windowsDisc) killRipProcess(cmd *exec.Cmd) {
	killRipProcessTreeWin(cmd)
}

func killRipProcessTreeWin(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	pid := cmd.Process.Pid
	// Tree kill: cd-paranoia may itself spawn nothing, but /T is harmless and
	// guarantees no orphan holds the raw drive handle.
	_ = exec.Command("taskkill", "/PID", strconv.Itoa(pid), "/T", "/F").Run()
	_ = cmd.Process.Kill()
}

// ── Win32 optical device helpers ───────────────────────────────────────────────

// opticalDriveLetters enumerates the drive letters whose type is DRIVE_CDROM, e.g.
// ["D:", "E:"]. GetLogicalDrives returns a bitmask (bit 0 = A:, bit 2 = C:, ...);
// GetDriveType on each root "X:\" filters to optical drives.
func opticalDriveLetters() []string {
	mask, err := windows.GetLogicalDrives()
	if err != nil {
		log.Printf("optical: GetLogicalDrives failed: %v", err)
		return nil
	}
	var letters []string
	for i := 0; i < 26; i++ {
		if mask&(1<<uint(i)) == 0 {
			continue
		}
		letter := string(rune('A'+i)) + ":"
		rootPtr, err := windows.UTF16PtrFromString(letter + `\`)
		if err != nil {
			continue
		}
		if windows.GetDriveType(rootPtr) == driveTypeCDROM {
			letters = append(letters, letter)
		}
	}
	return letters
}

// firstDriveWithMedia returns the first drive letter (from the given candidates)
// that has media seated, or "" if none do.
func firstDriveWithMedia(letters []string) string {
	for _, letter := range letters {
		if driveHasMedia(letter) {
			return letter
		}
	}
	return ""
}

// driveHasMedia reports whether the optical drive at letter ("D:") has a disc
// loaded. It opens the raw device with a 0-access handle and issues
// IOCTL_STORAGE_CHECK_VERIFY2 (FILE_ANY_ACCESS, so a 0-access handle suffices).
// An empty drive returns ERROR_NOT_READY - a normal "no disc" signal, not a
// failure to log loudly.
func driveHasMedia(letter string) bool {
	h, err := openOpticalDevice(letter, 0)
	if err != nil {
		return false
	}
	defer windows.CloseHandle(h)
	var bytesReturned uint32
	err = windows.DeviceIoControl(h, ioctlStorageCheckVerify2, nil, 0, nil, 0, &bytesReturned, nil)
	return err == nil
}

// openOpticalDevice opens the raw optical device for a drive letter with the given
// access mask (0 for a query-only handle, GENERIC_READ for eject). The device is
// opened via the \\.\ namespace (\\.\D:), NOT the filesystem root D:\ - only the
// raw-device path accepts storage IOCTLs. The path is passed as UTF-16, as all
// Win32 path args must be.
func openOpticalDevice(letter string, access uint32) (windows.Handle, error) {
	raw := `\\.\` + deviceLetter(letter)
	p, err := windows.UTF16PtrFromString(raw)
	if err != nil {
		return windows.InvalidHandle, err
	}
	return windows.CreateFile(
		p,
		access,
		windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE,
		nil,
		windows.OPEN_EXISTING,
		0,
		0,
	)
}

// deviceLetter normalizes whatever device string was threaded through (a bare "D",
// a "D:", or a "\\.\D:") down to the "D:" letter form cd-paranoia and CreateFile
// both build from. Returns "" if there is no usable letter.
func deviceLetter(device string) string {
	d := strings.TrimSpace(device)
	d = strings.TrimPrefix(d, `\\.\`)
	d = strings.TrimPrefix(d, `\\?\`)
	d = strings.TrimSuffix(d, `\`)
	if d == "" {
		return ""
	}
	// Keep the leading drive letter and ensure a single trailing colon.
	first := d[0]
	if (first >= 'A' && first <= 'Z') || (first >= 'a' && first <= 'z') {
		return strings.ToUpper(string(first)) + ":"
	}
	return ""
}

// ── Stall watchdog + WAV size (Windows cd-paranoia runner) ─────────────────────
//
// Mirror of the macOS runCDParanoiaWatched: an absolute per-track ceiling plus a
// stall watchdog that kills the read if the WAV stops growing. The only changes are
// the added `-d <device>` argument and the Windows process-tree kill.

const (
	// ripTrackStallTimeoutWin kills a read whose WAV hasn't grown this long - a hung
	// frame, not slow error-correction (paranoia still streams during real work).
	ripTrackStallTimeoutWin = 90 * time.Second
	// ripTrackCeilingWin is the generous absolute per-track ceiling (a backstop for
	// a stall the size-watch can't see).
	ripTrackCeilingWin = 20 * time.Minute
	// ripStallCheckEveryWin is how often the watchdog samples WAV growth.
	ripStallCheckEveryWin = 10 * time.Second
)

// safeBufferWin is a concurrency-safe sink for cd-paranoia's combined output; the
// process and Wait()'s goroutine write concurrently, so it must be guarded.
type safeBufferWin struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (s *safeBufferWin) Write(p []byte) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.b.Write(p)
}

func (s *safeBufferWin) tail(n int) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	str := s.b.String()
	if len(str) > n {
		return str[len(str)-n:]
	}
	return str
}

// wavSizeWin is the current size of the output WAV (0 if not yet created).
func wavSizeWin(p string) int64 {
	if fi, err := os.Stat(p); err == nil {
		return fi.Size()
	}
	return 0
}

// runCDParanoiaWatchedWin runs one `cd-paranoia -d <device> -e -w <span> <out>`
// track read under an absolute ceiling AND a stall watchdog. Returns nil on
// success; on a stall, ceiling, user stop, or a genuine cd-paranoia error it returns
// a descriptive error. Never blocks indefinitely. Stores the command into
// activeRipCmd so /api/rip/stop can kill it.
func runCDParanoiaWatchedWin(device, span, wavOut string) error {
	ctx, cancel := context.WithTimeout(context.Background(), ripTrackCeilingWin)
	defer cancel()

	cmd := exec.CommandContext(ctx, cdParanoiaBin, "-d", device, "-e", "-w", span, wavOut)
	// Own process group so a group-style teardown is possible; the actual kill goes
	// through taskkill /T (Windows has no negative-PID group signal).
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.CREATE_NEW_PROCESS_GROUP}
	cmd.Cancel = func() error { killRipProcessTreeWin(cmd); return nil }
	out := &safeBufferWin{}
	cmd.Stdout, cmd.Stderr = out, out

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("cd-paranoia start: %w", err)
	}
	activeRipCmd.Store(cmd)
	defer activeRipCmd.Store(nil)

	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()

	ticker := time.NewTicker(ripStallCheckEveryWin)
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
				return fmt.Errorf("cd-paranoia exceeded %s ceiling: %.150s", ripTrackCeilingWin, out.tail(150))
			case werr != nil:
				return fmt.Errorf("cd-paranoia: %v: %.200s", werr, out.tail(200))
			}
			return nil
		case <-ticker.C:
			if ripStopRequested.Load() {
				killRipProcessTreeWin(cmd)
				<-done
				return fmt.Errorf("rip stopped by user")
			}
			if sz := wavSizeWin(wavOut); sz > lastSize {
				lastSize = sz
				lastProgress = time.Now()
			} else if time.Since(lastProgress) > ripTrackStallTimeoutWin {
				killRipProcessTreeWin(cmd)
				<-done
				return fmt.Errorf("cd-paranoia stalled - WAV stopped growing for %s (hung read killed)", ripTrackStallTimeoutWin)
			}
		}
	}
}
