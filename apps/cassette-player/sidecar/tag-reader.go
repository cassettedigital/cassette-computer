// Tag reading for FLAC and MP3 (and, read-only, M4A: see tag-reader-mp4.go).
//
// Used by the MBID resolver to figure out which files already have a
// MusicBrainz Recording ID and to extract the (artist, title, album,
// duration) tuple needed for fuzzy lookup. Read-only — see tag-writer.go
// for the write-back path.
//
// Pure-Go: no shelling out to ffprobe or AtomicParsley. M4A is read here but
// never written (tag-writer.go stays FLAC/MP3 only).

package main

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/bogem/id3v2/v2"
	flac "github.com/go-flac/go-flac/v2"
	flacvorbis "github.com/go-flac/flacvorbis/v2"
)

// trackTags is the format-agnostic view of the bits the resolver cares
// about. All fields are optional — the resolver gates on which ones are
// missing.
type trackTags struct {
	Artist          string
	Title           string
	Album           string
	MBID            string
	DurationSeconds int
}

// Vorbis comment / ID3v2 conventions used by Picard and Navidrome. The
// "trackid" naming is historic — despite the name, this stores the
// MusicBrainz Recording ID. See
//   https://picard-docs.musicbrainz.org/en/appendices/tag_mapping.html
const (
	vorbisMBIDKey      = "musicbrainz_trackid"
	id3MBIDDescription = "MusicBrainz Track Id"
)

// readTags returns the resolver-relevant tags for the given file. The
// path's extension (case-insensitive) decides the parser. Unsupported
// extensions return (nil, errUnsupportedFormat) so the caller can log
// and skip without treating it as a hard error.
func readTags(path string) (*trackTags, error) {
	switch strings.ToLower(extOf(path)) {
	case ".flac":
		return readFLACTags(path)
	case ".mp3":
		return readMP3Tags(path)
	case ".m4a":
		return readM4ATags(path)
	default:
		return nil, errUnsupportedFormat
	}
}

var errUnsupportedFormat = errors.New("unsupported audio format for Layer 1 resolver")

func extOf(path string) string {
	i := strings.LastIndex(path, ".")
	if i < 0 {
		return ""
	}
	return path[i:]
}

// readFLACTags parses FLAC StreamInfo + Vorbis Comment blocks. Duration
// is derived from StreamInfo (sample count / sample rate), which is
// always present in a valid FLAC stream.
func readFLACTags(path string) (*trackTags, error) {
	f, err := parseFLACMeta(path)
	if err != nil {
		return nil, fmt.Errorf("parse flac: %w", err)
	}

	out := &trackTags{}

	if si, infoErr := f.GetStreamInfo(); infoErr == nil && si != nil && si.SampleRate > 0 {
		out.DurationSeconds = int(si.SampleCount / int64(si.SampleRate))
	}

	for _, block := range f.Meta {
		if block.Type != flac.VorbisComment {
			continue
		}
		cmt, parseErr := flacvorbis.ParseFromMetaDataBlock(*block)
		if parseErr != nil {
			continue
		}
		out.Artist = firstVorbis(cmt, "artist", "albumartist")
		out.Title = firstVorbis(cmt, "title")
		out.Album = firstVorbis(cmt, "album")
		out.MBID = strings.TrimSpace(firstVorbis(cmt, vorbisMBIDKey))
	}

	return out, nil
}

// parseFLACMeta reads a FLAC's metadata blocks (stream info, tags, pictures) and closes the file before it
// returns. flac.ParseFile keeps the file open behind the audio frames until someone calls Close, and leaks
// it outright when the parse fails, so a reader that wants only tags or a picture must not use it: a scan
// of a big library ran the hub out of open files, held off only by the garbage collector (BUG-869).
func parseFLACMeta(path string) (*flac.File, error) {
	fh, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer fh.Close()
	return flac.ParseMetadata(bufio.NewReader(fh))
}

// parseFLACFile is flac.ParseFile for a writer, which needs the audio frames to write the file back out:
// it closes the file when the parse fails, which flac.ParseFile doesn't. The caller defers f.Close();
// f.WriteTo closes it too, once the frames are copied.
func parseFLACFile(path string) (*flac.File, error) {
	fh, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	f, err := flac.ParseBytes(flac.NewBufIOWithInner(fh))
	if err != nil {
		fh.Close()
		return nil, err
	}
	return f, nil
}

func firstVorbis(cmt *flacvorbis.MetaDataBlockVorbisComment, names ...string) string {
	for _, name := range names {
		values, err := cmt.Get(name)
		if err != nil {
			continue
		}
		for _, v := range values {
			if strings.TrimSpace(v) != "" {
				return v
			}
		}
	}
	return ""
}

// readMP3Tags parses ID3v2 frames. Duration falls back to 0 if the file
// lacks a TLEN frame — we do not decode MP3 frame headers to compute it.
// Tracks ripped by Picard, MusicBee, or iTunes virtually always carry TLEN.
func readMP3Tags(path string) (*trackTags, error) {
	tag, err := id3v2.Open(path, id3v2.Options{Parse: true})
	if err != nil {
		return nil, fmt.Errorf("open mp3: %w", err)
	}
	defer tag.Close()

	out := &trackTags{
		Artist: strings.TrimSpace(tag.Artist()),
		Title:  strings.TrimSpace(tag.Title()),
		Album:  strings.TrimSpace(tag.Album()),
	}

	if tlen := strings.TrimSpace(tag.GetTextFrame("TLEN").Text); tlen != "" {
		if ms, err := strconv.ParseInt(tlen, 10, 64); err == nil && ms > 0 {
			out.DurationSeconds = int(ms / 1000)
		}
	}

	for _, frame := range tag.GetFrames("TXXX") {
		udf, ok := frame.(id3v2.UserDefinedTextFrame)
		if !ok {
			continue
		}
		if strings.EqualFold(udf.Description, id3MBIDDescription) {
			out.MBID = strings.TrimSpace(udf.Value)
			break
		}
	}

	return out, nil
}
