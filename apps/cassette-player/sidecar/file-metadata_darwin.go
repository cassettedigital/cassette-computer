//go:build darwin

package main

// #include <stdint.h>
// #include <stdlib.h>
// #include <string.h>
// #include <sys/attr.h>
// #include <unistd.h>
//
// // cassetteCarryDates copies the creation and date-added dates of src onto dst
// // (both paths, neither followed if a link). Dates the volume doesn't keep are
// // skipped. 0 on success, -1 with errno set otherwise.
// static int cassetteCarryDates(const char *src, const char *dst) {
//     struct attrlist want;
//     memset(&want, 0, sizeof(want));
//     want.bitmapcount = ATTR_BIT_MAP_COUNT;
//     want.commonattr = ATTR_CMN_RETURNED_ATTRS | ATTR_CMN_CRTIME | ATTR_CMN_ADDEDTIME;
//     struct {
//         uint32_t length;
//         attribute_set_t returned;
//         struct timespec crtime;
//         struct timespec added;
//     } __attribute__((aligned(4), packed)) got;
//     if (getattrlist(src, &want, &got, sizeof(got), FSOPT_NOFOLLOW | FSOPT_PACK_INVAL_ATTRS) != 0) {
//         return -1;
//     }
//     struct attrlist set;
//     memset(&set, 0, sizeof(set));
//     set.bitmapcount = ATTR_BIT_MAP_COUNT;
//     char buf[2 * sizeof(struct timespec)];
//     size_t n = 0;
//     if (got.returned.commonattr & ATTR_CMN_CRTIME) {
//         set.commonattr |= ATTR_CMN_CRTIME;
//         memcpy(buf + n, &got.crtime, sizeof(struct timespec));
//         n += sizeof(struct timespec);
//     }
//     if (got.returned.commonattr & ATTR_CMN_ADDEDTIME) {
//         set.commonattr |= ATTR_CMN_ADDEDTIME;
//         memcpy(buf + n, &got.added, sizeof(struct timespec));
//         n += sizeof(struct timespec);
//     }
//     if (n == 0) {
//         return 0;
//     }
//     return setattrlist(dst, &set, buf, n, FSOPT_NOFOLLOW);
// }
import "C"

import (
	"bytes"
	"errors"
	"fmt"
	"log"
	"os"
	"syscall"
	"unsafe"

	"golang.org/x/sys/unix"
)

// xattrsNotCarried are the extended attributes a rewritten song does not take
// over from the old file. The quarantine flag records where the old file was
// downloaded from and is macOS's to set; the rest are the system's own
// bookkeeping, which it refuses to let a program write.
var xattrsNotCarried = map[string]bool{
	"com.apple.quarantine": true,
	"com.apple.provenance": true,
	"com.apple.macl":       true,
	"com.apple.rootless":   true,
}

// carryFileMetadata gives tmp, the rewritten copy of the song at src, what
// the person or macOS attached to the original (BUG-861): every extended
// attribute but the ones above (Finder tags, the Finder comment, where it was
// downloaded from, ...), its group where this account may set it, and its
// creation and date-added dates. An extended attribute that can't be carried
// fails the write, so the song stays as it was; the dates are kept wherever
// the volume allows and only logged when it doesn't.
func carryFileMetadata(src string, fi os.FileInfo, tmp *os.File) error {
	if err := carryXattrs(src, tmp.Name()); err != nil {
		return err
	}
	if st, ok := fi.Sys().(*syscall.Stat_t); ok {
		_ = tmp.Chown(-1, int(st.Gid)) // only a group this account is in; else it keeps the folder's
	}
	csrc, cdst := C.CString(src), C.CString(tmp.Name())
	defer C.free(unsafe.Pointer(csrc))
	defer C.free(unsafe.Pointer(cdst))
	if rc, err := C.cassetteCarryDates(csrc, cdst); rc != 0 {
		log.Printf("tag write: could not keep the creation date of %q: %v", src, err)
	}
	return nil
}

// carryXattrs copies src's extended attributes onto dst, neither path followed
// if a link. A volume with no extended attributes has none to lose.
func carryXattrs(src, dst string) error {
	names, err := listXattrs(src)
	if errors.Is(err, unix.ENOTSUP) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("list extended attributes: %w", err)
	}
	for _, name := range names {
		if xattrsNotCarried[name] {
			continue
		}
		val, err := getXattr(src, name)
		if errors.Is(err, unix.ENOATTR) {
			continue // removed since the list was read
		}
		if err != nil {
			return fmt.Errorf("read extended attribute %s: %w", name, err)
		}
		if err := unix.Lsetxattr(dst, name, val, 0); err != nil {
			return fmt.Errorf("keep extended attribute %s: %w", name, err)
		}
	}
	return nil
}

func listXattrs(path string) ([]string, error) {
	for range 3 { // the list can grow between asking its size and reading it
		n, err := unix.Llistxattr(path, nil)
		if err != nil || n == 0 {
			return nil, err
		}
		buf := make([]byte, n)
		n, err = unix.Llistxattr(path, buf)
		if errors.Is(err, unix.ERANGE) {
			continue
		}
		if err != nil {
			return nil, err
		}
		var names []string
		for _, b := range bytes.Split(buf[:n], []byte{0}) {
			if len(b) > 0 {
				names = append(names, string(b))
			}
		}
		return names, nil
	}
	return nil, unix.ERANGE
}

func getXattr(path, name string) ([]byte, error) {
	for range 3 {
		n, err := unix.Lgetxattr(path, name, nil)
		if err != nil {
			return nil, err
		}
		buf := make([]byte, n)
		if n == 0 {
			return buf, nil
		}
		n, err = unix.Lgetxattr(path, name, buf)
		if errors.Is(err, unix.ERANGE) {
			continue
		}
		if err != nil {
			return nil, err
		}
		return buf[:n], nil
	}
	return nil, unix.ERANGE
}
