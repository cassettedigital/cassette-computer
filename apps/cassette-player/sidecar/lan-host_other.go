//go:build !windows

package main

// platformLANHost: macOS names itself through scutil in routableHostname; Linux has no answer yet.
func platformLANHost() (string, bool) { return "", false }
