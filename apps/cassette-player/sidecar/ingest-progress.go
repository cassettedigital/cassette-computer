// The live ingest report: what the window's "Adding" card reads while new music
// goes in.
//
// The report (ingestProgress) is served in /status.json, which the window polls
// every 1.5 s. It used to say nothing while the MusicBrainz lookups ran, at about
// one a second, so the card sat on "Finding what it is" for a minute or more. It
// now carries the stage, how many songs this pass will look up, how many it has
// and how many it found, and the records coming in (each with one song's id so
// the window can show its cover), filled as soon as the scan shows them.
//
// ingestPass is the bookkeeping, kept free of locks and I/O so it can be tested
// alone. The one live pass sits under ingestProgMu. The resolver reaches it
// through liveIngestProgress, whose calls hold the lock only long enough to count.

package main

import (
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/text/unicode/norm"
)

// The stages of one ingest, in order. `state` keeps its old values
// (idle | scanning | working | done | error) for windows that predate `stage`:
// lookingUp and saving are both "working" there.
const (
	ingestStageScanning  = "scanning"  // Navidrome is reading the new files
	ingestStageLookingUp = "lookingUp" // the resolver is asking MusicBrainz what each song is
	ingestStageSaving    = "saving"    // the library is going up to the cloud
	ingestStageDone      = "done"
	ingestStageError     = "error"

	// ingestAlbumsMax is how many records the card can show.
	ingestAlbumsMax = 8
)

// ingestProgress is the report as JSON. Every field older windows read keeps its
// meaning; stage, checked and albums are new.
type ingestProgress struct {
	State string `json:"state"`           // idle | scanning | working | done | error
	Stage string `json:"stage,omitempty"` // scanning | lookingUp | saving | done | error (absent while idle)
	Count int    `json:"count,omitempty"` // tracks synced, once this ingest's first sync has landed
	// Total and Identified mean two things, by stage:
	//   - while lookingUp, and in saving before the first sync lands: this pass's
	//     own numbers. Total is the songs the resolver will look up (set before the
	//     first lookup), Identified how many of those it has found so far.
	//   - once a sync of this ingest has landed (saving, done): the library-wide
	//     numbers that sync pushed, as before: Total == Count, the whole inventory,
	//     and Identified, the tracks in it carrying a MusicBrainz recording id.
	// Both are 0 while scanning and on error.
	Total      int `json:"total,omitempty"`
	Checked    int `json:"checked,omitempty"` // songs looked up so far this pass, found or not
	Identified int `json:"identified,omitempty"`
	// Albums are the records this ingest is bringing in, first seen first, at most
	// ingestAlbumsMax. Kept on error so the window can say what was going in.
	Albums []ingestAlbum `json:"albums,omitempty"`
	At     time.Time     `json:"at,omitempty"`
}

// ingestAlbum is one record coming in.
type ingestAlbum struct {
	Album  string `json:"album"`
	Artist string `json:"artist"` // the album artist, else the song's artist
	// TrackID is one of its songs' Navidrome (Subsonic) ids: the window shows the
	// cover through /api/playback/cover?trackId=.
	TrackID string `json:"trackId"`
	// Found turns true once any of its songs is identified, or when one already
	// carried a MusicBrainz id.
	Found bool `json:"found"`
}

// ingestSong is a song new in this ingest, as the library read after the scan
// shows it.
type ingestSong struct {
	ID     string
	Path   string
	Album  string
	Artist string
	HasID  bool // already carries a MusicBrainz id (in its tags, or a match the hub holds)
}

type lookupOutcome uint8

const (
	lookupPending lookupOutcome = iota
	lookupNotFound
	lookupFound
)

// ingestPass is one ingest's bookkeeping. The zero value is "idle".
type ingestPass struct {
	stage string
	at    time.Time

	// lookups holds every song the resolver has planned to check this ingest, by
	// path key. Total is its size; checked and identified count outcomes as they land.
	lookups    map[string]lookupOutcome
	checked    int
	identified int

	albums      []ingestAlbum
	albumByKey  map[string]int // album key → index in albums
	albumByPath map[string]int // path key of a song on one of those albums → index

	// What the latest sync of this ingest pushed, library-wide.
	synced           bool
	syncedCount      int
	syncedIdentified int
}

// ingestStateFor maps a stage onto the older `state` values.
func ingestStateFor(stage string) string {
	switch stage {
	case ingestStageScanning:
		return "scanning"
	case ingestStageLookingUp, ingestStageSaving:
		return "working"
	case ingestStageDone:
		return "done"
	case ingestStageError:
		return "error"
	}
	return "idle"
}

// ingestPathKey is how a path is matched between the resolver's walk and
// Navidrome's report of the same file.
func ingestPathKey(path string) string {
	if path == "" {
		return ""
	}
	k := norm.NFC.String(filepath.Clean(path))
	if runtime.GOOS == "windows" {
		k = strings.ToLower(k)
	}
	return k
}

func ingestAlbumKey(album, artist string) string {
	return normalizeForLocalID(album) + "\x00" + normalizeForLocalID(artist)
}

// begin starts a new ingest, clearing everything the last one left.
func (p *ingestPass) begin() {
	*p = ingestPass{stage: ingestStageScanning}
}

func (p *ingestPass) setStage(stage string) { p.stage = stage }

// running reports whether an ingest is under way (not idle, done or failed).
func (p *ingestPass) running() bool {
	switch p.stage {
	case ingestStageScanning, ingestStageLookingUp, ingestStageSaving:
		return true
	}
	return false
}

// addNewSongs puts the records these songs belong to on the card, first seen
// first, up to ingestAlbumsMax. Songs of a record past the cap are left out.
func (p *ingestPass) addNewSongs(songs []ingestSong) {
	if p.albumByKey == nil {
		p.albumByKey = make(map[string]int)
		p.albumByPath = make(map[string]int)
	}
	for _, s := range songs {
		key := ingestAlbumKey(s.Album, s.Artist)
		i, ok := p.albumByKey[key]
		if !ok {
			if len(p.albums) >= ingestAlbumsMax {
				continue
			}
			i = len(p.albums)
			p.albums = append(p.albums, ingestAlbum{Album: s.Album, Artist: s.Artist, TrackID: s.ID})
			p.albumByKey[key] = i
		}
		pk := ingestPathKey(s.Path)
		if pk != "" {
			p.albumByPath[pk] = i
		}
		if s.HasID || (pk != "" && p.lookups[pk] == lookupFound) {
			p.albums[i].Found = true
		}
	}
}

// planLookups records the songs a resolver run is about to check, before its
// first lookup. A song already planned this ingest (a second run retrying it)
// is not counted twice. New songs put the stage back on lookingUp.
func (p *ingestPass) planLookups(paths []string) {
	if p.lookups == nil {
		p.lookups = make(map[string]lookupOutcome, len(paths))
	}
	added := false
	for _, path := range paths {
		k := ingestPathKey(path)
		if k == "" {
			continue
		}
		if _, ok := p.lookups[k]; ok {
			continue
		}
		p.lookups[k] = lookupPending
		added = true
	}
	if added && p.running() {
		p.stage = ingestStageLookingUp
	}
}

// noteLookup records one song's outcome. A song not found once and found on a
// later run of the same ingest counts as found; one found stays found.
func (p *ingestPass) noteLookup(path string, found bool) {
	k := ingestPathKey(path)
	if k == "" {
		return
	}
	if p.lookups == nil {
		p.lookups = make(map[string]lookupOutcome)
	}
	was, planned := p.lookups[k]
	switch {
	case !planned || was == lookupPending:
		p.checked++
		if found {
			p.identified++
			p.lookups[k] = lookupFound
		} else {
			p.lookups[k] = lookupNotFound
		}
	case was == lookupNotFound && found:
		p.identified++
		p.lookups[k] = lookupFound
	default:
		return
	}
	if found {
		if i, ok := p.albumByPath[k]; ok {
			p.albums[i].Found = true
		}
	}
}

// finishLookups ends a resolver run: songs it never reached (its budget or time
// ran out) drop out of the total, and the stage moves on to saving.
func (p *ingestPass) finishLookups() {
	for k, o := range p.lookups {
		if o == lookupPending {
			delete(p.lookups, k)
		}
	}
	if p.stage == ingestStageLookingUp {
		p.stage = ingestStageSaving
	}
}

// noteSynced records what a sync of this ingest pushed, library-wide.
func (p *ingestPass) noteSynced(count, identified int) {
	p.synced = true
	p.syncedCount = count
	p.syncedIdentified = identified
}

func (p *ingestPass) finish(count, identified int) {
	p.noteSynced(count, identified)
	p.stage = ingestStageDone
}

func (p *ingestPass) fail() { p.stage = ingestStageError }

// snapshot is the report as the window reads it. The albums are a copy, so the
// caller can encode it while lookups keep landing.
func (p *ingestPass) snapshot() ingestProgress {
	s := ingestProgress{
		State:   ingestStateFor(p.stage),
		Stage:   p.stage,
		Checked: p.checked,
		At:      p.at,
	}
	if p.synced && p.stage != ingestStageError {
		s.Count = p.syncedCount
	}
	switch {
	case p.stage == "" || p.stage == ingestStageScanning || p.stage == ingestStageError:
		// nothing counted yet, or (as before) nothing counted on a failed ingest
	case p.stage == ingestStageLookingUp || !p.synced:
		s.Total, s.Identified = len(p.lookups), p.identified
	default:
		s.Total, s.Identified = p.syncedCount, p.syncedIdentified
	}
	if len(p.albums) > 0 {
		s.Albums = append([]ingestAlbum(nil), p.albums...)
	}
	return s
}

// ingestNewSongs picks, from the library as the scan left it, the songs this
// ingest is bringing in, in path order: the order the resolver walks them, so
// the covers light up left to right.
//
// A song is new when it is not among the songs the last sync reported to the
// cloud (prev). When nothing has synced since the hub started (prev nil), it is
// new when the resolver has no record of its file. record reports, for a path,
// whether the resolver has a record and whether that record holds a match.
func ingestNewSongs(tracks []librarySyncTrack, prev map[string]struct{}, record func(path string) (seen, hasID bool)) []ingestSong {
	var out []ingestSong
	for _, t := range tracks {
		if t.SubsonicTrackID == "" {
			continue
		}
		seen, held := false, false
		if t.Path != "" && record != nil {
			seen, held = record(t.Path)
		}
		if prev != nil {
			if _, old := prev[t.SubsonicTrackID]; old {
				continue
			}
		} else if seen {
			continue
		}
		artist := t.ArtistName
		if t.AlbumArtist != nil && strings.TrimSpace(*t.AlbumArtist) != "" {
			artist = *t.AlbumArtist
		}
		out = append(out, ingestSong{
			ID:     t.SubsonicTrackID,
			Path:   t.Path,
			Album:  t.AlbumName,
			Artist: artist,
			HasID:  held || (t.MusicBrainzRecordingID != nil && *t.MusicBrainzRecordingID != ""),
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Path != out[j].Path {
			return out[i].Path < out[j].Path
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// ─── The live pass ───────────────────────────────────────────────────────────

var (
	ingestProgMu sync.RWMutex
	ingestCur    ingestPass
)

// updateIngest changes the live pass under its lock. f must only count: no
// network, no disk.
func updateIngest(f func(p *ingestPass)) {
	ingestProgMu.Lock()
	f(&ingestCur)
	ingestCur.at = nowFn().UTC()
	ingestProgMu.Unlock()
}

// ingestSnapshot is the value the status snapshot embeds (read by /status.json
// and, via that, the window and the web devices panel that poll it).
func ingestSnapshot() ingestProgress {
	ingestProgMu.RLock()
	defer ingestProgMu.RUnlock()
	return ingestCur.snapshot()
}

// liveIngestProgress is the resolverProgress an ingest hands the resolver.
type liveIngestProgress struct{}

func (liveIngestProgress) lookupsPlanned(paths []string) {
	updateIngest(func(p *ingestPass) { p.planLookups(paths) })
}

func (liveIngestProgress) lookupChecked(path string, found bool) {
	updateIngest(func(p *ingestPass) { p.noteLookup(path, found) })
}

func (liveIngestProgress) lookupsFinished() {
	updateIngest(func(p *ingestPass) { p.finishLookups() })
}
