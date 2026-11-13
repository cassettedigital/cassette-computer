// Read-only tag reading for MP4 audio (.m4a): iTunes Store AAC purchases and
// Apple Lossless (ALAC). Returns the same trackTags the FLAC/MP3 readers do, so
// the MBID resolver can identify these files.
//
// Read-only on purpose. Nothing in the hub writes MP4 atoms ("Nothing writes
// AAC", docs/reference/CASSETTE_FILE_WRITEBACK.md), so a MusicBrainz match for
// one of these files is held in the resolver state and carried to the cloud by
// the library sync (attachHeldMBIDs) instead of being stamped into the file.
//
// Pure-Go, no dependency: walks moov → mvhd for the duration and
// moov → udta → meta → ilst for ©ART / ©nam / ©alb and Picard's freeform
// "MusicBrainz Track Id" (which, like the Vorbis/ID3 keys, holds the Recording ID).

package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
)

// mp4MaxMoovBytes bounds how much of the file we pull into memory. moov holds the
// sample tables plus any embedded cover; a real album track is well under this.
const mp4MaxMoovBytes = 64 << 20

const (
	mp4FreeformMean = "com.apple.iTunes"
	mp4MBIDName     = "MusicBrainz Track Id"
)

// readM4ATags parses an .m4a file's metadata without touching its audio.
func readM4ATags(path string) (*trackTags, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open m4a: %w", err)
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		return nil, fmt.Errorf("stat m4a: %w", err)
	}
	moov, err := readTopLevelMP4Box(f, fi.Size(), "moov")
	if err != nil {
		return nil, fmt.Errorf("parse m4a: %w", err)
	}
	return parseMP4Moov(moov), nil
}

// readTopLevelMP4Box returns the body of the first top-level box of type want,
// seeking past everything else (mdat can sit before or after moov).
func readTopLevelMP4Box(r io.ReaderAt, fileSize int64, want string) ([]byte, error) {
	var hdr [16]byte
	for off := int64(0); off+8 <= fileSize; {
		if _, err := r.ReadAt(hdr[:8], off); err != nil {
			return nil, err
		}
		size := int64(binary.BigEndian.Uint32(hdr[:4]))
		typ := string(hdr[4:8])
		hdrLen := int64(8)
		switch size {
		case 1:
			if _, err := r.ReadAt(hdr[8:16], off+8); err != nil {
				return nil, err
			}
			size = int64(binary.BigEndian.Uint64(hdr[8:16]))
			hdrLen = 16
		case 0:
			size = fileSize - off
		}
		if size < hdrLen || size > fileSize-off {
			return nil, fmt.Errorf("malformed %q box at %d", typ, off)
		}
		if typ == want {
			body := size - hdrLen
			if body > mp4MaxMoovBytes {
				return nil, fmt.Errorf("%q box too large (%d bytes)", want, body)
			}
			buf := make([]byte, body)
			if _, err := r.ReadAt(buf, off+hdrLen); err != nil {
				return nil, err
			}
			return buf, nil
		}
		off += size
	}
	return nil, errors.New("no " + want + " box")
}

// mp4Children calls fn for each box packed in buf. A malformed box ends the walk
// quietly: metadata is best-effort, the resolver gates on what it found.
func mp4Children(buf []byte, fn func(typ string, body []byte)) {
	for len(buf) >= 8 {
		size := uint64(binary.BigEndian.Uint32(buf[:4]))
		typ := string(buf[4:8])
		hdrLen := uint64(8)
		switch size {
		case 1:
			if len(buf) < 16 {
				return
			}
			size = binary.BigEndian.Uint64(buf[8:16])
			hdrLen = 16
		case 0:
			size = uint64(len(buf))
		}
		if size < hdrLen || size > uint64(len(buf)) {
			return
		}
		fn(typ, buf[hdrLen:size])
		buf = buf[size:]
	}
}

func parseMP4Moov(moov []byte) *trackTags {
	out := &trackTags{}
	mp4Children(moov, func(typ string, body []byte) {
		switch typ {
		case "mvhd":
			out.DurationSeconds = mp4MvhdSeconds(body)
		case "udta":
			mp4Children(body, func(t string, b []byte) {
				if t == "meta" {
					parseMP4Meta(b, out)
				}
			})
		case "meta": // a few muxers put it straight under moov
			parseMP4Meta(body, out)
		}
	})
	return out
}

// mp4MvhdSeconds reads the movie duration, truncated to whole seconds like the
// FLAC reader.
func mp4MvhdSeconds(b []byte) int {
	if len(b) < 1 {
		return 0
	}
	var timescale, duration uint64
	if b[0] == 1 {
		if len(b) < 32 {
			return 0
		}
		timescale = uint64(binary.BigEndian.Uint32(b[20:24]))
		duration = binary.BigEndian.Uint64(b[24:32])
	} else {
		if len(b) < 20 {
			return 0
		}
		timescale = uint64(binary.BigEndian.Uint32(b[12:16]))
		duration = uint64(binary.BigEndian.Uint32(b[16:20]))
	}
	if timescale == 0 {
		return 0
	}
	return int(duration / timescale)
}

// parseMP4Meta handles both meta layouts: ISO (a full box, 4 bytes of
// version/flags before its children) and QuickTime (children start at once).
func parseMP4Meta(b []byte, out *trackTags) {
	if len(b) >= 8 && string(b[4:8]) != "hdlr" {
		b = b[4:]
	}
	mp4Children(b, func(typ string, body []byte) {
		if typ != "ilst" {
			return
		}
		mp4Children(body, func(item string, ib []byte) {
			switch item {
			case "\xa9ART":
				out.Artist = mp4ItemText(ib)
			case "\xa9nam":
				out.Title = mp4ItemText(ib)
			case "\xa9alb":
				out.Album = mp4ItemText(ib)
			case "----":
				if mbid := mp4FreeformMBID(ib); mbid != "" {
					out.MBID = mbid
				}
			}
		})
	})
}

// mp4ItemText returns the UTF-8 payload of an ilst item's data box.
func mp4ItemText(item []byte) string {
	var s string
	mp4Children(item, func(typ string, body []byte) {
		if typ == "data" && s == "" {
			s = mp4DataText(body)
		}
	})
	return s
}

// mp4DataText decodes a data box: 4 bytes type (1 = UTF-8), 4 bytes locale, payload.
func mp4DataText(body []byte) string {
	if len(body) < 8 {
		return ""
	}
	if binary.BigEndian.Uint32(body[:4])&0x00FFFFFF != 1 {
		return ""
	}
	return strings.TrimSpace(string(body[8:]))
}

// mp4FreeformMBID reads a "----" item and returns its value only when it is the
// iTunes-namespace MusicBrainz Track Id.
func mp4FreeformMBID(item []byte) string {
	var mean, name, value string
	mp4Children(item, func(typ string, body []byte) {
		switch typ {
		case "mean":
			if len(body) >= 4 {
				mean = string(body[4:])
			}
		case "name":
			if len(body) >= 4 {
				name = string(body[4:])
			}
		case "data":
			value = mp4DataText(body)
		}
	})
	if mean != mp4FreeformMean || !strings.EqualFold(name, mp4MBIDName) {
		return ""
	}
	return value
}
