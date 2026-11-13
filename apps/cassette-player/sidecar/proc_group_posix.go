//go:build !windows

// proc_group_posix.go — POSIX process-group primitives (macOS, Linux).
//
// The supervisor spawns Navidrome in its OWN process group so quitting the app
// can tear the whole group down together. Setpgid and the negative-PID signal are
// POSIX-only; Windows has no process groups, so those calls live behind this seam
// (proc_group_windows.go is the no-op counterpart) to keep the package building
// cross-platform. Behavior on macOS and Linux is exactly as it was inline.

package main

import (
	"os/exec"
	"syscall"
)

// setOwnProcessGroup makes cmd start in its own process group, so the whole group
// (the child and any helpers it spawns) can be signalled together.
func setOwnProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

// killProcessGroup sends sig to the entire process group led by pid (negative pid).
func killProcessGroup(pid int, sig syscall.Signal) {
	_ = syscall.Kill(-pid, sig)
}
