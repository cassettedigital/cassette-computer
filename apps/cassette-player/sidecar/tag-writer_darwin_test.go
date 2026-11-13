//go:build darwin

package main

import (
	"bytes"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"unsafe"

	"golang.org/x/sys/unix"
)

// BUG-861 on macOS: a rewritten song keeps its Finder tags, its Finder comment,
// every other extended attribute but the quarantine flag, and its creation date.
func TestMBIDWriteKeepsFinderTagsAndCreationDate(t *testing.T) {
	// The bytes macOS stores for Finder tags are a binary plist; any bytes do.
	tags := []byte("bplist00\xa1\x01ULoved\n2\x08\x0a\x00\x00\x00\x00\x00\x00\x01\x01")
	attrs := map[string][]byte{
		"com.apple.metadata:_kMDItemUserTags":      tags,
		"com.apple.metadata:kMDItemFinderComment":  []byte("bplist00Vmy note"),
		"com.apple.metadata:kMDItemWhereFroms":     []byte("bplist00\xa0"),
		"digital.cassette.test.someone-elses-attr": {0, 1, 2, 3},
	}
	created := unix.Timespec{Sec: 946684800, Nsec: 0} // 2000-01-01, long before the write

	dir := t.TempDir()
	for _, name := range []string{"a.flac", "a.mp3"} {
		p := filepath.Join(dir, name)
		if name == "a.flac" {
			writeTestFLAC(t, p, 0o640)
		} else {
			writeTestMP3(t, p, 3, 0o640)
		}
		for k, v := range attrs {
			if err := unix.Setxattr(p, k, v, 0); err != nil {
				t.Fatalf("set %s: %v", k, err)
			}
		}
		if err := unix.Setxattr(p, "com.apple.quarantine", []byte("0081;00000000;Safari;"), 0); err != nil {
			t.Fatalf("set quarantine: %v", err)
		}
		setCreated(t, p, created)

		if err := writeMBIDTag(p, testMBID); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if got, err := readTags(p); err != nil || got.MBID != testMBID {
			t.Fatalf("%s: tag did not land: %+v %v", name, got, err)
		}
		for k, v := range attrs {
			got, err := getXattr(p, k)
			if err != nil || !bytes.Equal(got, v) {
				t.Errorf("%s: %s after write = %q, %v; want %q", name, k, got, err, v)
			}
		}
		if _, err := getXattr(p, "com.apple.quarantine"); err == nil {
			t.Errorf("%s: the quarantine flag was carried onto the new file", name)
		}
		fi, err := os.Lstat(p)
		if err != nil {
			t.Fatal(err)
		}
		if fi.Mode() != 0o640 {
			t.Errorf("%s: mode after write = %v, want -rw-r-----", name, fi.Mode())
		}
		bt := fi.Sys().(*syscall.Stat_t).Birthtimespec
		if bt.Sec != created.Sec {
			t.Errorf("%s: creation date after write = %d, want %d", name, bt.Sec, created.Sec)
		}
		if fi.ModTime().Unix() <= created.Sec {
			t.Errorf("%s: the modification date must be the write's", name)
		}
	}
}

func setCreated(t *testing.T, path string, ts unix.Timespec) {
	t.Helper()
	al := unix.Attrlist{Bitmapcount: unix.ATTR_BIT_MAP_COUNT, Commonattr: unix.ATTR_CMN_CRTIME}
	buf := (*[unsafe.Sizeof(ts)]byte)(unsafe.Pointer(&ts))[:]
	if err := unix.Setattrlist(path, &al, buf, unix.FSOPT_NOFOLLOW); err != nil {
		t.Fatalf("set creation date: %v", err)
	}
}
