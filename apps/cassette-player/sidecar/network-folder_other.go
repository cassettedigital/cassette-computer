//go:build !darwin && !linux && !windows

package main

func isNetworkFolder(string) bool { return false }
