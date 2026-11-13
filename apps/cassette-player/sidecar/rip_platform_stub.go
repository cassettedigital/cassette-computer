//go:build !darwin && !windows && !linux

// rip_platform_stub.go - placeholder disc platform for whatever's left once
// macOS, Windows, and Linux are covered (e.g. an obscure BSD cross-compile).
// macOS is rip_platform_darwin.go, Windows is rip_platform_windows.go, and Linux
// is rip_platform_linux.go; this file covers everything else.
//
// Every method fails with a clear "not supported on this OS yet" error (or the
// safe empty answer for the boolean/bound probes) so the package COMPILES for
// any remaining GOOS without a disc toolchain. This is the clean hole a new port
// fills: swap this file for a rip_platform_<os>.go implementing discPlatform
// against that OS's optical APIs. Nothing else in the rip pipeline changes.

package main

import (
	"context"
	"errors"
	"os/exec"
)

// errDiscUnsupported is returned by every disc operation on a platform that has
// no implementation yet.
var errDiscUnsupported = errors.New("disc operations are not supported on this OS yet")

func init() { discOS = stubDisc{} }

type stubDisc struct{}

func (stubDisc) probeDrive() DriveProbe {
	return DriveProbe{
		DrivePresent:    false,
		DiscPresent:     false,
		PermissionState: "unknown",
		Message:         errDiscUnsupported.Error(),
	}
}

func (stubDisc) opticalMediaPresent() (bool, string) { return false, "" }

func (stubDisc) enhancedLastTrackBound() (int, int) { return 0, 0 }

func (stubDisc) ripTrackToWAV(position, maxFrames int, wavOut string) (int, error) {
	return 0, errDiscUnsupported
}

func (stubDisc) ripTrackFallbackToWAV(position int, wavOut string) error {
	return errDiscUnsupported
}

func (stubDisc) ejectDisc(ctx context.Context, device string) error { return errDiscUnsupported }

func (stubDisc) killRipProcess(cmd *exec.Cmd) {}
