//go:build darwin

package main

import "golang.org/x/sys/unix"

func statfsTypeName(st *unix.Statfs_t) string { return unix.ByteSliceToString(st.Fstypename[:]) }

func statfsMagic(*unix.Statfs_t) int64 { return 0 }
