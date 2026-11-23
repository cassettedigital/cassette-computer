//go:build !windows

package main

// driveOf: only Windows names a drive by a letter it can hand to another drive. A Mac keeps a drive at
// /Volumes/<its name>, and Linux mounts where it's told, so a folder there is found by its path.
func driveOf(string) (string, string, bool) { return "", "", false }

func findOnDrive(string, string) (string, bool) { return "", false }
