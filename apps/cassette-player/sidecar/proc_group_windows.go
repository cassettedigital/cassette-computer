//go:build windows

// proc_group_windows.go - the Windows answer to process groups (the Windows port, 2026-11-07).
//
// Windows has no POSIX process groups or signals. What the hub needs from them is two things, and Windows
// gives both another way:
//   - a child it starts (Navidrome) opens no console window of its own and gets its own group, so a Ctrl+C
//     meant for the hub never reaches it;
//   - stopping that child takes everything it started along, which is a process-tree end (taskkill /T).
// Navidrome keeps its library in SQLite, which survives a hard stop, so there is no gentler request to make
// first; the grace period in killSupervisedNavidrome simply ends sooner. The app shell puts the whole hub in a
// job that Windows ends with the app (desktop/src-tauri/src/win.rs), so a crash leaves nothing behind either.

package main

import (
	"os/exec"
	"strconv"
	"syscall"

	"golang.org/x/sys/windows"
)

// setOwnProcessGroup starts cmd in its own group, with no console window.
func setOwnProcessGroup(cmd *exec.Cmd) {
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.HideWindow = true
	cmd.SysProcAttr.CreationFlags |= windows.CREATE_NO_WINDOW | windows.CREATE_NEW_PROCESS_GROUP
}

// killProcessGroup ends pid and everything it started. Either signal ends it outright (see above).
func killProcessGroup(pid int, _ syscall.Signal) {
	kill := exec.Command("taskkill", "/PID", strconv.Itoa(pid), "/T", "/F")
	kill.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.CREATE_NO_WINDOW}
	_ = kill.Run()
}
