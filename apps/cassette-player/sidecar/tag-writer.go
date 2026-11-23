// Atomic MusicBrainz Recording ID write-back for FLAC and MP3.
//
// The plan locks the storage conventions:
//   - FLAC: Vorbis comment key "musicbrainz_trackid" (Picard / Navidrome convention)
//   - MP3 : ID3v2 TXXX frame with description "MusicBrainz Track Id"
//
// Despite the historic "trackid" name, both keys store the MusicBrainz
// Recording ID — the same value Navidrome surfaces as `musicBrainzId`
// in Subsonic search3 responses.
//
// Atomicity: every write goes through a sibling temp file that is
// fsynced before being renamed over the original. POSIX guarantees the
// rename is atomic on the same filesystem, so the file is never
// observed in a half-written state by Navidrome's scanner. MP3 goes
// through the same path as FLAC: bogem/id3v2's own Save() renamed without
// syncing to disk (BUG-861).
//
// The rename makes a new file, so a song rewritten this way would lose what
// the person or macOS attached to the old one. rewriteKeepingMetadata carries
// it across: permissions, extended attributes (Finder tags and comments among
// them) and the creation and date-added dates (BUG-861). A song the hub must
// not rewrite at all (songHeld: a link, or set read-only) is refused before
// anything is read, and the resolver holds its match on the hub side instead.
//
// M4A / AAC is out of scope for Layer 1 — see the plan's "What's NOT in
// Layer 1" section. Callers should pre-filter with isSupportedAudio.

package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/bogem/id3v2/v2"
	flacvorbis "github.com/go-flac/flacvorbis/v2"
	flac "github.com/go-flac/go-flac/v2"
)

// errSongHeld means the hub must not rewrite this song, so its MusicBrainz
// match is held on the hub side the way an M4A's is (BUG-861).
var errSongHeld = errors.New("song held on the hub side")

// songHeld reports why the song at path must not be rewritten (an error
// wrapping errSongHeld), nil when it may be, or the Lstat error. A link is
// never written: the write would replace the link with a full copy, or reach
// a file outside the music folder. A file whose owner-write permission is off
// was set that way on purpose, and a rename would have rewritten it anyway.
func songHeld(path string) error {
	if inLinkedFolder(path) {
		return fmt.Errorf("%w: it is in a folder Cassette only reads", errSongHeld)
	}
	fi, err := os.Lstat(path)
	if err != nil {
		return err
	}
	return songHeldInfo(fi)
}

// songHeldInfo is songHeld for a file already Lstat'ed.
func songHeldInfo(fi os.FileInfo) error {
	switch {
	case fi.Mode()&fs.ModeSymlink != 0:
		return fmt.Errorf("%w: it is a link to another file", errSongHeld)
	case !fi.Mode().IsRegular():
		return fmt.Errorf("%w: not a regular file", errSongHeld)
	case fi.Mode().Perm()&0o200 == 0:
		return fmt.Errorf("%w: it is set read-only", errSongHeld)
	}
	return nil
}

// writeMBIDTag dispatches to the format-specific writer based on the
// file extension. Returns errUnsupportedFormat for anything other than
// FLAC and MP3 — callers should treat that as a soft skip — and an
// errSongHeld error for a song that must not be rewritten.
func writeMBIDTag(path, mbid string) error {
	if strings.TrimSpace(mbid) == "" {
		return errors.New("refusing to write empty MBID")
	}
	ext := strings.ToLower(extOf(path))
	if ext != ".flac" && ext != ".mp3" {
		return errUnsupportedFormat
	}
	if err := songHeld(path); err != nil {
		return err
	}
	if ext == ".flac" {
		return writeFLACMBID(path, mbid)
	}
	return writeMP3MBID(path, mbid)
}

// writeFLACMBID adds (or replaces) the musicbrainz_trackid Vorbis comment
// in the FLAC file at path. The metadata is rebuilt in memory and the audio
// streamed after it, committed via rewriteKeepingMetadata.
func writeFLACMBID(path, mbid string) error {
	src, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open flac: %w", err)
	}
	defer src.Close() // also closed by f.WriteTo once the audio is copied
	f, err := flac.ParseBytes(flac.NewBufIOWithInner(src))
	if err != nil {
		return fmt.Errorf("parse flac: %w", err)
	}

	var cmt *flacvorbis.MetaDataBlockVorbisComment
	vcIdx := -1
	for i, block := range f.Meta {
		if block.Type == flac.VorbisComment {
			parsed, parseErr := flacvorbis.ParseFromMetaDataBlock(*block)
			if parseErr != nil {
				continue
			}
			cmt = parsed
			vcIdx = i
			break
		}
	}
	if cmt == nil {
		cmt = flacvorbis.New()
	}

	// flacvorbis has no Remove, so to avoid stacking duplicates we
	// rebuild the comments list: keep everything that isn't our key,
	// then append a single fresh value.
	cmt = stripVorbisKey(cmt, vorbisMBIDKey)
	if addErr := cmt.Add(vorbisMBIDKey, mbid); addErr != nil {
		return fmt.Errorf("add vorbis comment: %w", addErr)
	}

	newBlock := cmt.Marshal()
	if vcIdx >= 0 {
		f.Meta[vcIdx] = &newBlock
	} else {
		f.Meta = append(f.Meta, &newBlock)
	}

	return rewriteKeepingMetadata(path, func(w io.Writer) error {
		if _, err := f.WriteTo(w); err != nil {
			return fmt.Errorf("serialize flac: %w", err)
		}
		return nil
	})
}

// stripVorbisKey rebuilds the comment block with all entries for a given
// case-insensitive key removed. Cheaper than reaching into flacvorbis's
// internals.
func stripVorbisKey(in *flacvorbis.MetaDataBlockVorbisComment, key string) *flacvorbis.MetaDataBlockVorbisComment {
	out := flacvorbis.New()
	out.Vendor = in.Vendor
	for _, entry := range in.Comments {
		eqIdx := strings.IndexByte(entry, '=')
		if eqIdx <= 0 {
			out.Comments = append(out.Comments, entry)
			continue
		}
		if strings.EqualFold(entry[:eqIdx], key) {
			continue
		}
		out.Comments = append(out.Comments, entry)
	}
	return out
}

// writeMP3MBID adds (or replaces) the "MusicBrainz Track Id" TXXX frame
// on an MP3. bogem/id3v2 parses and serializes the tag; the new tag and the
// untouched audio after the old one go through rewriteKeepingMetadata, the
// same fsynced path as FLAC, never the library's Save().
func writeMP3MBID(path, mbid string) error {
	src, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("open mp3: %w", err)
	}
	defer src.Close()
	fi, err := src.Stat()
	if err != nil {
		return fmt.Errorf("stat mp3: %w", err)
	}
	audioStart, err := mp3AudioStart(src)
	if err != nil {
		return fmt.Errorf("read mp3 tag header: %w", err)
	}
	if audioStart > fi.Size() {
		return errors.New("mp3 tag runs past the end of the file")
	}
	tag, err := id3v2.ParseReader(io.NewSectionReader(src, 0, audioStart), id3v2.Options{Parse: true})
	if err != nil {
		return fmt.Errorf("parse mp3 tag: %w", err)
	}

	// Remove any existing TXXX:MusicBrainz Track Id frames so we don't
	// stack duplicates.
	existing := tag.GetFrames("TXXX")
	tag.DeleteFrames("TXXX")
	for _, frame := range existing {
		udf, ok := frame.(id3v2.UserDefinedTextFrame)
		if !ok {
			continue
		}
		if strings.EqualFold(udf.Description, id3MBIDDescription) {
			continue
		}
		tag.AddUserDefinedTextFrame(udf)
	}

	tag.AddUserDefinedTextFrame(id3v2.UserDefinedTextFrame{
		Encoding:    mbidFrameEncoding(tag.Version()),
		Description: id3MBIDDescription,
		Value:       mbid,
	})

	return rewriteKeepingMetadata(path, func(w io.Writer) error {
		if _, err := tag.WriteTo(w); err != nil {
			return fmt.Errorf("serialize mp3 tag: %w", err)
		}
		if _, err := io.Copy(w, io.NewSectionReader(src, audioStart, fi.Size()-audioStart)); err != nil {
			return fmt.Errorf("copy mp3 audio: %w", err)
		}
		return src.Close() // let go of the original before it is replaced
	})
}

// mbidFrameEncoding is a text encoding the tag's own ID3v2 version allows.
// UTF-8 exists only in v2.4. A v2.3 tag gets Latin-1, which is exact for the
// description and an MBID (plain ASCII): v2.3's other choice, UTF-16, comes out
// of bogem/id3v2 one byte off (its terminator lands mid-character), and moving
// the whole tag to v2.4 would strand v2.3-only frames such as the year (TYER),
// which other players then stop reading.
func mbidFrameEncoding(version byte) id3v2.Encoding {
	if version == 4 {
		return id3v2.EncodingUTF8
	}
	return id3v2.EncodingISO
}

// mp3AudioStart is where an MP3's audio begins: after its ID3v2 tag (header,
// frames, padding and, in v2.4, the footer), or 0 for a file with no tag.
func mp3AudioStart(r io.ReaderAt) (int64, error) {
	var h [10]byte
	if n, err := r.ReadAt(h[:], 0); n < len(h) {
		if err == nil || errors.Is(err, io.EOF) {
			return 0, nil // shorter than a tag header: no tag
		}
		return 0, err
	}
	if string(h[:3]) != "ID3" {
		return 0, nil
	}
	size := int64(h[6]&0x7f)<<21 | int64(h[7]&0x7f)<<14 | int64(h[8]&0x7f)<<7 | int64(h[9]&0x7f)
	end := int64(len(h)) + size
	if h[3] == 4 && h[5]&0x10 != 0 {
		end += 10 // footer
	}
	return end, nil
}

// atomicWriteFile writes data to a sibling temp file in the same
// directory, fsyncs it, then renames over path. Mode is applied to the
// final file via the temp file's chmod.
func atomicWriteFile(path string, data []byte, mode os.FileMode) error {
	return writeViaTemp(path, mode, func(w io.Writer) error {
		_, err := w.Write(data)
		return err
	}, nil)
}

// rewriteKeepingMetadata replaces the song at path with what fill writes,
// through atomicWriteFile's temp file, fsync and rename. The new file keeps
// the old one's permissions, its extended attributes and its creation and
// date-added dates (carryFileMetadata; macOS only, nothing to carry
// elsewhere). Its modification date is the write's, so Navidrome and the
// resolver see the change. If anything can't be carried, the song is left
// exactly as it was and the write reports the error (BUG-861).
func rewriteKeepingMetadata(path string, fill func(io.Writer) error) error {
	fi, err := os.Lstat(path)
	if err != nil {
		return err
	}
	if inLinkedFolder(path) {
		return fmt.Errorf("%w: it is in a folder Cassette only reads", errSongHeld)
	}
	if err := songHeldInfo(fi); err != nil {
		return err
	}
	return writeViaTemp(path, fi.Mode().Perm(), fill, func(tmp *os.File) error {
		return carryFileMetadata(path, fi, tmp)
	})
}

// writeViaTemp is the shared temp-file path: fill writes the content, the
// mode is applied, finish (when set) adds whatever else the new file must
// carry, and the temp is fsynced and renamed over path. On any error the temp
// is removed and path is untouched.
func writeViaTemp(path string, mode os.FileMode, fill func(io.Writer) error, finish func(tmp *os.File) error) error {
	// The backstop for every file the hub writes: nothing, by any path, lands in a folder Cassette only
	// reads (library-folders.go). songHeld and folderArtAllowed refuse first; this catches anything else.
	if inLinkedFolder(path) {
		return fmt.Errorf("%w: %s is in a folder Cassette only reads", errSongHeld, path)
	}
	dir := filepath.Dir(path)
	base := filepath.Base(path)
	tmp, err := os.CreateTemp(dir, base+".cassette.tmp.*")
	if err != nil {
		return fmt.Errorf("create temp: %w", err)
	}
	tmpName := tmp.Name()

	// On any error path below, remove the temp file. After a successful
	// rename, tmpName no longer exists so this is a no-op.
	cleanup := func() { _ = os.Remove(tmpName) }

	if writeErr := fill(tmp); writeErr != nil {
		_ = tmp.Close()
		cleanup()
		return fmt.Errorf("write temp: %w", writeErr)
	}
	if err := tmp.Chmod(mode); err != nil {
		_ = tmp.Close()
		cleanup()
		return fmt.Errorf("chmod temp: %w", err)
	}
	if finish != nil {
		if err := finish(tmp); err != nil {
			_ = tmp.Close()
			cleanup()
			return err
		}
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		cleanup()
		return fmt.Errorf("fsync temp: %w", err)
	}
	if err := tmp.Close(); err != nil {
		cleanup()
		return fmt.Errorf("close temp: %w", err)
	}
	if err := replaceFile(tmpName, path); err != nil {
		cleanup()
		return fmt.Errorf("rename temp over original: %w", err)
	}
	return nil
}

// ─── Navidrome scan trigger ───────────────────────────────────────────────

// triggerNavidromeScan asks Navidrome to re-scan its music directory so
// the MBIDs we just wrote into the files surface via Subsonic search3.
// Scans are asynchronous — this call returns as soon as Navidrome accepts
// the request; the next library-sync cycle picks up the refreshed data.
func triggerNavidromeScan() error { return triggerNavidromeScanMode(false) }

// triggerNavidromeScanMode starts a Navidrome scan; `full` forces a complete
// re-read instead of the quick pass.
//
// The quick scan decides a folder changed from name+size+mtime, so it cannot see a
// cover rewritten with IDENTICAL size and mtime (rsync --archive, in-place editors).
// The folder-cover fingerprint can see exactly that, and escalating to a full scan is
// how we make Navidrome agree — deliberately chosen over touching the file's mtime,
// because the library is the user's and a tool that preserved mtime meant to.
func triggerNavidromeScanMode(full bool) error {
	if navidromeAdmin == "" {
		return errors.New("NAVIDROME_ADMIN_PW is not set; cannot trigger scan")
	}

	params := url.Values{
		"u": {navidromeAdminUser},
		"p": {navidromeAdmin},
		"v": {"1.16.1"},
		"c": {"cassette-sidecar"},
		"f": {"json"},
	}
	if full {
		params.Set("fullScan", "true")
	}
	endpoint := navidromeBase + "/rest/startScan?" + params.Encode()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("startScan request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("startScan HTTP %d: %s", resp.StatusCode, string(body))
	}
	return nil
}
