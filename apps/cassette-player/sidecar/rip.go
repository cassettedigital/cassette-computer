// Rip orchestration (Chunk 3): detect → match → per-track rip → encode+verify
// → tag → land in the music folder → trigger Navidrome scan. From there the
// existing resolver + library-sync treat the ripped album like any other
// owned album (it lands tagged with its recording MBIDs, so no re-lookup).
//
// The pipeline is split so the ONE disc-dependent step (cd-paranoia reading
// sectors) is isolated in ripCDTrack; encode → verify → tag → land lives in
// encodeTagLand and is fixture-tested with a sample WAV (rip_test.go, gate b).
//
// Progress is published via an atomic snapshot for the :5173 /rip UI (Chunk 4),
// mirroring status-server.go's statusSnapshot pattern.

package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ── Progress snapshot (consumed by the /rip UI) ──────────────────────────────

type TrackRipStatus struct {
	Position int    `json:"position"`
	Title    string `json:"title"`
	State    string `json:"state"` // pending|ripping|encoding|done|error
	Attempts int    `json:"attempts"`
	Error    string `json:"error,omitempty"`
	// InLibrary marks a detected track the user ALREADY owns (matched against the
	// local library by recording MBID / cassette-local-id), so the detect card can
	// show "In your library" instead of "Queued". Set only on the detect preview.
	InLibrary bool `json:"inLibrary,omitempty"`
}

// RipCandidate is one scored release in the "confirm" pick-list, serialized for
// the hosted panel. ID is the STABLE handle the panel posts back to
// /api/rip/confirm — a release MBID alone is not enough now that gnudb yields
// MBID-less candidates. Source (gnudb / musicbrainz / …) drives the optional
// per-result source indicator (JOB 6).
type RipCandidate struct {
	ID          string  `json:"id"`
	ReleaseMBID string  `json:"releaseMbid,omitempty"`
	Album       string  `json:"album"`
	AlbumArtist string  `json:"albumArtist"`
	Date        string  `json:"date,omitempty"`
	TrackCount  int     `json:"trackCount"`
	MediumPos   int     `json:"mediumPos,omitempty"`
	MediumCount int     `json:"mediumCount,omitempty"`
	MediumTitle string  `json:"mediumTitle,omitempty"`
	Confidence  float64 `json:"confidence"`
	Source      string  `json:"source,omitempty"`
	// Tracks is the candidate's tracklist (title + duration per position) so the
	// compare-and-confirm view (JOB 6) can show it beside the disc's TOC durations
	// without another round-trip. For an aligned (manual-search) candidate the
	// tracklist is in DISC order; a gap track has a blank title.
	Tracks []RipCandidateTrack `json:"tracks,omitempty"`
	// Gaps lists disc track positions this candidate couldn't name (alignment found
	// no release slot for them) — the name-first flow targets these. Flagged lists
	// tracks named by position but with a loose duration (a gentle second-look mark).
	// DroppedTitles names release tracks the disc LACKS (e.g. an omitted interlude),
	// so the UI can explain the difference. All empty for an exact, clean match.
	Gaps          []int    `json:"gaps,omitempty"`
	Flagged       []int    `json:"flagged,omitempty"`
	DroppedTitles []string `json:"droppedTitles,omitempty"`
}

// RipCandidateTrack is one track of a candidate, for the compare view.
type RipCandidateTrack struct {
	Position int    `json:"position"`
	Title    string `json:"title"`
	LengthMs int    `json:"lengthMs,omitempty"`
}

type RipProgress struct {
	// State machine: idle|detecting|matched|confirm|ripping|registering|done|
	// incomplete|error. "incomplete" (A3) is a partial rip that recovered some but
	// not all tracks — distinct from "done" (complete) and "error" (nothing ripped).
	// "confirm" (0 < confidence < threshold) carries Candidates for the user to
	// pick from; "error" is reserved for genuine hardware/permission/TOC failures
	// — a MusicBrainz miss is never an error (it routes to import-anyway).
	State   string `json:"state"`
	Message string `json:"message,omitempty"`
	// Structured drive/disc/permission state (Job 3) — explicit fields so the
	// hosted panel renders the right rung without parsing Message. Always
	// serialized (no omitempty) so consumers can rely on them being present.
	DrivePresent    bool   `json:"drivePresent"`
	DiscPresent     bool   `json:"discPresent"`
	PermissionState string `json:"permissionState"` // granted|denied|unknown
	DiscID          string `json:"discId,omitempty"`
	ReleaseMBID     string `json:"releaseMbid,omitempty"`
	Album           string `json:"album,omitempty"`
	AlbumArtist     string `json:"albumArtist,omitempty"`
	Date            string `json:"date,omitempty"`
	TrackCount      int    `json:"trackCount,omitempty"`
	// Disc position within a multi-disc release (from the matched MB medium), so the
	// detect card can show "Disc 2 of 2" at insert — the signal iTunes shows. Absent
	// for a single-disc release; the card only renders it when MediumCount > 1.
	MediumPos       int              `json:"mediumPos,omitempty"`
	MediumCount     int              `json:"mediumCount,omitempty"`
	MediumTitle     string           `json:"mediumTitle,omitempty"`
	CompletedTracks int              `json:"completedTracks"`
	Tracks          []TrackRipStatus `json:"tracks,omitempty"`
	// OwnedTrackCount is how many of this disc's tracks the user already owns
	// (per-track recording-MBID / local-id match against the local library), set on
	// the detect preview so the panel can answer "how much of this is already mine?"
	// at the album level, not just per row.
	OwnedTrackCount int `json:"ownedTrackCount,omitempty"`
	// AlreadyInLibrary marks that the user already has THIS album — matched by
	// release MBID or normalized album+artist key (albumKey), so it stays true for a
	// compilation whose per-track recording MBIDs differ from the library copy (the
	// case OwnedTrackCount alone misses). The panel uses it to show an "already in
	// your library" state instead of a fresh-rip CTA.
	AlreadyInLibrary bool `json:"alreadyInLibrary,omitempty"`
	// OtherDiscInLibrary marks that a DIFFERENT disc of this same album has already been
	// ripped (ledger: a completed record with a different disc id but the same album).
	// The "part of a set" signal: it gates the detect card's "Disc N of M" (shown only
	// once a sibling disc exists) and disambiguates AlreadyInLibrary's album-name match,
	// which collides across the discs of one set.
	OtherDiscInLibrary bool `json:"otherDiscInLibrary,omitempty"`
	// Confidence is the resolver's score for the chosen/best release (1.0 for an
	// exact Disc ID hit). Candidates is the scored pick-list for the "confirm"
	// state. Unidentified marks an IMPORT-ANYWAY rip (no MusicBrainz identity);
	// NeedsNaming additionally means we couldn't even name the album, so the UI
	// shows "Unknown album" and a future edit feature can target it.
	Confidence   float64        `json:"confidence,omitempty"`
	Candidates   []RipCandidate `json:"candidates,omitempty"`
	Unidentified bool           `json:"unidentified,omitempty"`
	NeedsNaming  bool           `json:"needsNaming,omitempty"`
	// TOCDurations is the disc's per-track length in ms (from the TOC), so the
	// compare-and-confirm view (JOB 6) shows the disc's durations beside a
	// candidate's. Index i is track FirstTrack+i.
	TOCDurations []int  `json:"tocDurations,omitempty"`
	LandedDir    string `json:"landedDir,omitempty"`
	// Registered (Job 1) is true only once the ripped tracks are confirmed
	// queryable in the backend library — the panel claims "in your library"
	// solely on this, never on rip-job completion.
	Registered bool `json:"registered,omitempty"`
	// StartedAt + EtaSeconds (Job 3) drive the in-rip "~X min remaining".
	StartedAt  time.Time `json:"startedAt,omitempty"`
	EtaSeconds int       `json:"etaSeconds,omitempty"`
	// Version is the sidecar build stamp (main.buildVersion), merged in by
	// handleRipStatus so the panel can show which code is actually live — the
	// at-a-glance proof a rebuilt sidecar replaced the bundled one.
	Version string `json:"version,omitempty"`
	// AcoustIDAvailable reports whether audio-fingerprint identification is set up
	// (an ACOUSTID_API_KEY is present), so the panel shows "Figure it out" only
	// when it can actually do something. Merged in by handleRipStatus.
	AcoustIDAvailable bool `json:"acoustidAvailable,omitempty"`
	// HubOS is runtime.GOOS ("darwin"|"windows"|"linux"), merged in by
	// handleRipStatus so a permission-denied panel can show the RIGHT fix
	// instructions for the hub it's actually talking to (System Settings on
	// macOS, the cdrom group on Linux, Group Policy/Remote Desktop on
	// Windows) instead of hardcoding one platform's copy for every hub. See
	// BUG-247.
	HubOS string `json:"hubOS,omitempty"`
	// InterruptedRip notifies the dashboard that a PREVIOUS rip never finished (the
	// app was killed/quit mid-rip), so a partial album doesn't vanish silently.
	// Independent of the current rip; merged in by handleRipStatus.
	InterruptedRip *InterruptedRip `json:"interruptedRip,omitempty"`
	UpdatedAt      time.Time       `json:"updatedAt"`
}

var (
	currentRip atomic.Pointer[RipProgress]
	ripMu      sync.Mutex // serializes whole rip jobs
	ripActive  atomic.Bool
	progMu     sync.Mutex    // guards in-place mutation of the live rip progress
	liveState  *SidecarState // process state for immediate post-rip library-sync (set in main)
	// pendingResolution holds the most recent detect/resolve so /api/rip/confirm
	// can map a chosen release MBID back to its full tracklist, and so
	// import-as-unknown can rebuild the local identity from the same TOC + CD-TEXT
	// — without re-reading the disc or re-hitting MusicBrainz.
	pendingResolution atomic.Pointer[detectResult]
	// lastRippedRel is the release of the most recent rip, so the "Retry track N"
	// endpoint (A4) can re-rip a single failed track without re-reading the disc.
	lastRippedRel atomic.Pointer[MatchedRelease]
)

// detectResult bundles one detect+resolve pass: the scored resolution plus the
// raw signals (TOC, Disc ID, CD-TEXT) needed to act on it later.
type detectResult struct {
	res     *RipResolution
	toc     *TOC
	discID  string
	cdtext  *CDText
	profile *DiscProfile // the intrinsic disc profile (JOB 1), carried to confirm/persist
	// offeredDefaultKey is the candidateKey of the release we DEFAULTED to when the
	// disc first resolved — captured before any manual search re-orders the list, and
	// carried across the search re-store. learnConfirmedIdentity compares the user's
	// final pick against it to record was_override: whether the user accepted our top
	// suggestion or went out of their way to choose something else. "" when nothing
	// was offered (the import terminal). Capture-only — nothing reads it downstream yet.
	offeredDefaultKey string
}

// sweepStaleRipTemp removes leftover cassette-rip-* temp dirs from a previous run
// that crashed or was force-quit mid-rip (os.Exit skips the deferred cleanup, so
// WAV/FLAC temp files would otherwise leak). Job 4. Safe at startup: only this
// process creates that prefix and no rip is running yet.
func sweepStaleRipTemp() {
	matches, _ := filepath.Glob(filepath.Join(os.TempDir(), "cassette-rip-*"))
	for _, m := range matches {
		if err := os.RemoveAll(m); err != nil {
			log.Printf("Could not sweep stale rip temp %s: %v", m, err)
		} else {
			log.Printf("Swept stale rip temp dir: %s", m)
		}
	}
}

// InterruptedRip describes a rip that started but never finalized — the app was
// killed/quit mid-rip — so the dashboard can tell the user instead of leaving a
// half-ripped album with no explanation.
type InterruptedRip struct {
	Album       string `json:"album"`
	AlbumArtist string `json:"albumArtist"`
	TrackCount  int    `json:"trackCount"`
}

// interruptedNotice rides along on the status poll (set at startup when a stranded
// rip marker is found; cleared on dismiss or when the next rip starts).
var interruptedNotice atomic.Pointer[InterruptedRip]

func ripMarkerPath() string { return filepath.Join(sidecarDataDir, "rip-in-progress.json") }

// writeRipMarker records that a rip is underway. If the process dies before
// finalizeRip clears it, the leftover marker is how the next startup knows the rip
// was interrupted. Best-effort.
func writeRipMarker(rel *MatchedRelease) {
	if rel == nil {
		return
	}
	m := InterruptedRip{Album: rel.Album, AlbumArtist: rel.AlbumArtist, TrackCount: rel.TrackCount}
	if data, err := json.Marshal(m); err == nil {
		if err := os.WriteFile(ripMarkerPath(), data, 0o644); err != nil {
			log.Printf("rip-marker: write failed: %v", err)
		}
	}
}

// clearRipMarker removes the in-progress marker — called when a rip reaches ANY
// terminal state (done/incomplete/error) in finalizeRip, so only a genuine
// interruption (death before finalize) leaves it behind.
func clearRipMarker() { _ = os.Remove(ripMarkerPath()) }

// detectInterruptedRip runs once at startup: a leftover marker means the previous
// rip never finalized. Surface it on the status poll (the marker stays until the
// user dismisses it or the next rip starts), so a killed rip is never silent.
func detectInterruptedRip() {
	data, err := os.ReadFile(ripMarkerPath())
	if err != nil {
		return // no marker → clean shutdown
	}
	var m InterruptedRip
	if json.Unmarshal(data, &m) != nil || m.Album == "" {
		clearRipMarker()
		return
	}
	interruptedNotice.Store(&m)
	log.Printf("interrupted rip detected: %q — %q (%d tracks) did not finish", m.AlbumArtist, m.Album, m.TrackCount)
}

// dismissInterruptedRip clears the notice + marker (the user acknowledged it).
func dismissInterruptedRip() {
	interruptedNotice.Store(nil)
	clearRipMarker()
}

// detectSeatedDisc runs once at startup (BUG-199). A disc's identity lives only
// in this process, and detection fires on the Disk Arbitration INSERT event —
// so an app update/relaunch with a disc already seated came back as a nameless
// "disc present" ("Untitled disc") even though the same disc was identified at
// 0.97 a minute earlier. If IOKit says media is seated and nothing else has
// claimed the state machine, run the same detect+resolve the insert event runs.
// Experiential test: quit and reopen the app with a disc in — it keeps its name.
func detectSeatedDisc() {
	if ripFixtureMode {
		return // fixture boots stay in a controllable idle for UI development
	}
	go func() {
		// Give the native DA watcher first claim on boot; if it already kicked
		// a detect (or a rip resumed), the state won't be idle by the time we
		// look. Concurrent detects converge, but there's no point racing one.
		time.Sleep(2 * time.Second)
		if ripActive.Load() {
			return
		}
		if s := loadRip(); s.State != "idle" {
			return
		}
		present, bsd := discOS.opticalMediaPresent()
		if !present {
			return
		}
		daDisc.Store(&discTruth{present: true, bsdName: bsd})
		log.Println("startup: disc already seated — running the insert detect path (BUG-199)")
		dr, err := detectAndResolve()
		if err != nil {
			return // detectAndResolve already published the structured failure state
		}
		publishDetected(dr)
	}()
}

func publishRip(p *RipProgress) {
	p.UpdatedAt = nowFn()
	currentRip.Store(p)
}

// computeEta sets EtaSeconds from the empirical per-completed-track wall-clock
// rate. Pipelining makes "per track" overlapped, but elapsed/completed is still
// a fair running estimate. Zero until the first track lands.
func (p *RipProgress) computeEta() {
	if p.State == "ripping" && p.CompletedTracks > 0 && !p.StartedAt.IsZero() &&
		p.TrackCount > p.CompletedTracks {
		elapsed := nowFn().Sub(p.StartedAt).Seconds()
		per := elapsed / float64(p.CompletedTracks)
		p.EtaSeconds = int(per * float64(p.TrackCount-p.CompletedTracks))
	} else {
		p.EtaSeconds = 0
	}
}

// publishSnap stores an immutable snapshot of prog. The pipelined rip uses
// multiple goroutines (the serial ripper + the encode worker), so we copy under
// progMu and publish the copy — readers (status.json) never see a half-mutated
// struct. Caller must hold progMu.
func publishSnap(prog *RipProgress) {
	snap := *prog
	snap.Tracks = append([]TrackRipStatus(nil), prog.Tracks...)
	snap.computeEta()
	snap.UpdatedAt = nowFn()
	currentRip.Store(&snap)
}

// progUpdate runs mutate under progMu and publishes a snapshot. The single
// synchronization point for all concurrent progress writes during a rip.
func progUpdate(prog *RipProgress, mutate func()) {
	progMu.Lock()
	defer progMu.Unlock()
	mutate()
	publishSnap(prog)
}

func loadRip() *RipProgress {
	if p := currentRip.Load(); p != nil {
		return p
	}
	return &RipProgress{State: "idle", PermissionState: "unknown"}
}

// nowFn is overridable in tests (scripts can't call time.Now via the workflow
// engine, but the sidecar itself can; this keeps rip_test.go deterministic).
var nowFn = time.Now

// ── Config ───────────────────────────────────────────────────────────────────

const (
	ripMaxAttempts = 3
	// ripMaxRetryPasses is the end-of-rip retry passes over still-failed tracks,
	// ON TOP of ripCDTrack's inline ripMaxAttempts. Bounded so a truly unreadable
	// track falls to the incomplete gate instead of looping forever (A2).
	ripMaxRetryPasses = 1
	ripRetrySettle    = 2 * time.Second // brief settle/re-seek before a retry pass
	flacBin           = "flac"
	cdParanoiaBin     = "cd-paranoia"
	// ripRegisterSyncBudget is how long finalizeRip waits SYNCHRONOUSLY for the just-
	// ripped album to appear in Navidrome's index before pushing it to the cloud. The
	// quick scan of one new folder normally lands in seconds; a slower scan falls to
	// the background converger (convergeRippedAlbum) rather than hanging the rip card.
	ripRegisterSyncBudget = 60 * time.Second
)

// ripConvergeBackoff bounds the background converger that runs when the synchronous
// wait didn't confirm the album. Each step nudges the UNGATED ingest, then re-checks,
// so a slow scan converges in minutes instead of waiting on the 1-hour heartbeat gate.
var ripConvergeBackoff = []time.Duration{
	15 * time.Second, 30 * time.Second, 60 * time.Second, 120 * time.Second, 300 * time.Second,
}

// ripFixtureMode (CASSETTE_RIP_FIXTURE=1) drives the whole pipeline WITHOUT a
// disc: detect uses a known TOC and ripCDTrack synthesizes audio instead of
// reading sectors. Used for the Chunk 4 UI gate. Off in normal operation.
var ripFixtureMode = envOr("CASSETTE_RIP_FIXTURE", "") == "1"

// dryRunTOC is the Radiohead — OK Computer disc (same ground-truth TOC the rip
// tests use); in fixture mode detect resolves this against live MusicBrainz.
var dryRunTOC = TOC{
	FirstTrack:    1,
	LastTrack:     12,
	LeadoutOffset: 242041,
	TrackOffsets: []int{
		150, 21632, 50476, 70697, 90709, 113245,
		133019, 141971, 159413, 180955, 198196, 217701,
	},
}

// ── Detect + match ───────────────────────────────────────────────────────────

// detectAndResolve reads the inserted disc's TOC + CD-TEXT, computes its Disc
// ID, and runs the confidence ladder (resolveDisc). The TOC read is the one
// disc-pending step. The only errors returned are GENUINE failures — no drive,
// no disc, permission denied, or a bad TOC — for which it publishes the right
// structured state. A MusicBrainz miss is NOT an error: it resolves to the
// import-anyway terminal. On success it stashes the result for /confirm.
func detectAndResolve() (*detectResult, error) {
	publishRip(&RipProgress{State: "detecting", Message: "Reading disc…", PermissionState: "unknown"})
	var toc *TOC
	if ripFixtureMode {
		t := dryRunTOC
		toc = &t
	} else {
		probe := discOS.probeDrive()
		if probe.TOC == nil {
			// No readable audio CD. Publish the structured drive/disc/permission
			// state and stop. State stays "idle" (not "error") for the expected
			// no-drive / no-disc / permission-denied cases so the panel shows
			// guidance rather than a failure.
			publishRip(&RipProgress{
				State:           "idle",
				Message:         probe.Message,
				DrivePresent:    probe.DrivePresent,
				DiscPresent:     probe.DiscPresent,
				PermissionState: probe.PermissionState,
			})
			return nil, &DiscDetectError{msg: probe.Message}
		}
		toc = probe.TOC
	}
	discID, err := toc.DiscID()
	if err != nil {
		// A genuine TOC-read failure (this stays "error").
		publishRip(&RipProgress{State: "error", Message: "TOC error: " + err.Error(),
			DrivePresent: true, DiscPresent: true, PermissionState: "granted"})
		return nil, err
	}

	// The ladder reads CD-TEXT lazily (only on a rung-1 miss) and returns the
	// CD-TEXT it used, so the happy path stays fast and import-anyway still has
	// titles. A MusicBrainz miss is never an error — the result is always a
	// usable resolution (auto / confirm / import).
	res, profile := resolveDisc(toc, discID, readCDText)
	// JOB 2 — if the winner has no MusicBrainz identity (gnudb), cross-resolve to
	// an MBID so the ripped album earns catalog enrichment. Done before the stash
	// so /confirm and the contribution capture see the attached MBID.
	if res.Release != nil && res.Release.ReleaseMBID == "" {
		crossResolveToMusicBrainz(res.Release, toc)
	}
	// Layer 1/2 — with an MBID now in hand, never keep "Track NN": fill the real
	// tracklist from the MBID so the preview + rip show real names.
	if res.Release != nil {
		if n := ensureRealTitles(res.Release); n > 0 {
			log.Printf("resolve: filled %d real titles from MBID %s", n, res.Release.ReleaseMBID)
		}
		// Self-heal: a confident match (esp. a LEARNED local_memory hit) is re-checked
		// against the PHYSICAL disc before it can silently rip. The remembered release
		// is re-aligned to the disc's own durations — tracks re-expressed in disc order,
		// off-duration tracks flagged, and a structural misfit dropped to "confirm" so
		// the user verifies (and the re-pick re-learns) instead of auto-ripping a wrong
		// pressing. A clean re-alignment stays auto + silent.
		reconcileAutoWithDisc(res, toc, profile.CDText)
	}
	// Capture the default we're about to offer BEFORE any manual search re-orders the
	// candidate list, so was_override reflects the user's pick against our original
	// top suggestion, not against a post-search reshuffle.
	offeredDefaultKey := ""
	if res.Release != nil {
		offeredDefaultKey = candidateKey(res.Release)
	}
	dr := &detectResult{res: res, toc: toc, discID: discID, cdtext: profile.CDText, profile: profile, offeredDefaultKey: offeredDefaultKey}
	pendingResolution.Store(dr)
	// Layer 5 — a confident, titled, MBID-bearing detect is a confirmed identity:
	// persist it now so the NEXT insert resolves from local_memory instantly and
	// fully titled, closing the loop without requiring a rip.
	if res.Release != nil && res.Release.ReleaseMBID != "" && res.Decision() == "auto" && len(res.Candidates) > 0 {
		learnConfirmedIdentity(dr, res.Candidates[0], "detect")
	}
	return dr, nil
}

// publishDetected publishes the preview state for a freshly resolved disc:
// "matched" (auto-select), "confirm" (pick-list), or an unidentified "matched"
// preview (import-anyway). Never "error" — every disc previews as rippable.
func publishDetected(dr *detectResult) {
	var p *RipProgress
	var rel *MatchedRelease
	switch dr.res.Decision() {
	case "auto":
		p = autoMatchProgress(dr.res)
		rel = dr.res.Release
	case "confirm":
		p = confirmProgress(dr.res)
		rel = dr.res.Release
	default: // import
		rel = localRelease(dr.toc, dr.discID, dr.cdtext)
		p = importPreviewProgress(rel)
	}
	p.TOCDurations = tocTrackDurationsMs(dr.toc) // disc durations for the compare view
	markTrackOwnership(p, rel)                   // detect-time "in your library" hint
	publishRip(p)
}

// ownedSet is the local library's membership: per-track (recording-MBID +
// cassette-local-id) for the "which of these tracks are mine?" hints, plus
// album-level (release MBID + normalized albumKey) for the "do I already have THIS
// record?" answer — the latter survives per-track MBID drift on compilations.
type ownedSet struct {
	mbid        map[string]bool
	localID     map[string]bool
	releaseMBID map[string]bool
	albumKey    map[string]bool
}

func (o *ownedSet) has(mbid, localID string) bool {
	return (mbid != "" && o.mbid[mbid]) || (localID != "" && o.localID[localID])
}

// hasAlbum answers whether the user already owns this album as a whole — by its
// release MBID or its normalized album+artist key. Independent of per-track MBID
// matching, so a re-inserted compilation reads as owned even when the library copy
// was ripped from a different pressing.
func (o *ownedSet) hasAlbum(releaseMBID, album, albumArtist string) bool {
	if releaseMBID != "" && o.releaseMBID[releaseMBID] {
		return true
	}
	k := albumKey(album, albumArtist)
	return k != "" && o.albumKey[k]
}

// buildOwnedSet snapshots the local library's track identities in one Subsonic
// fetch. Best-effort: a fetch error yields an empty set (nothing marked owned), so
// the detect card simply shows "Queued" rather than failing.
func buildOwnedSet() *ownedSet {
	o := &ownedSet{
		mbid:        map[string]bool{},
		localID:     map[string]bool{},
		releaseMBID: map[string]bool{},
		albumKey:    map[string]bool{},
	}
	songs, err := fetchAllSubsonicSongs()
	if err != nil {
		log.Printf("owned-check: library fetch failed (marking none owned): %v", err)
		return o
	}
	for i := range songs {
		s := &songs[i]
		if s.MusicBrainzRecordingID != nil && *s.MusicBrainzRecordingID != "" {
			o.mbid[*s.MusicBrainzRecordingID] = true
		}
		if s.CassetteLocalID != "" {
			o.localID[s.CassetteLocalID] = true
		}
		if s.ReleaseMBID != nil && *s.ReleaseMBID != "" {
			o.releaseMBID[*s.ReleaseMBID] = true
		}
		if k := albumTagKey(s); k != "" {
			o.albumKey[k] = true
		}
	}
	return o
}

// markTrackOwnership flags each preview track the user already owns — matched back
// to the release's per-track recording MBID / local id by position — so the detect
// card answers "is this already mine?" the moment the disc comes into view.
func markTrackOwnership(p *RipProgress, rel *MatchedRelease) {
	if p == nil || rel == nil || len(p.Tracks) == 0 {
		return
	}
	applyOwnership(p, rel, buildOwnedSet())
}

// applyOwnership is markTrackOwnership's pure half (no network): flag each preview
// track present in `owned`, matched to the release's per-track identity by position.
func applyOwnership(p *RipProgress, rel *MatchedRelease, owned *ownedSet) {
	byPos := make(map[int]RippedTrackMeta, len(rel.Tracks))
	for _, t := range rel.Tracks {
		byPos[t.Position] = t
	}
	ownedCount := 0
	for i := range p.Tracks {
		t := byPos[p.Tracks[i].Position]
		in := owned.has(t.RecordingMBID, t.LocalID)
		p.Tracks[i].InLibrary = in
		if in {
			ownedCount++
		}
	}
	p.OwnedTrackCount = ownedCount
	// Set-awareness first: has a DIFFERENT disc of this album already been ripped?
	// (Ledger check by disc id, so it never collides with THIS disc.) This is the
	// discriminator a multi-disc set needs.
	otherDisc := otherDiscOfAlbumRipped(rel.DiscID, rel.Album, rel.AlbumArtist)
	p.OtherDiscInLibrary = otherDisc
	// "Already in your library" must be per-DISC, not per-album. True when: this exact
	// disc id was already rip-completed, OR every one of its own tracks is owned, OR
	// the album is owned AND no OTHER disc of the set accounts for that ownership (the
	// single-disc / compilation re-insert — album owned, no sibling). The final clause
	// is why owned.hasAlbum can't stand alone: a multi-disc set shares one album name,
	// so a bare album match made a fresh sibling disc read as already-ripped the moment
	// any disc of the set was ripped — the reported bug. Excluding the sibling case
	// lets the new disc read as the fresh rip it is while a same-disc re-insert (or a
	// truly-owned single disc) still reads as already there.
	p.AlreadyInLibrary = thisDiscRipped(rel.DiscID) ||
		(len(p.Tracks) > 0 && ownedCount == len(p.Tracks)) ||
		(owned.hasAlbum(rel.ReleaseMBID, rel.Album, rel.AlbumArtist) && !otherDisc)
}

// otherDiscOfAlbumRipped reports whether a DIFFERENT physical disc of the same album
// has already been fully ripped — a completed disc-identity record with a different
// disc id but the same normalized album+artist. Immune to the album-name collision
// (it compares disc ids) and to per-track MBID drift (it keys on the rip ledger, not
// track identities). This is the "you're building a set" signal the detect card gates
// its "Disc N of M" on, and the discriminator between a new disc of an owned album and
// a re-insert of a disc you already have.
func otherDiscOfAlbumRipped(thisDiscID, album, albumArtist string) bool {
	want := albumKey(album, albumArtist)
	if want == "" {
		return false
	}
	discMemory.ensureLoaded()
	discMemory.mu.RLock()
	defer discMemory.mu.RUnlock()
	for _, r := range discMemory.all {
		if !r.RipComplete {
			continue // only a fully-ripped disc counts as a sibling in the set
		}
		if r.MBDiscID != "" && r.MBDiscID == thisDiscID {
			continue // the same physical disc, not a sibling
		}
		if albumKey(r.Album, r.AlbumArtist) == want {
			return true
		}
	}
	return false
}

// thisDiscRipped reports whether THIS exact physical disc (by disc id) has already
// been fully ripped — a completed disc-identity record for the SAME disc id. This
// is the per-DISC "already in your library" signal. It's the fix for the multi-disc
// false positive: an album-level match made a fresh sibling disc read as
// already-ripped the moment ANY disc of the set was ripped (both discs share one
// album name). Keying on the disc id keeps re-inserting the same disc as
// "already ripped" while a sibling disc reads as the fresh rip it is.
func thisDiscRipped(thisDiscID string) bool {
	if thisDiscID == "" {
		return false
	}
	discMemory.ensureLoaded()
	discMemory.mu.RLock()
	defer discMemory.mu.RUnlock()
	for _, r := range discMemory.all {
		if r.RipComplete && r.MBDiscID != "" && r.MBDiscID == thisDiscID {
			return true
		}
	}
	return false
}

// siblingMultiDiscRelease returns the MusicBrainz release id that a COMPLETED
// sibling disc of this album resolved to, when that sibling belongs to a
// MULTI-disc release — the anchor for steering THIS disc onto the same release so
// a set shares one release_mbid and consistent disc numbers (BUG-261). Empty when
// no such sibling exists. Keys on album+artist and excludes this exact disc id,
// exactly like otherDiscOfAlbumRipped; additionally requires a stored release id
// and MediumCount > 1, so it only ever fires for a genuine multi-disc set — never
// on a single-disc album. Forward-only by nature: it reads siblings already in the
// ledger, and never reaches back to re-tag one ripped before this disc.
func siblingMultiDiscRelease(thisDiscID, album, albumArtist string) string {
	want := albumKey(album, albumArtist)
	if want == "" {
		return ""
	}
	discMemory.ensureLoaded()
	discMemory.mu.RLock()
	defer discMemory.mu.RUnlock()
	for _, r := range discMemory.all {
		if !r.RipComplete || r.ReleaseMBID == "" || r.MediumCount <= 1 {
			continue // only a completed, multi-disc sibling anchors the set
		}
		if r.MBDiscID != "" && r.MBDiscID == thisDiscID {
			continue // the same physical disc, not a sibling
		}
		if albumKey(r.Album, r.AlbumArtist) == want {
			return r.ReleaseMBID
		}
	}
	return ""
}

// matchedProgress builds the base "matched" snapshot for a release (pending
// tracklist, drive/permission granted). Callers set State/Message/Candidates as
// needed; runRipJob reuses it to seed the ripping snapshot.
func matchedProgress(rel *MatchedRelease, cands []*RipScoredCandidate) *RipProgress {
	p := &RipProgress{
		State: "matched", DiscID: rel.DiscID, ReleaseMBID: rel.ReleaseMBID,
		Album: rel.Album, AlbumArtist: rel.AlbumArtist, Date: rel.Date,
		TrackCount: rel.TrackCount, Message: "Matched. Ready to rip.",
		MediumPos: rel.MediumPos, MediumCount: rel.MediumCount, MediumTitle: rel.MediumTitle,
		DrivePresent: true, DiscPresent: true, PermissionState: "granted",
		Unidentified: rel.Unidentified, NeedsNaming: rel.NeedsNaming,
		Candidates: candidateList(cands),
	}
	for _, t := range rel.Tracks {
		p.Tracks = append(p.Tracks, TrackRipStatus{Position: t.Position, Title: t.Title, State: "pending"})
	}
	return p
}

// autoMatchProgress is the confident "matched" preview (confidence ≥ threshold).
func autoMatchProgress(res *RipResolution) *RipProgress {
	p := matchedProgress(res.Release, res.Candidates)
	p.Confidence = res.Confidence
	switch {
	case len(res.Candidates) > 0 && res.Candidates[0].Source == "local_memory":
		// Rung zero — a disc we've identified before, recognized offline.
		p.Message = "Recognized — you've ripped this disc before. Ready to rip."
	case len(res.Candidates) > 0 && res.Candidates[0].Corroborated:
		// Two or more independent sources agreed (JOB 4).
		p.Message = "Confirmed by multiple sources. Ready to rip."
	case res.Confidence < 1.0:
		p.Message = "Likely match. Ready to rip."
	}
	return p
}

// confirmProgress is the "confirm" state: a short pick-list of candidate
// releases for the user to choose from (or import as unknown).
func confirmProgress(res *RipResolution) *RipProgress {
	p := matchedProgress(res.Release, res.Candidates)
	p.State = "confirm"
	p.Confidence = res.Confidence
	p.Message = "More than one match — pick the right release, or import as unknown."
	return p
}

// importPreviewProgress is the unidentified "matched" preview for the
// no-candidate path: the local identity, rippable as-is.
func importPreviewProgress(local *MatchedRelease) *RipProgress {
	p := matchedProgress(local, nil)
	if local.NeedsNaming {
		p.Message = "Not in the database yet — import as an unknown album."
	} else {
		p.Message = "Not in the database yet — import as is."
	}
	return p
}

// candidateList projects scored candidates into the serializable pick-list.
func candidateList(cands []*RipScoredCandidate) []RipCandidate {
	if len(cands) == 0 {
		return nil
	}
	out := make([]RipCandidate, 0, len(cands))
	for _, c := range cands {
		rc := RipCandidate{
			ID:            candidateKey(c.Release),
			ReleaseMBID:   c.Release.ReleaseMBID,
			Album:         c.Release.Album,
			AlbumArtist:   c.Release.AlbumArtist,
			Date:          c.Release.Date,
			TrackCount:    c.Release.TrackCount,
			MediumPos:     c.Release.MediumPos,
			MediumCount:   c.Release.MediumCount,
			MediumTitle:   c.Release.MediumTitle,
			Confidence:    c.Confidence,
			Source:        c.Source,
			Gaps:          c.Gaps,
			Flagged:       c.Flagged,
			DroppedTitles: c.DroppedReleaseTitles,
		}
		for _, t := range c.Release.Tracks {
			rc.Tracks = append(rc.Tracks, RipCandidateTrack{Position: t.Position, Title: t.Title, LengthMs: t.LengthMs})
		}
		out = append(out, rc)
	}
	return out
}

// ── Rip a whole disc ─────────────────────────────────────────────────────────

// runRipJob rips every track of a matched release, then registers them with the
// library and claims presence ONLY once confirmed. The drive rips serially (one
// drive), while encode+verify+land runs in a concurrent worker so the drive and
// CPU overlap instead of alternating idle (Job 2). Serialized via ripMu; safe to
// call from an HTTP handler goroutine.
func runRipJob(rel *MatchedRelease) {
	if !ripActive.CompareAndSwap(false, true) {
		return // a rip is already running
	}
	defer ripActive.Store(false)
	ripStopRequested.Store(false) // fresh rip — clear any prior stop (J4)
	// Consume the replace flag (Swap-clear) so it applies to THIS rip only.
	force := ripForceReplace.Swap(false)
	ripMu.Lock()
	defer ripMu.Unlock()
	lastRippedRel.Store(rel) // for the "Retry track N" endpoint (A4)

	prog := matchedProgress(rel, nil)
	prog.State = "ripping"
	prog.Message = "Ripping…"
	prog.StartedAt = nowFn()
	publishRip(prog)

	// A new rip supersedes any prior interruption notice, and drops a marker so an
	// interruption of THIS rip (death before finalizeRip clears it) is detectable
	// on the next startup.
	interruptedNotice.Store(nil)
	writeRipMarker(rel)

	destDir := albumDir(rel)
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		progUpdate(prog, func() { prog.State = "error"; prog.Message = "Cannot create album folder: " + err.Error() })
		return
	}
	prog.LandedDir = destDir

	tmp, err := os.MkdirTemp("", "cassette-rip-")
	if err != nil {
		progUpdate(prog, func() { prog.State = "error"; prog.Message = "Cannot create temp dir: " + err.Error() })
		return
	}
	defer os.RemoveAll(tmp)

	// Rip every track, then a single retry pass over any that failed (A2). The
	// completeness gate in finalizeRip then decides done vs incomplete (A3).
	ripTrackSet(prog, rel, allTrackIndices(rel), destDir, tmp, force)
	// J4: a user stop aborts the job cleanly — no retry pass, no register; return
	// to the ready-to-rip view. Already-landed tracks remain on disk (a re-rip
	// resumes past them).
	if ripStopRequested.Load() {
		finalizeStoppedRip(prog, rel)
		return
	}
	retryFailedTracks(prog, rel, destDir, tmp)
	finalizeRip(prog, rel)
}

// finalizeStoppedRip re-shows the seated disc as ready-to-rip after a user Stop
// (J4). It republishes the MATCHED state (not a bare idle) so Cassette doesn't
// forget what disc is in the drive after a stop (founder, 2026-08-16), and marks
// the tracks that already landed so a following rip / the counts stay accurate.
func finalizeStoppedRip(prog *RipProgress, rel *MatchedRelease) {
	done := countTracksInState(prog, "done")
	log.Printf("rip: STOPPED by user after %d/%d track(s)", done, prog.TrackCount)
	p := matchedProgress(rel, nil)
	p.Message = "Rip stopped. Ready to rip again."
	p.LandedDir = prog.LandedDir
	for i := range rel.Tracks {
		if fileNonEmpty(landedPath(prog.LandedDir, rel, rel.Tracks[i])) {
			setTrack(p, i, "done", 0, "")
		}
	}
	p.CompletedTracks = countTracksInState(p, "done")
	publishRip(p)
}

// ripTrackSet runs the serial-ripper → concurrent-encode-worker pipeline over the
// given track indices (into rel.Tracks / prog.Tracks). The encode+verify+tag+land
// of track N overlaps the drive reading track N+1. Resume-aware: a track whose
// FLAC already landed is marked done and skipped — so a retry never re-reads a
// landed track. Every per-track failure (read OR encode/tag/land) is LOGGED and
// left in State="error" for the retry pass + completeness gate to find (A1).
func ripTrackSet(prog *RipProgress, rel *MatchedRelease, indices []int, destDir, tmp string, force bool) {
	type encodeJob struct {
		idx int
		wav string
		tr  RippedTrackMeta
	}
	jobs := make(chan encodeJob, len(indices))
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for j := range jobs {
			progUpdate(prog, func() { setTrack(prog, j.idx, "encoding", -1, "") })
			if _, err := encodeTagLand(j.wav, rel, j.tr, destDir); err != nil {
				log.Printf("rip: encode/tag/land FAILED — track %d %q: %v", j.tr.Position, j.tr.Title, err)
				progUpdate(prog, func() { setTrack(prog, j.idx, "error", -1, err.Error()) })
				continue
			}
			progUpdate(prog, func() { setTrack(prog, j.idx, "done", -1, "") })
		}
	}()

	// On an enhanced CD, the last audio track's read must stop at the audio lead-out
	// or cd-paranoia locks up over-reading the inter-session gap. Resolved once per set.
	boundPos, boundFrames := discOS.enhancedLastTrackBound()

	for _, i := range indices {
		// J4: a user stop halts further disc reads; in-flight encodes drain below.
		if ripStopRequested.Load() {
			break
		}
		tr := rel.Tracks[i]

		// Cheap partial-resume: a prior pass that already landed this track is not
		// re-read from the disc — UNLESS this is a forced replace (re-read every
		// track and overwrite, encodeTagLand's temp+verify+rename keeps the old
		// file until the new one verifies).
		if final := landedPath(destDir, rel, tr); !force && fileNonEmpty(final) {
			progUpdate(prog, func() { setTrack(prog, i, "done", 0, "") })
			continue
		}

		progUpdate(prog, func() { setTrack(prog, i, "ripping", 0, "") })
		wav := filepath.Join(tmp, fmt.Sprintf("track%02d.wav", tr.Position))
		maxFrames := 0
		if boundPos > 0 && tr.Position == boundPos {
			maxFrames = boundFrames
		}
		attempts, err := discOS.ripTrackToWAV(tr.Position, maxFrames, wav)
		if err != nil {
			// cd-paranoia couldn't read it — usually a drive hang on a region the OS
			// returns fine (the iTunes / macOS CDDA path). Fall back to that file.
			if fbErr := discOS.ripTrackFallbackToWAV(tr.Position, wav); fbErr != nil {
				log.Printf("rip: track %d %q FAILED — cd-paranoia: %v; CDDA fallback: %v", tr.Position, tr.Title, err, fbErr)
				progUpdate(prog, func() { setTrack(prog, i, "error", attempts, err.Error()) })
				continue
			}
			log.Printf("rip: track %d %q recovered via macOS CDDA after cd-paranoia hang (%v)", tr.Position, tr.Title, err)
		}
		progUpdate(prog, func() { prog.Tracks[i].Attempts = attempts })
		jobs <- encodeJob{idx: i, wav: wav, tr: tr}
	}
	close(jobs)
	wg.Wait()
}

// retryFailedTracks runs up to ripMaxRetryPasses end-of-rip passes over ONLY the
// tracks still in error (A2). Long final-track / leadout reads sometimes succeed
// on a fresh pass, so a brief settle precedes each. Capped — a genuinely
// unreadable track then falls to the incomplete gate rather than looping forever.
func retryFailedTracks(prog *RipProgress, rel *MatchedRelease, destDir, tmp string) {
	for pass := 1; pass <= ripMaxRetryPasses; pass++ {
		errIdx := trackIndicesInState(prog, "error")
		if len(errIdx) == 0 {
			return
		}
		log.Printf("rip: retry pass %d/%d over %d failed track(s): %v",
			pass, ripMaxRetryPasses, len(errIdx), trackPositions(rel, errIdx))
		time.Sleep(ripRetrySettle)
		ripTrackSet(prog, rel, errIdx, destDir, tmp, false)
	}
}

// finalizeRip recomputes the authoritative completed count from the per-track
// states (robust against the two-pass double-count), fetches cover art, registers
// with the library, persists the completeness record (A5), then applies the
// COMPLETENESS GATE (A3): a partial rip becomes "incomplete", never "done".
func finalizeRip(prog *RipProgress, rel *MatchedRelease) {
	progUpdate(prog, func() { prog.CompletedTracks = countTracksInState(prog, "done") })
	destDir := prog.LandedDir

	// Fast Album Art, pre-scan: the folder cover goes in before the Navidrome scan
	// so the scan indexes cover.jpg as the album's original art. Every step writes
	// only into a folder with no cover (a re-rip into a folder the person already
	// gave a cover keeps it).
	//
	// 1. Art EMBEDDED in the files (free, local, exact; needs no registration).
	if wrote, coverErr := materializeEmbeddedCover(destDir); coverErr != nil {
		log.Printf("rip: cover materialization failed for %q: %v", destDir, coverErr)
	} else if wrote {
		log.Printf("rip: materialized folder cover for %q", rel.Album)
	}
	// 2. The disc's OWN cover, the one the rip panel showed (BUG-919): asked by the
	//    disc's release and name, the way the panel asks, else the disc's release
	//    from the Cover Art Archive. It used to come only after registration, as the
	//    cover of whichever album the cloud MATCHED the rip to, so a wrong match (a
	//    greatest-hits disc filed as a bigger compilation) wrote that album's cover
	//    into the person's folder. Now the match is only the fallback below.
	triedRelease := false
	if !hasFolderCover(destDir) {
		data, mime, ok, tried := discOwnCover(rel)
		triedRelease = tried
		if ok {
			if wrote, err := writeFolderCover(destDir, data, mime); err != nil {
				log.Printf("rip: disc cover write failed for %q: %v", rel.Album, err)
			} else if wrote {
				log.Printf("rip: wrote the disc's own cover for %q", rel.Album)
			}
		}
	}

	progUpdate(prog, func() { prog.State = "registering"; prog.Message = "Ripped. Adding to your library…" })
	registered := registerRippedAlbum(prog, rel)

	// 3. Fallback AFTER registration, only when the disc's own cover wasn't found:
	// the album is now in the user's library, so the catalog cover of the album it
	// was matched to can resolve. coverForceRecheck is REQUIRED — the 24h negative
	// cache would otherwise silently skip this lookup for a dir checked before.
	// Catalog claims first; only if it still misses do we reach CAA + the GUARDED
	// iTunes last resort (which refuses any cover whose album+artist don't match,
	// so a wrong cover can't be written — a placeholder beats a confident wrong one),
	// unless step 2 already asked them.
	if !hasFolderCover(destDir) {
		coverForceRecheck(destDir)
		if wrote, coverErr := materializeCoverForAlbumDir(destDir); coverErr != nil {
			log.Printf("rip: post-registration cover materialization failed for %q: %v", destDir, coverErr)
		} else if wrote {
			log.Printf("rip: materialized catalog folder cover for %q", rel.Album)
		}
	}
	if !hasFolderCover(destDir) && !triedRelease {
		if data, mime, ok := fetchReleaseCover(rel); ok {
			if wrote, err := writeFolderCover(destDir, data, mime); err != nil {
				log.Printf("rip: cover fetch write failed for %q: %v", rel.Album, err)
			} else if wrote {
				log.Printf("rip: fetched folder cover for %q", rel.Album)
			}
		}
	}

	// A5: persist the completeness record (local file + cloud) — the source of
	// truth the library uses to tell a rip failure from a user deletion.
	writeCompletenessRecord(prog, rel, registered)

	complete := false
	progUpdate(prog, func() {
		prog.Registered = registered
		switch {
		case prog.CompletedTracks == 0:
			prog.State = "error"
			prog.Message = "Rip failed — no tracks were saved."
		case prog.CompletedTracks < prog.TrackCount:
			// A3 — completeness gate: a partial rip is NEVER "done".
			prog.State = "incomplete"
			prog.Message = incompleteMessage(prog)
		case registered && prog.Unidentified:
			prog.State = "done"
			prog.Message = fmt.Sprintf("Imported as unknown — %d/%d tracks. Name it any time.", prog.CompletedTracks, prog.TrackCount)
			complete = true
		case registered:
			prog.State = "done"
			prog.Message = fmt.Sprintf("In your library — %d/%d tracks.", prog.CompletedTracks, prog.TrackCount)
			complete = true
		default:
			prog.State = "done"
			prog.Message = "Ripped to your Mac. It'll appear in your library shortly."
			complete = true
		}
	})

	// Phase-2 consensus gate: this disc's identity counts toward the SHARED pool
	// only once a full rip exists. Every track landed (the "done" cases above), so
	// stamp the local record; the next library-sync reports rip_complete=true. A
	// partial/failed rip leaves it false → held out of consensus until a clean rip.
	if complete {
		markRipComplete(rel.DiscID)
	}

	// The rip reached a terminal state (done/incomplete/error) — clear the marker
	// so only a genuine interruption (death before this point) leaves one behind.
	clearRipMarker()
}

// ── Track-set helpers ────────────────────────────────────────────────────────

func allTrackIndices(rel *MatchedRelease) []int {
	idx := make([]int, len(rel.Tracks))
	for i := range rel.Tracks {
		idx[i] = i
	}
	return idx
}

func trackIndicesInState(prog *RipProgress, state string) []int {
	var out []int
	for i := range prog.Tracks {
		if prog.Tracks[i].State == state {
			out = append(out, i)
		}
	}
	return out
}

func countTracksInState(prog *RipProgress, state string) int {
	n := 0
	for i := range prog.Tracks {
		if prog.Tracks[i].State == state {
			n++
		}
	}
	return n
}

func trackPositions(rel *MatchedRelease, indices []int) []int {
	out := make([]int, 0, len(indices))
	for _, i := range indices {
		if i >= 0 && i < len(rel.Tracks) {
			out = append(out, rel.Tracks[i].Position)
		}
	}
	return out
}

// missingTracks are the tracks that did NOT land (state != "done").
func missingTracks(prog *RipProgress) []TrackRipStatus {
	var out []TrackRipStatus
	for _, t := range prog.Tracks {
		if t.State != "done" {
			out = append(out, t)
		}
	}
	return out
}

// incompleteMessage names what's missing, e.g.
// "Ripped 11 of 12 — track 12 (Arch Drive Goodbye) couldn't be read."
func incompleteMessage(prog *RipProgress) string {
	missing := missingTracks(prog)
	base := fmt.Sprintf("Ripped %d of %d", prog.CompletedTracks, prog.TrackCount)
	if len(missing) == 1 {
		m := missing[0]
		if m.Title != "" {
			return fmt.Sprintf("%s — track %d (%s) couldn't be read.", base, m.Position, m.Title)
		}
		return fmt.Sprintf("%s — track %d couldn't be read.", base, m.Position)
	}
	parts := make([]string, 0, len(missing))
	for _, m := range missing {
		parts = append(parts, strconv.Itoa(m.Position))
	}
	return fmt.Sprintf("%s — tracks %s couldn't be read.", base, strings.Join(parts, ", "))
}

// registerRippedAlbum drives the real chain to completion: trigger a Navidrome
// scan, wait until THIS album is actually indexed, then push it to the cloud with
// a library-sync (bypassing the 1-hour heartbeat gate). Returns true only when the
// tracks are confirmed indexed AND the sync succeeded — i.e. they are now in
// user_library_index, not merely ripped to disk.
//
// The load-bearing rule (BUG-108): NEVER run a gate-stamping full sync while the
// album is still missing from the index. Such a push carries everything EXCEPT the
// just-ripped album and then advances LastLibrarySyncAt, blocking the heartbeat
// retry for a full hour — the exact stranding this guards against. So we only sync
// once the album is confirmed present; if the (fast) synchronous wait doesn't see
// it, we hand off to a background converger that keeps nudging the ungated ingest
// until it lands, converging in minutes rather than an hour.
func registerRippedAlbum(prog *RipProgress, rel *MatchedRelease) bool {
	if prog.CompletedTracks == 0 {
		return false
	}
	if liveState == nil || liveState.BearerToken == "" {
		log.Printf("rip: not paired — skipping immediate library registration")
		return false
	}
	if err := triggerNavidromeScan(); err != nil {
		log.Printf("rip: scan trigger failed: %v", err)
	}
	// Wait for the album itself, not a blind fixed delay: the quick scan of one new
	// folder normally shows up in seconds.
	if waitForAlbumIndexed(rel.Album, prog.CompletedTracks, ripRegisterSyncBudget) {
		if _, err := runLibrarySync(liveState, "full"); err != nil {
			log.Printf("rip: immediate library-sync failed (converging in background): %v", err)
		} else {
			// Indexed AND pushed — the album is now in the cloud library.
			return true
		}
	}
	log.Printf("rip: %q not yet indexed; converging in the background", rel.Album)
	go convergeRippedAlbum(rel.Album, prog.CompletedTracks)
	return false
}

// convergeRippedAlbum is the background safety net for a rip whose scan hadn't
// finished by the time finalizeRip pushed. It nudges the UNGATED ingest (ingestNow:
// scan-to-idle, then full sync) and re-checks until this album is indexed — so a
// slow/large-library scan converges within ripConvergeBackoff instead of waiting on
// the 1-hour heartbeat gate. Bounded: if it still hasn't landed, the heartbeat
// backstop remains the final catch. Runs in its own goroutine; uses real time.
func convergeRippedAlbum(album string, want int) {
	for _, wait := range ripConvergeBackoff {
		// Escalate to a FULL scan rather than the quick ingest: a replace-rip, or a
		// rip whose scan was interrupted, leaves a folder a quick scan skips (its
		// mtime predates Navidrome's last-scan marker), so quick nudges never land
		// it. A full re-read does. See runFullRescanPass.
		runFullRescanPass(liveState)
		if countIndexedAlbumTracks(album) >= want {
			log.Printf("rip: %q converged into the cloud library", album)
			return
		}
		time.Sleep(wait)
	}
	log.Printf("rip: %q still not converged; the next-launch reconcile will retry", album)
}

// waitForAlbumIndexed polls Subsonic search3 until at least `want` tracks of the
// album are indexed by Navidrome, or timeout. This is how we confirm the scan
// actually ingested the rip before claiming library presence.
func waitForAlbumIndexed(album string, want int, timeout time.Duration) bool {
	if want <= 0 || album == "" {
		return true
	}
	deadline := nowFn().Add(timeout)
	for {
		if countIndexedAlbumTracks(album) >= want {
			return true
		}
		if nowFn().After(deadline) {
			return false
		}
		time.Sleep(3 * time.Second)
	}
}

// setTrack mutates one track's progress in place. Pass attempts < 0 to leave
// the existing attempt count untouched (e.g. the encode worker shouldn't reset
// the ripper's count). Pure mutation — callers wrap it in progUpdate to publish.
func setTrack(p *RipProgress, i int, state string, attempts int, errMsg string) {
	if i < 0 || i >= len(p.Tracks) {
		return
	}
	p.Tracks[i].State = state
	if attempts >= 0 {
		p.Tracks[i].Attempts = attempts
	}
	p.Tracks[i].Error = errMsg
}

// ── Per-track steps ──────────────────────────────────────────────────────────

// findCDDATrackFile returns the macOS-mounted CDDA track file for a track
// position (e.g. "/Volumes/<disc>/11 Title.aiff"), or "" if the disc isn't
// mounted with track files. macOS exposes audio-CD tracks as readable .aiff via
// its native CDDA filesystem — the path iTunes reads — which does NOT hang on the
// regions cd-paranoia's direct drive commands choke on. (A clean disc whose last
// track has a silent / ghost-track tail is the classic case: cd-paranoia reads
// the song, then stalls forever trying to push into the trailing region.)
// The raw track read (cd-paranoia), the macOS CDDA fallback (afconvert/dd/ffmpeg on
// the auto-mounted /Volumes .aiff), the enhanced-CD last-track bound, and the
// cd-paranoia MSF span helper are all OS-specific and live behind the disc platform
// seam in rip_platform_darwin.go. The orchestration below calls discOS.ripTrackToWAV
// / discOS.ripTrackFallbackToWAV / discOS.enhancedLastTrackBound.

// flacThreads is how many encode threads to hand flac (1.5.0+ supports
// --threads). Bounded so one concurrent encode worker uses the box's cores
// without going overboard; flac clamps to its own max internally.
func flacThreads() int {
	n := runtime.NumCPU()
	if n < 1 {
		n = 1
	}
	if n > 8 {
		n = 8
	}
	return n
}

// encodeTagLand encodes a WAV to FLAC, verifies integrity, writes the full tag
// set, and moves it into the album folder. Lossless throughout — only the
// compression LEVEL changed (8 → 5): identical decoded samples, much less CPU/
// heat. flac is run multithreaded; this whole function runs in the encode worker
// (off the rip critical path), so the verify pass no longer serializes the next
// track. Returns the final landed path.
func encodeTagLand(wav string, rel *MatchedRelease, tr RippedTrackMeta, destDir string) (string, error) {
	flacTmp := strings.TrimSuffix(wav, ".wav") + ".flac"

	// encode: level 5 (lossless), multithreaded, overwrite, silent
	if out, err := exec.Command(flacBin, "-5", "-j", fmt.Sprintf("%d", flacThreads()),
		"-s", "-f", "-o", flacTmp, wav).CombinedOutput(); err != nil {
		return "", fmt.Errorf("flac encode: %v: %.200s", err, out)
	}
	// verify integrity (still done — it's the brand promise; just no longer on
	// the rip critical path)
	if out, err := exec.Command(flacBin, "-t", "-s", flacTmp).CombinedOutput(); err != nil {
		return "", fmt.Errorf("flac verify: %v: %.200s", err, out)
	}
	// full tags
	if err := writeRipTags(flacTmp, rel, tr); err != nil {
		return "", fmt.Errorf("tag: %w", err)
	}
	// land
	final := landedPath(destDir, rel, tr)
	if err := moveFile(flacTmp, final); err != nil {
		return "", fmt.Errorf("land: %w", err)
	}
	return final, nil
}

// landedPath is the final on-disk path for a ripped track. Shared by the landing
// step, the partial-resume skip check, and repair so they agree EXACTLY (any
// mismatch re-reads or duplicates a track), which is why the disc-prefix branch
// lives here and nowhere else.
//
// A multi-disc set shares one album folder (both discs carry the same album name),
// so a bare "%02d - title" collides across discs — every disc numbers 01.. So when
// the matched release has more than one disc, prefix the disc number: "1-01 - …",
// "2-01 - …". Single-disc rips keep the original scheme unchanged (BUG-261).
func landedPath(destDir string, rel *MatchedRelease, tr RippedTrackMeta) string {
	if rel != nil && rel.MediumCount > 1 {
		return filepath.Join(destDir, fmt.Sprintf("%d-%02d - %s.flac",
			max(rel.MediumPos, 1), tr.Position, sanitizeFilename(tr.Title)))
	}
	return filepath.Join(destDir, fmt.Sprintf("%02d - %s.flac", tr.Position, sanitizeFilename(tr.Title)))
}

// ── Helpers ──────────────────────────────────────────────────────────────────

func albumDir(rel *MatchedRelease) string {
	artist := folderName(rel.AlbumArtist)
	if artist == "" {
		artist = "Unknown Artist"
	}
	album := folderName(rel.Album)
	if album == "" {
		album = "Unknown Album"
	}
	return filepath.Join(sidecarMusicDir, artist, album)
}

var filenameBadChars = strings.NewReplacer("/", "-", "\\", "-", ":", "-", "*", "-",
	"?", "", "\"", "'", "<", "(", ">", ")", "|", "-")

func sanitizeFilename(s string) string {
	s = stripControlChars(strings.TrimSpace(s))
	s = filenameBadChars.Replace(s)
	return strings.Trim(s, ". ")
}

// folderName is sanitizeFilename for an artist or album folder. On Windows it also steers clear of the
// names Windows keeps for devices (BUG-245): a folder called CON, NUL or COM1 can't be made there, so an
// album by "Con" would never land. The rip and the Trash's path from a song's names both go through it, so
// they agree. macOS and Linux keep the name as it is, so the folders already ripped there stay put.
func folderName(s string) string {
	s = sanitizeFilename(s)
	if guardWindowsNames {
		s = avoidWindowsDeviceName(s)
	}
	return s
}

var guardWindowsNames = runtime.GOOS == "windows"

// avoidWindowsDeviceName adds "_" to a name Windows keeps for a device (CON, PRN, AUX, NUL, CONIN$,
// CONOUT$, COM0-9, LPT0-9, COM and LPT with a superscript 1-3), in any case and with or without an
// extension, which Windows ignores: "Nul.Live" is NUL too, so the mark goes before the first dot.
func avoidWindowsDeviceName(name string) string {
	stem, rest := name, ""
	if i := strings.IndexByte(name, '.'); i >= 0 {
		stem, rest = name[:i], name[i:]
	}
	if !isWindowsDeviceName(strings.TrimRight(stem, " ")) {
		return name
	}
	return strings.TrimRight(stem, " ") + "_" + rest
}

func isWindowsDeviceName(stem string) bool {
	u := strings.ToUpper(stem)
	switch u {
	case "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$":
		return true
	}
	r := []rune(u)
	if len(r) != 4 || (string(r[:3]) != "COM" && string(r[:3]) != "LPT") {
		return false
	}
	return (r[3] >= '0' && r[3] <= '9') || r[3] == '¹' || r[3] == '²' || r[3] == '³'
}

// stripControlChars removes every C0 control character (0x00-0x1F) and DEL
// (0x7F) - illegal in a POSIX path (NUL in particular) and unsafe/invisible
// garbage in a filename regardless of OS. BUG-252: filenameBadChars never
// touched these. The realistic vector isn't CD-TEXT (a text pipe through
// cd-info); it's a MusicBrainz release/track title decoded straight from
// encoding/json, which happily turns a NUL Unicode escape sequence in a
// JSON string into a literal NUL byte - which then reached
// os.MkdirAll/os.Rename and failed the whole track's encode/tag/land step
// instead of landing a clean, safe name.
func stripControlChars(s string) string {
	return strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7F {
			return -1
		}
		return r
	}, s)
}

// moveFile renames, falling back to copy+remove across filesystems (the temp
// dir and the music folder are usually on different volumes).
func moveFile(src, dst string) error {
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	if err := atomicWriteFile(dst, data, 0o644); err != nil {
		return err
	}
	return os.Remove(src)
}

// ── HTTP handlers (wired into the :5173 mux in Chunk 4) ───────────────────────

func handleRipPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprint(w, ripHTML)
}

const ripHTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cassette Player — Rip a CD</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,-apple-system,sans-serif;background:#0a0a0a;color:#ededed;min-height:100vh;padding:2rem;line-height:1.5}
  .wrap{max-width:640px;margin:0 auto}
  h1{font-size:2rem;letter-spacing:-.02em;margin-bottom:.25rem}
  .sub{color:#888;font-size:.9rem;margin-bottom:1.5rem}
  .panel{background:#141414;border:1px solid #222;border-radius:8px;padding:1.25rem 1.5rem;margin-bottom:1rem}
  .album{font-size:1.3rem;font-weight:600}
  .albummeta{color:#999;font-size:.9rem;margin-bottom:.25rem}
  button{font:inherit;font-weight:600;color:#fff;background:#e8500a;border:0;border-radius:6px;padding:.6rem 1.4rem;cursor:pointer;margin-top:.5rem}
  button:disabled{opacity:.4;cursor:default}
  .msg{color:#bbb;font-size:.9rem;margin-top:.75rem;min-height:1.2em}
  .trk{display:flex;justify-content:space-between;padding:.3rem 0;border-bottom:1px solid #1a1a1a;font-size:.92rem}
  .trk:last-child{border-bottom:none}
  .trk .t{color:#ddd} .trk .s{font-variant-numeric:tabular-nums}
  .pending{color:#666}.ripping,.encoding{color:#e8a00a}.done{color:#3ec46d}.error{color:#e0524e}
  .bar{background:#1a1a1a;height:8px;border-radius:4px;overflow:hidden;margin:.75rem 0}
  .bar>span{display:block;height:100%;background:#e8500a;transition:width .3s}
  .note{color:#555;font-size:.78rem;margin-top:1.5rem}
  .cand{color:#777;font-size:.8rem;margin-top:.5rem}
</style></head>
<body><div class="wrap">
  <h1>Rip a CD</h1>
  <p class="sub">Insert an audio CD, then Detect &amp; Rip. Tracks land tagged in your library.</p>
  <div class="panel" id="card">
    <div id="idle">
      <div class="msg" id="idlemsg">No disc detected yet.</div>
      <button id="detectBtn" onclick="detect()">Detect disc</button>
    </div>
    <div id="match" style="display:none">
      <div class="album" id="mAlbum"></div>
      <div class="albummeta" id="mMeta"></div>
      <div class="bar"><span id="barfill" style="width:0%"></span></div>
      <div id="tracks"></div>
      <div class="cand" id="cands"></div>
      <button id="ripBtn" onclick="rip()">Rip to library</button>
      <div class="msg" id="msg"></div>
    </div>
  </div>
  <p class="note">Local-only, bound to 127.0.0.1. Polls /api/rip/status.json.</p>
</div>
<script>
async function detect(){document.getElementById('detectBtn').disabled=true;await fetch('/api/rip/detect',{method:'POST'});}
async function rip(){document.getElementById('ripBtn').disabled=true;await fetch('/api/rip/start',{method:'POST'});}
async function confirmRel(mbid){await fetch('/api/rip/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({releaseMbid:mbid})});}
async function importUnknown(){await fetch('/api/rip/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({importUnknown:true})});}
function esc(s){return (s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function candLabel(c){return esc((c.albumArtist||'Unknown')+' — '+(c.album||'Unknown')+(c.date?(' ('+esc(c.date).slice(0,4)+')'):'')+' · '+(c.trackCount||0)+' tracks');}
async function poll(){
  let d; try{d=await (await fetch('/api/rip/status.json',{cache:'no-store'})).json();}catch(e){return;}
  const idle=document.getElementById('idle'), match=document.getElementById('match');
  if(d.state==='idle'||d.state==='detecting'){
    idle.style.display='';match.style.display='none';
    document.getElementById('idlemsg').textContent=d.message||'No disc detected yet.';
    document.getElementById('detectBtn').disabled=(d.state==='detecting');
  }else{
    idle.style.display='none';match.style.display='';
    document.getElementById('mAlbum').textContent=d.album||'(unknown album)';
    document.getElementById('mMeta').textContent=[d.albumArtist,d.date,(d.trackCount||0)+' tracks'].filter(Boolean).join(' · ');
    const tr=d.tracks||[];
    document.getElementById('tracks').innerHTML=tr.map(t=>
      '<div class="trk"><span class="t">'+String(t.position).padStart(2,'0')+'. '+esc(t.title)+'</span>'+
      '<span class="s '+t.state+'">'+t.state+(t.error?': '+esc(t.error):'')+'</span></div>').join('');
    const done=tr.filter(t=>t.state==='done').length;
    document.getElementById('barfill').style.width=(d.trackCount?Math.floor(done*100/d.trackCount):0)+'%';
    const cands=d.candidates||[];
    const candEl=document.getElementById('cands'), ripBtn=document.getElementById('ripBtn');
    if(d.state==='confirm'){
      // Pick-list: one button per candidate, plus an import-as-unknown escape.
      candEl.innerHTML=cands.map(c=>'<button onclick="confirmRel(\''+esc(c.releaseMbid)+'\')">'+candLabel(c)+'</button>').join('')+
        '<button onclick="importUnknown()">None of these — import as unknown</button>';
      ripBtn.style.display='none';
    }else{
      ripBtn.style.display='';
      candEl.innerHTML=(cands.length>1)?('other matches: '+cands.slice(1).map(candLabel).join(' | ')):'';
    }
    document.getElementById('msg').textContent=d.message||'';
    ripBtn.disabled=(d.state==='ripping');
    ripBtn.textContent=(d.state==='done')?'Done':(d.unidentified?'Import as unknown':'Rip to library');
  }
}
setInterval(poll,1500);poll();
</script>
</body></html>`

func handleRipStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	// Merge the app-level cert warning (independent of the rip state) onto a
	// copy of the current snapshot so it rides along on every status poll.
	p := *loadRip()
	// PRESENCE is taken from macOS, not a stale snapshot or a flaky cd-paranoia read,
	// so the disc (and the eject control) stay shown on every poll. Disk Arbitration
	// is the fast signal; IOKit is the fallback that SURVIVES A SPIN-DOWN — DA tracks
	// mountable volumes and loses a wound-down audio CD, but IOCDMedia persists until
	// the disc is physically ejected. An IOKit-only hit self-heals the DA truth so the
	// eject control (which needs the BSD device) keeps working.
	if d := daDisc.Load(); d != nil && d.present {
		p.DrivePresent = true
		p.DiscPresent = true
	} else if present, bsd := opticalMediaPresentCached(); present {
		p.DrivePresent = true
		p.DiscPresent = true
		daDisc.Store(&discTruth{present: true, bsdName: bsd})
	}
	if n := interruptedNotice.Load(); n != nil {
		p.InterruptedRip = n // a prior rip didn't finish — surface it on every poll
	}
	p.Version = buildVersion // build stamp on every poll, independent of rip state
	p.AcoustIDAvailable = acoustidEnabled()
	p.HubOS = runtime.GOOS
	// Ride the J1 ingest progress along on the rip-status poll (the browser
	// already polls THIS endpoint via useRipStatus), so the dashboard can show a
	// live "Adding [album] — N tracks · M identified" panel during a drop/ingest.
	// Embedding keeps every RipProgress field at the top level and adds `ingest`
	// alongside; it does NOT alter /status.json (which carries its own ingest).
	_ = json.NewEncoder(w).Encode(struct {
		*RipProgress
		Ingest ingestProgress `json:"ingest"`
	}{RipProgress: &p, Ingest: ingestSnapshot()})
}

func handleRipDetect(w http.ResponseWriter, r *http.Request) {
	applyDiscTruthFrom(r) // native watcher carries the DA disc identity here
	go func() {
		dr, err := detectAndResolve()
		if err != nil {
			return // detectAndResolve already published the structured failure state
		}
		// BUG-277: the audio scan is NEVER run automatically here. Silently spinning
		// the drive to fingerprint an unidentified disc reads as the app taking over
		// without asking (founder, 2026-08-20). Identification-by-audio is offered as
		// a "figure it out" link on the Unknown card instead — it runs only when the
		// user taps it (handleRipAcoustID).
		publishDetected(dr)
	}()
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"ok":true}`))
}

// handleRipReset clears rip state to "no disc" — called by the native app's Disk
// Arbitration watcher when the disc (or drive) disappears, and by the web "start
// over" buttons (which send no body). It is a no-op while a rip is active so a
// mid-rip blip can't wipe progress.
//
// SPIN-DOWN GUARD: a DA "disappeared" is NOT proof the disc left. The watcher
// also fires when the drive winds down and the AudioCD volume unmounts, while the
// media is still physically loaded. So before believing it, we cross-check IOKit
// (IOCDMedia survives spin-down). If the media is still there, we re-affirm
// presence and keep the current screen — nothing vanishes on a spin-down.
func handleRipReset(w http.ResponseWriter, r *http.Request) {
	body := parseDiscTruthBody(r) // DA "disappeared" → present:false; web buttons → nil
	go func() {
		if ripActive.Load() {
			return // don't clobber an in-flight rip
		}
		if body != nil && !*body.Present {
			if present, bsd := discOS.opticalMediaPresent(); present {
				// Spin-down / unmount, not a removal: the disc is still in the drive.
				// Re-affirm DA truth from IOKit and leave the current state intact.
				daDisc.Store(&discTruth{present: true, bsdName: firstNonEmpty(body.BsdName, bsd)})
				log.Println("rip-reset: Disk Arbitration reported the disc gone, but IOKit still has the media — treating as spin-down, keeping it")
				return
			}
			daDisc.Store(nil) // IOKit agrees it's gone → a genuine eject
		}
		if ripFixtureMode {
			publishRip(&RipProgress{State: "idle", Message: "Insert an audio CD to rip.",
				DrivePresent: true, DiscPresent: false, PermissionState: "granted"})
			return
		}
		probe := discOS.probeDrive() // disc gone → DiscPresent=false (IOKit-backed)
		publishRip(&RipProgress{
			State:           "idle",
			Message:         probe.Message,
			DrivePresent:    probe.DrivePresent,
			DiscPresent:     probe.DiscPresent,
			PermissionState: probe.PermissionState,
		})
	}()
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"ok":true}`))
}

func handleRipStart(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	// {replace:true} forces a full re-read (overwrite a bad rip) instead of the
	// default resume (fill only missing tracks). Empty body → replace=false.
	var startReq struct {
		Replace bool `json:"replace"`
	}
	_ = json.NewDecoder(r.Body).Decode(&startReq)
	// Job 5: a rip already in flight → don't re-read the disc or spawn a second
	// job; tell the panel so it shows "already ripping" instead of a silent ok.
	// runRipJob's CompareAndSwap is the true guard against a start that slips
	// past this check; this is the fast path for the common click-while-ripping.
	if ripActive.Load() {
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok": false, "alreadyRipping": true, "error": "A rip is already in progress.",
		})
		return
	}
	// Set the replace flag only past the already-ripping guard, so a rejected
	// click never leaks a forced replace into the next rip. runRipJob consumes it.
	ripForceReplace.Store(startReq.Replace)
	dr, err := detectAndResolve()
	if err != nil {
		// Genuine hardware/permission/TOC failure only — detectAndResolve already
		// published the structured state. A MusicBrainz miss never lands here.
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	// JOB 2 — decision logic. Every branch ends in a rip or a confirm; none is a
	// dead end. The audio rip (runRipJob) does no network identification.
	switch dr.res.Decision() {
	case "auto":
		// JOB 5: a confident auto-match (≥ threshold) banks a candidate
		// contribution before ripping. Local-only; never gates the rip.
		captureMatchContribution(dr, dr.res.Release, winningSource(dr.res), dr.res.Confidence)
		// J1: an auto-match is a confirmed identity too — back-resolve + persist the
		// disc-identity record so the next insert resolves from local_memory. (This
		// was the dead write: only the gray-band confirm path persisted before.)
		if len(dr.res.Candidates) > 0 {
			learnConfirmedIdentity(dr, dr.res.Candidates[0], "auto")
		}
		go runRipJob(dr.res.Release)
		_, _ = w.Write([]byte(`{"ok":true}`))
	case "confirm":
		// Ambiguous — surface the pick-list and wait for /api/rip/confirm.
		publishRip(confirmProgress(dr.res))
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "needsConfirm": true})
	default: // import-anyway: rip with a local identity, no match required.
		go runRipJob(localRelease(dr.toc, dr.discID, dr.cdtext))
		_, _ = w.Write([]byte(`{"ok":true}`))
	}
}

// handleRipConfirm rips the release the user picked from the "confirm" pick-list
// (POST {releaseMbid}), or imports the disc as unknown (POST {importUnknown:true}
// — the "None of these" action). It maps the chosen MBID back to the full
// tracklist from the stashed resolution, so it neither re-reads the disc nor
// re-hits MusicBrainz. An unrecognized id never dead-ends — it falls through to
// import-anyway.
func handleRipConfirm(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if ripActive.Load() {
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok": false, "alreadyRipping": true, "error": "A rip is already in progress.",
		})
		return
	}

	var req struct {
		CandidateID   string `json:"candidateId"`
		ReleaseMBID   string `json:"releaseMbid"` // back-compat; prefer candidateId
		ImportUnknown bool   `json:"importUnknown"`
		// TrackNames are user-supplied names for the picked candidate's GAP tracks
		// (the name-first flow), keyed by disc track position as a string. A skipped
		// gap is simply absent and falls back to "Track NN".
		TrackNames map[string]string `json:"trackNames"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	dr := pendingResolution.Load()
	if dr == nil {
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "No disc to confirm. Detect the disc again."})
		return
	}

	// Import-as-unknown: explicit only. (A blank pick no longer implies import —
	// gnudb candidates legitimately have no MBID and are chosen by id.)
	if req.ImportUnknown {
		go runRipJob(localRelease(dr.toc, dr.discID, dr.cdtext))
		_, _ = w.Write([]byte(`{"ok":true}`))
		return
	}

	// Identify the chosen candidate by its stable id (preferred) or release MBID
	// (back-compat). A user pick is a confirmed match → JOB 5 captures it.
	for _, c := range dr.res.Candidates {
		if c.Release == nil {
			continue
		}
		if (req.CandidateID != "" && candidateKey(c.Release) == req.CandidateID) ||
			(req.ReleaseMBID != "" && c.Release.ReleaseMBID == req.ReleaseMBID) {
			// Name-first: fill any alignment gap tracks with the user's names (and
			// any still-blank title with "Track NN") BEFORE we learn or rip, so the
			// persisted edition and the files both carry the corrected names.
			applyGapNames(c.Release, req.TrackNames)
			captureMatchContribution(dr, c.Release, c.Source, 1.0)
			// JOB 6/7 — back-resolve the confirmed pick across sources and persist
			// the disc-identity record so the next insert resolves from local_memory.
			// With gaps named, this record IS the new edition — the next insert of
			// this exact disc auto-resolves to it.
			learnConfirmedIdentity(dr, c, "user_pick")
			// position-map sanity — flag (log) tracks whose duration is wildly off
			// the disc, in case the user picked the wrong release.
			sanityCheckTrackDurations(c.Release, dr.toc)
			go runRipJob(c.Release)
			_, _ = w.Write([]byte(`{"ok":true}`))
			return
		}
	}
	// Unrecognized id — don't fail; import as unknown so the disc still lands.
	go runRipJob(localRelease(dr.toc, dr.discID, dr.cdtext))
	_, _ = w.Write([]byte(`{"ok":true}`))
}

// reconcileAutoWithDisc re-checks a confident resolution against the physical disc
// before it can silently rip. The remembered / looked-up release is re-aligned to
// the disc's durations (duration sequence alignment): its tracks are re-expressed in
// DISC order — fixing any position drift — off-duration tracks are flagged, and the
// flags/gaps are carried onto the lead candidate so the compare view can show them.
//
// If the disc has a track the release genuinely can't name (a GAP — a structural
// mismatch, e.g. a learned pressing that doesn't truly fit), the match is dropped
// below the auto bar so the user verifies and re-picks (which re-learns the right
// pressing) instead of silently ripping the wrong one. A clean re-alignment (no gaps)
// stays auto, honoring "do the rest silently when confident" — per-track duration
// differences alone (a longer pressing, a hidden-track tail) only FLAG, never block.
func reconcileAutoWithDisc(res *RipResolution, toc *TOC, ct *CDText) {
	if res == nil || res.Release == nil || len(res.Candidates) == 0 || res.Confidence < confidenceAutoSelect {
		return
	}
	tocDur := tocTrackDurationsMs(toc)
	if len(res.Release.Tracks) == 0 || len(tocDur) == 0 {
		return
	}
	aligned := alignReleaseToDisc(res.Release, tocDur, toc.FirstTrack, ct)
	res.Release.Tracks = aligned.Tracks
	res.Release.TrackCount = len(aligned.Tracks)
	lead := res.Candidates[0]
	lead.Gaps = aligned.Gaps
	lead.Flagged = aligned.Flagged
	lead.DroppedReleaseTitles = aligned.DroppedReleaseTitles
	if len(aligned.Gaps) > 0 {
		res.Confidence = confidenceAutoSelect - 0.05 // → "confirm"
		lead.Confidence = res.Confidence
		log.Printf("resolve: re-aligned auto match has %d unnamable disc track(s) — routing to confirm for verification", len(aligned.Gaps))
	} else if len(aligned.Flagged) > 0 {
		log.Printf("resolve: re-aligned auto match fits (kept auto) with %d flagged duration(s)", len(aligned.Flagged))
	}
}

// learnConfirmedIdentity closes the identification loop (JOB 6/7). On ANY
// confirmed identity — auto, user pick, or AcoustID — it back-resolves the pick
// to a MusicBrainz identity if it lacks one (so the crosswalk carries release +
// recording MBIDs, the cluster keys), then persists the disc-identity record and
// indexes it. The next insert of this disc resolves from local_memory, offline.
// Best-effort: never blocks or fails the rip. Skipped for unidentified imports.
func learnConfirmedIdentity(dr *detectResult, c *RipScoredCandidate, via string) {
	if dr == nil || c == nil || c.Release == nil || c.Release.Unidentified {
		return
	}
	// was_override — did the user confirm something OTHER than the default we first
	// offered? Distinguishes a deliberate correction (a searched result, or a
	// non-default offered card) from a rubber-stamp of our suggestion. Capture-only
	// for now. Compute the chosen key NOW, before crossResolveToMusicBrainz can
	// attach an MBID: that would shift an accepted gnudb default from its name-key to
	// an MBID-key and falsely read as an override.
	wasOverride := dr.offeredDefaultKey != "" && candidateKey(c.Release) != dr.offeredDefaultKey
	if c.Release.ReleaseMBID == "" {
		crossResolveToMusicBrainz(c.Release, dr.toc)
	}
	persistDiscIdentity(dr.profile, c.Release, sourcesOf(c), c.Corroborated, c.Confidence, via, gatherCrosswalk(dr, c.Release), wasOverride)
}

// gatherCrosswalk resolves the confirmed identity across the remaining sources
// (JOB 6): the gnudb entry id for this disc (from the chosen release or any gnudb
// candidate in the pool for the same TOC) and a cover URL (deterministic CAA URL
// when an MBID exists, iTunes fallback otherwise). No duplicate network on the
// common MBID path — the CAA URL is constructed, not fetched.
func gatherCrosswalk(dr *detectResult, rel *MatchedRelease) crosswalk {
	cw := crosswalk{}
	if rel.GnudbID != "" {
		cw.gnudbID = rel.GnudbID
	} else if dr.res != nil {
		for _, cand := range dr.res.Candidates {
			if cand.Release != nil && cand.Release.GnudbID != "" {
				cw.gnudbID = cand.Release.GnudbID
				break
			}
		}
	}
	if rel.ReleaseMBID != "" {
		cw.coverURL = caaFrontURL(rel.ReleaseMBID)
	} else if u, ok := itunesCoverURL(rel.AlbumArtist, rel.Album); ok {
		cw.coverURL = u
	}
	return cw
}

// winningSource is the resolver source behind the best candidate (the one being
// auto-ripped) — "" when there are no scored candidates.
func winningSource(res *RipResolution) string {
	if res != nil && len(res.Candidates) > 0 {
		return res.Candidates[0].Source
	}
	return ""
}

// handleRipRetryTrack re-rips a single failed track (A4 — the "incomplete"
// panel's "Retry track N") without re-reading the rest of the disc. It rebuilds a
// working progress from the live snapshot, re-rips the one track via ripTrackSet
// (resume-aware), then finalizeRip re-applies the completeness gate — so a
// recovered track flips the album from "incomplete" to "done".
func handleRipRetryTrack(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	var req struct {
		Position int `json:"position"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req)

	rel := lastRippedRel.Load()
	if rel == nil {
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "Nothing to retry."})
		return
	}
	idx := -1
	for i := range rel.Tracks {
		if rel.Tracks[i].Position == req.Position {
			idx = i
			break
		}
	}
	if idx < 0 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "No such track."})
		return
	}
	if !ripActive.CompareAndSwap(false, true) {
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "alreadyRipping": true, "error": "A rip is already in progress."})
		return
	}
	go func() {
		defer ripActive.Store(false)
		ripStopRequested.Store(false) // fresh single-track rip — clear any prior stop (J4)
		ripMu.Lock()
		defer ripMu.Unlock()

		snap := *loadRip()
		prog := &snap
		prog.Tracks = append([]TrackRipStatus(nil), snap.Tracks...) // mutable copy
		destDir := prog.LandedDir
		if destDir == "" {
			destDir = albumDir(rel)
		}
		tmp, err := os.MkdirTemp("", "cassette-retry-")
		if err != nil {
			progUpdate(prog, func() { prog.State = "error"; prog.Message = "Cannot create temp dir: " + err.Error() })
			return
		}
		defer os.RemoveAll(tmp)

		progUpdate(prog, func() {
			prog.State = "ripping"
			prog.Message = fmt.Sprintf("Retrying track %d…", req.Position)
			prog.StartedAt = nowFn()
		})
		ripTrackSet(prog, rel, []int{idx}, destDir, tmp, false)
		finalizeRip(prog, rel)
	}()
	_, _ = w.Write([]byte(`{"ok":true}`))
}
