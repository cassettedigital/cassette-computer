// Full tag-writing for freshly ripped FLACs (Chunk 3).
//
// Unlike tag-writer.go (which stamps only the musicbrainz_trackid onto files
// that already carry tags), a rip starts from a bare FLAC straight out of the
// encoder, so we write the whole Vorbis-comment set: title/artist/album/track
// numbers/date plus the MusicBrainz IDs. The musicbrainz_trackid (recording
// MBID) is what the existing sidecar resolver + library-sync key on, so a
// ripped album is recognised immediately — no MusicBrainz re-lookup needed.

package main

import (
	"bytes"
	"fmt"
	"strconv"

	flacvorbis "github.com/go-flac/flacvorbis/v2"
	flac "github.com/go-flac/go-flac/v2"
)

// writeRipTags replaces the FLAC's Vorbis comment block with the full tag set
// derived from the matched MusicBrainz release + track. Atomic write.
func writeRipTags(path string, rel *MatchedRelease, tr RippedTrackMeta) error {
	f, err := parseFLACFile(path)
	if err != nil {
		return fmt.Errorf("parse flac: %w", err)
	}
	defer f.Close()

	cmt := flacvorbis.New()
	add := func(k, v string) {
		if v != "" {
			_ = cmt.Add(k, v)
		}
	}
	add("TITLE", tr.Title)
	add("ARTIST", tr.Artist)
	add("ALBUM", rel.Album)
	add("ALBUMARTIST", rel.AlbumArtist)
	add("TRACKNUMBER", strconv.Itoa(tr.Position))
	if rel.TrackCount > 0 {
		add("TRACKTOTAL", strconv.Itoa(rel.TrackCount))
		add("TOTALTRACKS", strconv.Itoa(rel.TrackCount))
	}
	// Disc identity — Navidrome reads DISCNUMBER/DISCTOTAL/DISCSUBTITLE (mappings.yaml).
	// A single-disc rip still stamps 1/1 (explicit "disc 1 of 1", not "unknown");
	// DISCSUBTITLE is omitted when MusicBrainz gave the medium no title.
	discNo, discTotal := rel.MediumPos, rel.MediumCount
	if discNo < 1 {
		discNo = 1
	}
	if discTotal < 1 {
		discTotal = 1
	}
	add("DISCNUMBER", strconv.Itoa(discNo))
	add("DISCTOTAL", strconv.Itoa(discTotal))
	add("DISCSUBTITLE", rel.MediumTitle)
	add("DATE", rel.Date)
	add(vorbisMBIDKey, tr.RecordingMBID) // musicbrainz_trackid = recording MBID
	add("MUSICBRAINZ_ALBUMID", rel.ReleaseMBID)
	add("MUSICBRAINZ_DISCID", rel.DiscID)

	// IMPORT-ANYWAY markers. For a disc with no MusicBrainz identity we stamp the
	// Cassette local identity directly: the Disc ID is the stable album key, the
	// per-track local ID is the cross-device track identity, and NEEDS_NAMING
	// flags an album a future edit feature can rename. Custom tags Navidrome
	// ignores; only written for unidentified rips so matched files stay clean.
	if rel.Unidentified {
		add("CASSETTE_LOCAL_ALBUM_ID", rel.DiscID)
		add("CASSETTE_LOCAL_ID", tr.LocalID)
		if rel.NeedsNaming {
			add("CASSETTE_NEEDS_NAMING", "1")
		}
	}

	newBlock := cmt.Marshal()
	idx := -1
	for i, b := range f.Meta {
		if b.Type == flac.VorbisComment {
			idx = i
			break
		}
	}
	if idx >= 0 {
		f.Meta[idx] = &newBlock
	} else {
		f.Meta = append(f.Meta, &newBlock)
	}

	var buf bytes.Buffer
	if _, err := f.WriteTo(&buf); err != nil {
		return fmt.Errorf("serialize flac: %w", err)
	}
	return atomicWriteFile(path, buf.Bytes(), 0o644)
}
