//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

// revealInFileManager selects target in File Explorer. Explorer parses its own
// command line and is picky about quoting: "/select," must be followed straight
// away by the quoted path, which Go's usual argument quoting does not produce, so
// the line is written out whole. A Windows path can never hold a double quote.
// Explorer exits 1 even when the window opened, so the caller only Start()s it and
// never reads its exit code as failure.
func revealInFileManager(target string) *exec.Cmd {
	cmd := exec.Command("explorer.exe")
	cmd.SysProcAttr = &syscall.SysProcAttr{CmdLine: `explorer.exe /select,"` + target + `"`}
	return cmd
}
