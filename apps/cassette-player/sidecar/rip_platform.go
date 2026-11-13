// Per-OS disc I/O seam.
//
// The CD-rip pipeline is two layers. The OS-NEUTRAL layer — disc identity,
// encode, tagging, and the library write — is the same on every platform and
// lives in build-tag-free files (rip.go, rip_resolve.go, rip_discid.go,
// rip_gnudb.go, …). The OS-SPECIFIC layer — reading the drive/TOC, extracting a
// track's audio, ejecting, and force-killing a hung read — differs per OS and
// lives behind the discPlatform interface below.
//
// The neutral layer NEVER shells out to a platform tool directly; it calls
// through discOS. macOS's implementation is rip_platform_darwin.go
// (cd-paranoia / ioreg / drutil / diskutil / afconvert, exactly as before);
// rip_platform_stub.go is the not-yet-implemented placeholder that lets the
// package compile for windows/linux. A Windows port replaces the stub.

package main

import (
	"context"
	"os/exec"
	"sync"
	"time"
)

// discPlatform is the seam between the OS-neutral rip orchestration and the
// platform-specific disc I/O. One implementation is compiled in per OS (selected
// by the init() in the matching platform file), exposed as discOS.
type discPlatform interface {
	// probeDrive reads the seated disc's TOC and classifies drive/disc/permission
	// state. A non-nil DriveProbe.TOC means a readable audio CD was parsed.
	probeDrive() DriveProbe

	// opticalMediaPresent reports whether optical media is physically loaded, plus
	// the whole-disk device id used for eject. Where the OS supports it this
	// survives a drive spin-down (media seen without a mounted volume).
	opticalMediaPresent() (present bool, device string)

	// enhancedLastTrackBound returns (lastTrackPosition, audioFrames) when the
	// seated disc's last audio track must be bounded to avoid over-reading a
	// trailing data session, else (0, 0). audioFrames is a RELATIVE frame count
	// from the track's start.
	enhancedLastTrackBound() (position, audioFrames int)

	// ripTrackToWAV extracts one audio track to wavOut. maxFrames > 0 bounds the
	// read to that many frames from the track's start (enhanced-CD last track);
	// 0 rips the whole track by number. Returns the number of read attempts made.
	ripTrackToWAV(position, maxFrames int, wavOut string) (attempts int, err error)

	// ripTrackFallbackToWAV is the OS-level recovery read for a track the primary
	// reader can't get without hanging (macOS: the auto-mounted CDDA .aiff path).
	ripTrackFallbackToWAV(position int, wavOut string) error

	// ejectDisc opens the drive / spits the disc out. device is the whole-disk id
	// when the OS handed us one (else ""), so the impl can target the exact disc.
	ejectDisc(ctx context.Context, device string) error

	// killRipProcess force-kills an in-flight track-read process (and, where the OS
	// has process groups, its whole group). A no-op when cmd isn't running.
	killRipProcess(cmd *exec.Cmd)
}

// discOS is the active per-OS implementation. It is assigned by the init() in the
// platform file compiled for this build (darwin → darwinDisc, else → stubDisc).
var discOS discPlatform

// opticalMediaPresentCached is discOS.opticalMediaPresent with a short TTL so the
// frequently-polled status handler doesn't spawn a probe on every request. The
// registry only changes on physical insert/eject, so a 2s cache is plenty fresh.
func opticalMediaPresentCached() (bool, string) {
	opticalCacheMu.Lock()
	defer opticalCacheMu.Unlock()
	if !opticalCacheAt.IsZero() && time.Since(opticalCacheAt) < 2*time.Second {
		return opticalCachePresent, opticalCacheBSD
	}
	present, bsd := discOS.opticalMediaPresent()
	opticalCacheAt, opticalCachePresent, opticalCacheBSD = time.Now(), present, bsd
	return present, bsd
}

var (
	opticalCacheMu      sync.Mutex
	opticalCacheAt      time.Time
	opticalCachePresent bool
	opticalCacheBSD     string
)
