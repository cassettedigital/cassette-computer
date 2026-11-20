//go:build !windows

package main

import (
	"os/exec"
	"path/filepath"
	"runtime"
)

// revealInFileManager selects target in the file manager: Finder on a Mac
// (`open -R` opens the folder holding target with target selected). Elsewhere
// there is no common way to select one item, so the folder holding target opens.
func revealInFileManager(target string) *exec.Cmd {
	if runtime.GOOS == "darwin" {
		return exec.Command("open", "-R", target)
	}
	return exec.Command("xdg-open", filepath.Dir(target))
}
