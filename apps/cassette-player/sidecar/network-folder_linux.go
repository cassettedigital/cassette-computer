//go:build linux

package main

import "golang.org/x/sys/unix"

func statfsTypeName(*unix.Statfs_t) string { return "" }

func statfsMagic(st *unix.Statfs_t) int64 { return int64(st.Type) }
