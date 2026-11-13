// The disc-identity record, the local memory index (rung zero), and
// cross-pressing clusters (JOB 7).
//
// Per CASSETTE_IDENTIFICATION_ARCHITECTURE.md, after a full pass we hold one
// record per disc: the intrinsic profile, the confirmed release, every source's
// ID for it, the confidence and how we got there, the per-track recordings, and
// who/when confirmed. That record goes three places — and the load-bearing one
// is the LOCAL MEMORY INDEX: resolveDisc consults it BEFORE any network call, so
// a disc we have identified before is known instantly and offline (source
// `local_memory`). This is how identification turns from lookup into knowledge.
//
// Store: an append-only JSONL file (disc_identity.jsonl) in the sidecar data
// dir, mirroring candidate_contributions.jsonl's crash-safe one-record-per-line
// shape. The in-memory index is built once at first use and kept hot. The
// existing candidate_contributions.jsonl is BACKFILLED into the index so discs
// identified before this feature shipped are recognized immediately.
//
// All local. No network. No cross-user index (that is the gated future phase).

package main

import (
	"bytes"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// TrackRecording is the per-track crosswalk: position, title, and the AcoustID/
// MusicBrainz recording MBID that makes a track pressing-independent (the key to
// cross-pressing clusters).
type TrackRecording struct {
	Position      int    `json:"position"`
	Title         string `json:"title,omitempty"`
	RecordingMBID string `json:"recording_mbid,omitempty"`
}

// DiscIdentityRecord is the unit of knowledge — one record per identified disc.
// snake_case JSON (the on-disk contract). The first block is the intrinsic
// profile (the keys rung zero matches on); the second is the confirmed release
// and its full crosswalk; the third is provenance; the last is who/when.
type DiscIdentityRecord struct {
	// Intrinsic profile — the lookup keys.
	MBDiscID     string `json:"mb_disc_id"`
	FreedbDiscID string `json:"freedb_disc_id"`
	TOCSignature string `json:"toc_signature"`
	TOCRaw       tocRaw `json:"toc_raw"`
	TrackCount   int    `json:"track_count"`
	Fingerprint  string `json:"fingerprint,omitempty"`

	// Confirmed release + crosswalk (every source's ID for this pressing).
	ReleaseMBID     string           `json:"release_mbid"`
	Album           string           `json:"album"`
	AlbumArtist     string           `json:"album_artist"`
	Date            string           `json:"date,omitempty"`
	GnudbID         string           `json:"gnudb_id,omitempty"`
	CoverURL        string           `json:"cover_url,omitempty"`
	// Disc position within a multi-disc release. The disc-id rung computes these
	// (buildMatchedRelease) but the record used to drop them — so every rip that
	// resolved from local_memory/pool (i.e. almost all of them, since detect
	// persists the record before the rip pass re-reads it) tagged DISCNUMBER=1 and
	// a 2-CD set collapsed onto "Disc 1". Persist them so the disc number survives
	// the round-trip. Zero = single-disc/unknown; the tag writer clamps 0 → 1 of 1.
	MediumPos       int              `json:"medium_pos,omitempty"`
	MediumCount     int              `json:"medium_count,omitempty"`
	MediumTitle     string           `json:"medium_title,omitempty"`
	TrackRecordings []TrackRecording `json:"track_recordings,omitempty"`

	// Provenance — how sure we are and how we got there.
	Confidence   float64          `json:"confidence"`
	Sources      []string         `json:"sources"`
	Corroborated bool             `json:"corroborated"`
	ClusterID    string           `json:"cluster_id,omitempty"`
	Negatives    []SourceNegative `json:"negatives,omitempty"` // per-source misses (JOB 5) — the gaps we could fill

	// Rip outcome — whether the rip that produced this identification completed in
	// full. Set FALSE at detect/persist time (the rip hasn't run yet) and stamped
	// true by markRipComplete only when finalizeRip lands every track. The shared
	// pool counts a contribution toward consensus ONLY when this is true (Phase 2).
	RipComplete bool `json:"rip_complete"`

	// WasOverride — the user confirmed an identity OTHER than the default we first
	// offered for this disc (a deliberate correction), vs. accepting our top pick.
	// Capture-only: preserved through the wire to the shared pool so the "users go
	// out of their way to change this default" signal is queryable later; NOTHING
	// reads it in consensus yet (whether/how to demote a rejected default is a
	// separate, deferred decision). omitempty → absent for the common accept case.
	WasOverride bool `json:"was_override,omitempty"`

	// Who/when.
	Confirmer    *string `json:"confirmer"`
	ConfirmedVia string  `json:"confirmed_via"` // auto | user_pick | user_relink | acoustid | backfill
	CreatedAt    string  `json:"created_at"`
	UpdatedAt    string  `json:"updated_at"`
}

// discMemoryIndex is the in-memory rung-zero index, keyed on every signal so a
// re-inserted disc matches on whichever ID it carries.
type discMemoryIndex struct {
	mu          sync.RWMutex
	loaded      bool
	byMBDisc    map[string]*DiscIdentityRecord
	byFreedb    map[string]*DiscIdentityRecord
	byTOCSig    map[string]*DiscIdentityRecord
	byRecording map[string][]*DiscIdentityRecord // recording MBID → records (clusters)
	all         []*DiscIdentityRecord
}

var discMemory = &discMemoryIndex{
	byMBDisc:    map[string]*DiscIdentityRecord{},
	byFreedb:    map[string]*DiscIdentityRecord{},
	byTOCSig:    map[string]*DiscIdentityRecord{},
	byRecording: map[string][]*DiscIdentityRecord{},
}

var identityMu sync.Mutex // serializes appends to disc_identity.jsonl

func discIdentityPath() string {
	return filepath.Join(sidecarDataDir, "disc_identity.jsonl")
}

// recordKey is the dedupe/identity key for a record: the strongest signal it
// carries, MB disc ID first, then freedb, then the TOC signature.
func (r *DiscIdentityRecord) recordKey() string {
	switch {
	case r.MBDiscID != "":
		return "mb:" + r.MBDiscID
	case r.FreedbDiscID != "":
		return "fd:" + r.FreedbDiscID
	default:
		return "toc:" + r.TOCSignature
	}
}

// indexRecord inserts a record into all key maps (caller holds the lock). A
// later record for the same key overwrites the earlier one (last-confirm wins).
func (idx *discMemoryIndex) indexRecord(r *DiscIdentityRecord) {
	if r.MBDiscID != "" {
		idx.byMBDisc[r.MBDiscID] = r
	}
	if r.FreedbDiscID != "" {
		idx.byFreedb[r.FreedbDiscID] = r
	}
	if r.TOCSignature != "" {
		idx.byTOCSig[r.TOCSignature] = r
	}
	for _, tr := range r.TrackRecordings {
		if tr.RecordingMBID != "" {
			idx.byRecording[tr.RecordingMBID] = append(idx.byRecording[tr.RecordingMBID], r)
		}
	}
	idx.all = append(idx.all, r)
}

// ensureLoaded builds the index once: the disc_identity.jsonl store first, then
// backfills any candidate_contributions.jsonl record whose key is not already
// present — so discs identified before this feature shipped are recognized.
func (idx *discMemoryIndex) ensureLoaded() {
	idx.mu.Lock()
	defer idx.mu.Unlock()
	if idx.loaded {
		return
	}
	idx.loaded = true

	// One-time, idempotent migration: bring any cluster_ids written under the old
	// insertion-order rule onto the deterministic clusterID() scheme before we
	// index, so a re-inserted disc matches its recomputed id, not a stale one.
	recomputeClusterIDs()

	seen := map[string]bool{}
	for _, r := range loadDiscIdentities() {
		rec := r
		idx.indexRecord(&rec)
		seen[rec.recordKey()] = true
	}

	// Backfill from the contribution audit log (in-memory only — the
	// contributions file stays the source of truth for those seed records).
	backfilled := 0
	for _, c := range backfillContributions() {
		if seen[c.recordKey()] {
			continue
		}
		rec := c
		idx.indexRecord(&rec)
		seen[rec.recordKey()] = true
		backfilled++
	}
	log.Printf("disc-identity: index loaded — %d records (%d backfilled from contributions)",
		len(idx.all), backfilled)
}

// loadDiscIdentities reads every persisted record, skipping malformed lines.
func loadDiscIdentities() []DiscIdentityRecord {
	identityMu.Lock()
	defer identityMu.Unlock()
	data, err := os.ReadFile(discIdentityPath())
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		log.Printf("disc-identity: read store: %v", err)
		return nil
	}
	var out []DiscIdentityRecord
	for _, line := range splitJSONLines(data) {
		var rec DiscIdentityRecord
		if json.Unmarshal(line, &rec) == nil {
			out = append(out, rec)
		}
	}
	return out
}

// backfillContributions converts the existing contribution audit records into
// sparse disc-identity records (keys + release + provenance). They lack a
// tracklist, so a hit rebuilds tracks from the TOC; the MBID still lets the rip
// earn catalog enrichment. ConfirmedVia "backfill" marks the provenance.
func backfillContributions() []DiscIdentityRecord {
	recs, err := loadContributions()
	if err != nil {
		log.Printf("disc-identity: backfill read: %v", err)
		return nil
	}
	out := make([]DiscIdentityRecord, 0, len(recs))
	for _, c := range recs {
		out = append(out, DiscIdentityRecord{
			MBDiscID:     c.ComputedMBDiscID,
			FreedbDiscID: c.FreedbDiscID,
			TOCSignature: tocSignatureFromRaw(c.TOCRaw),
			TOCRaw:       c.TOCRaw,
			TrackCount:   len(c.TOCRaw.TrackOffsets),
			ReleaseMBID:  c.MatchedReleaseMBID,
			Album:        c.MatchedAlbum,
			AlbumArtist:  c.MatchedArtist,
			Confidence:   c.Confidence,
			Sources:      []string{c.IdentitySource},
			Confirmer:    c.Attribution,
			ConfirmedVia: "backfill",
			CreatedAt:    c.CreatedAt,
			UpdatedAt:    c.CreatedAt,
		})
	}
	// Layer 3 — the backfill dedup keeps the FIRST record per disc key, so order it
	// richest-first: an MBID-bearing row beats an MBID-less one, and a newer row
	// beats an older one. (Without this, an early "" -MBID manual_search row shadows
	// a later row that DOES carry the MBID — the Eve 6 case.)
	sort.SliceStable(out, func(i, j int) bool {
		hi, hj := out[i].ReleaseMBID != "", out[j].ReleaseMBID != ""
		if hi != hj {
			return hi
		}
		return out[i].CreatedAt > out[j].CreatedAt
	})
	return out
}

// tocSignatureFromRaw recomputes the TOC signature from a stored tocRaw so a
// backfilled record keys identically to a live one.
func tocSignatureFromRaw(t tocRaw) string {
	return tocSignature(&TOC{
		FirstTrack:    t.FirstTrack,
		LastTrack:     t.LastTrack,
		LeadoutOffset: t.LeadoutOffset,
		TrackOffsets:  t.TrackOffsets,
	})
}

// lookupMemory is rung zero: match an incoming profile against the index by any
// signal it carries. Returns the matched record (and the signal that matched),
// or nil. Pure and offline.
func lookupMemory(profile *DiscProfile) (*DiscIdentityRecord, string) {
	if profile == nil {
		return nil, ""
	}
	discMemory.ensureLoaded()
	discMemory.mu.RLock()
	defer discMemory.mu.RUnlock()

	if profile.MBDiscID != "" {
		if r, ok := discMemory.byMBDisc[profile.MBDiscID]; ok {
			return r, "mb_disc_id"
		}
	}
	if profile.FreedbDiscID != "" {
		if r, ok := discMemory.byFreedb[profile.FreedbDiscID]; ok {
			return r, "freedb_disc_id"
		}
	}
	if sig := tocSignature(profile.TOC); sig != "" {
		if r, ok := discMemory.byTOCSig[sig]; ok {
			return r, "toc_signature"
		}
	}
	if profile.Fingerprint != "" {
		for _, rid := range profile.RecordingMBIDs {
			if recs := discMemory.byRecording[rid]; len(recs) > 0 {
				return recs[0], "fingerprint"
			}
		}
	}
	return nil, ""
}

// crosswalk holds the extra cross-source identifiers gathered at confirm time
// (JOB 6) — every source's ID for this pressing, beyond the MB release the chosen
// candidate already carries.
type crosswalk struct {
	gnudbID  string
	coverURL string
}

// persistDiscIdentity writes (or updates) the disc-identity record for a
// confirmed identity and adds it to the live index, so the very next insert of
// this disc resolves from local_memory. Best-effort: a failure is logged and
// never affects the rip. cw carries the cross-source crosswalk (gnudb id, cover).
func persistDiscIdentity(profile *DiscProfile, rel *MatchedRelease, sources []string, corroborated bool, confidence float64, via string, cw crosswalk, wasOverride bool) {
	if profile == nil || rel == nil {
		return
	}
	discMemory.ensureLoaded() // ensure the index + one-time cluster recompute are ready
	now := nowFn().UTC().Format(time.RFC3339)
	rec := DiscIdentityRecord{
		MBDiscID:     profile.MBDiscID,
		FreedbDiscID: profile.FreedbDiscID,
		TOCSignature: tocSignature(profile.TOC),
		TOCRaw: tocRaw{
			FirstTrack:    profile.TOC.FirstTrack,
			LastTrack:     profile.TOC.LastTrack,
			LeadoutOffset: profile.TOC.LeadoutOffset,
			TrackOffsets:  append([]int(nil), profile.TOC.TrackOffsets...),
		},
		TrackCount:   profile.TrackCount,
		Fingerprint:  profile.Fingerprint,
		ReleaseMBID:  rel.ReleaseMBID,
		Album:        rel.Album,
		AlbumArtist:  rel.AlbumArtist,
		Date:         rel.Date,
		GnudbID:      firstNonEmpty(cw.gnudbID, rel.GnudbID),
		CoverURL:     cw.coverURL,
		MediumPos:    rel.MediumPos,
		MediumCount:  rel.MediumCount,
		MediumTitle:  rel.MediumTitle,
		Confidence:   confidence,
		Sources:      sources,
		Corroborated: corroborated,
		Negatives:    profile.Negatives,
		WasOverride:  wasOverride,
		Confirmer:    attributionFromState(),
		ConfirmedVia: via,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	for _, t := range rel.Tracks {
		rec.TrackRecordings = append(rec.TrackRecordings, TrackRecording{
			Position:      t.Position,
			Title:         t.Title,
			RecordingMBID: t.RecordingMBID,
		})
	}
	rec.ClusterID = clusterID(&rec)

	if err := appendDiscIdentity(rec); err != nil {
		log.Printf("disc-identity: could not persist record for %q — %q: %v", rec.AlbumArtist, rec.Album, err)
		return
	}
	discMemory.mu.Lock()
	discMemory.indexRecord(&rec)
	discMemory.mu.Unlock()
	log.Printf("disc-identity: persisted %q — %q (via %s, conf %.2f, sources %v, cluster %s)",
		rec.AlbumArtist, rec.Album, via, confidence, sources, rec.ClusterID)
}

// appendDiscIdentity serializes one record as a JSON line and appends it.
func appendDiscIdentity(rec DiscIdentityRecord) error {
	data, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	identityMu.Lock()
	defer identityMu.Unlock()
	if err := os.MkdirAll(sidecarDataDir, 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(discIdentityPath(), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(append(data, '\n'))
	return err
}

// Cross-pressing cluster id prefixes. A cluster groups pressings that share the
// same set of acoustic recordings (recordings are pressing-independent). The id
// is a pure function of that set, so it is identical on any machine in any
// insertion order — the property a future shared pool needs. The fallbacks keep
// a stable id for discs not yet back-resolved to recordings.
const (
	clusterPrefixRecordings = "rec:" // SHA-1 of the sorted recording-MBID set
	clusterPrefixRelease    = "rel:" // release MBID, when no recordings are known
)

// clusterID computes the deterministic cross-pressing cluster id for a record
// from the record's OWN fields only — no index lookup, no insertion order:
//
//	1. recordings present → "rec:" + SHA-1(sorted, deduped recording MBIDs)
//	2. else release MBID  → "rel:" + release MBID
//	3. else               → recordKey() (mb:/fd:/toc:)
//
// Two pressings that share the same recording set produce the SAME id everywhere
// — which is why the old inherit-from-first-indexed step (order-dependent, so it
// fragmented across machines) is gone.
func clusterID(rec *DiscIdentityRecord) string {
	seen := map[string]bool{}
	mbids := make([]string, 0, len(rec.TrackRecordings))
	for _, tr := range rec.TrackRecordings {
		if tr.RecordingMBID == "" || seen[tr.RecordingMBID] {
			continue
		}
		seen[tr.RecordingMBID] = true
		mbids = append(mbids, tr.RecordingMBID)
	}
	if len(mbids) > 0 {
		sort.Strings(mbids)
		sum := sha1.Sum([]byte(strings.Join(mbids, "\n")))
		return clusterPrefixRecordings + hex.EncodeToString(sum[:])
	}
	if rec.ReleaseMBID != "" {
		return clusterPrefixRelease + rec.ReleaseMBID
	}
	return rec.recordKey()
}

// recomputeClusterIDs is a one-time, idempotent migration: it rewrites every
// persisted cluster_id with the deterministic clusterID() scheme, so records
// written under the old insertion-order rule become uniform. A second run finds
// nothing to change. Order-preserving — only the cluster_id field changes, and
// malformed lines pass through untouched. Atomic (temp file + rename) so a crash
// never truncates the store. Best-effort: a failure leaves the store as-is.
func recomputeClusterIDs() {
	identityMu.Lock()
	defer identityMu.Unlock()
	data, err := os.ReadFile(discIdentityPath())
	if os.IsNotExist(err) {
		return
	}
	if err != nil {
		log.Printf("disc-identity: cluster recompute read: %v", err)
		return
	}
	lines := splitJSONLines(data)
	var buf bytes.Buffer
	changed := 0
	for _, line := range lines {
		var rec DiscIdentityRecord
		if json.Unmarshal(line, &rec) != nil {
			buf.Write(line)
			buf.WriteByte('\n')
			continue
		}
		if want := clusterID(&rec); rec.ClusterID != want {
			rec.ClusterID = want
			changed++
		}
		out, err := json.Marshal(rec)
		if err != nil {
			buf.Write(line)
			buf.WriteByte('\n')
			continue
		}
		buf.Write(out)
		buf.WriteByte('\n')
	}
	if changed == 0 {
		return
	}
	tmp := discIdentityPath() + ".tmp"
	if err := os.WriteFile(tmp, buf.Bytes(), 0o644); err != nil {
		log.Printf("disc-identity: cluster recompute write: %v", err)
		return
	}
	if err := os.Rename(tmp, discIdentityPath()); err != nil {
		log.Printf("disc-identity: cluster recompute rename: %v", err)
		return
	}
	log.Printf("disc-identity: recomputed cluster_id on %d/%d record(s)", changed, len(lines))
}

// markRipComplete stamps rip_complete=true on every persisted disc-identity record
// for mbDiscID — called from finalizeRip ONLY when the rip landed every track. The
// next library-sync then reports this disc's identity as backed by a COMPLETED rip
// (the Phase-2 consensus gate: a contribution counts only once a full rip exists).
//
// In-place atomic rewrite (temp file + rename), mirroring recomputeClusterIDs, so
// the one logical record per disc carries the flag rather than relying on append +
// best-record dedup. The live in-memory index is updated too (released identityMu
// FIRST to keep the discMemory→identityMu lock order ensureLoaded uses). Best-effort.
func markRipComplete(mbDiscID string) {
	if mbDiscID == "" {
		return
	}
	changed := rewriteRipComplete(mbDiscID)

	discMemory.mu.Lock()
	if r, ok := discMemory.byMBDisc[mbDiscID]; ok {
		r.RipComplete = true
	}
	discMemory.mu.Unlock()

	if changed > 0 {
		log.Printf("disc-identity: marked rip_complete on %d record(s) for %s", changed, mbDiscID)
	}
}

// rewriteRipComplete is markRipComplete's file half: it sets rip_complete=true on
// every record matching mbDiscID and atomically rewrites the store. Returns how
// many records changed. Holds identityMu for the whole read-modify-write; acquires
// no other lock (so the caller can take discMemory.mu afterward without inverting
// the ensureLoaded lock order). Malformed lines pass through untouched.
func rewriteRipComplete(mbDiscID string) int {
	identityMu.Lock()
	defer identityMu.Unlock()
	data, err := os.ReadFile(discIdentityPath())
	if os.IsNotExist(err) {
		return 0
	}
	if err != nil {
		log.Printf("disc-identity: rip-complete read: %v", err)
		return 0
	}
	lines := splitJSONLines(data)
	var buf bytes.Buffer
	changed := 0
	for _, line := range lines {
		var rec DiscIdentityRecord
		if json.Unmarshal(line, &rec) != nil {
			buf.Write(line)
			buf.WriteByte('\n')
			continue
		}
		if rec.MBDiscID == mbDiscID && !rec.RipComplete {
			rec.RipComplete = true
			rec.UpdatedAt = nowFn().UTC().Format(time.RFC3339)
			changed++
		}
		out, err := json.Marshal(rec)
		if err != nil {
			buf.Write(line)
			buf.WriteByte('\n')
			continue
		}
		buf.Write(out)
		buf.WriteByte('\n')
	}
	if changed == 0 {
		return 0
	}
	tmp := discIdentityPath() + ".tmp"
	if err := os.WriteFile(tmp, buf.Bytes(), 0o644); err != nil {
		log.Printf("disc-identity: rip-complete write: %v", err)
		return 0
	}
	if err := os.Rename(tmp, discIdentityPath()); err != nil {
		log.Printf("disc-identity: rip-complete rename: %v", err)
		return 0
	}
	return changed
}

// recordHasTitles reports whether a memory record carries real per-track titles
// (not just positions/recording IDs) — the signal that a rung-zero rebuild can be
// fully offline rather than needing a tracklist back-resolve.
func recordHasTitles(r *DiscIdentityRecord) bool {
	for _, tr := range r.TrackRecordings {
		if tr.Title != "" {
			return true
		}
	}
	return false
}

// toMatchedRelease rebuilds a rippable release from a memory record + the live
// TOC, fully offline. Rich records (with track_recordings) restore exact titles
// and recording MBIDs; sparse backfilled records fall back to CD-TEXT / "Track
// NN" titles while still carrying the album MBID for catalog enrichment.
func (r *DiscIdentityRecord) toMatchedRelease(toc *TOC, ct *CDText) *MatchedRelease {
	dur := tocTrackDurationsMs(toc)
	m := &MatchedRelease{
		ReleaseMBID: r.ReleaseMBID,
		Album:       r.Album,
		AlbumArtist: r.AlbumArtist,
		Date:        r.Date,
		DiscID:      firstNonEmpty(r.MBDiscID, profileDiscID(toc)),
		MediumPos:   r.MediumPos,
		MediumCount: r.MediumCount,
		MediumTitle: r.MediumTitle,
		TrackCount:  len(dur),
	}
	byPos := make(map[int]TrackRecording, len(r.TrackRecordings))
	for _, tr := range r.TrackRecordings {
		byPos[tr.Position] = tr
	}
	for i := 0; i < len(dur); i++ {
		pos := toc.FirstTrack + i
		tr := byPos[pos]
		title := tr.Title
		if title == "" {
			title = ct.TitleFor(pos)
		}
		if title == "" {
			title = fmt.Sprintf("Track %02d", pos)
		}
		artist := r.AlbumArtist
		if artist == "" {
			artist = "Unknown Artist"
		}
		durSec := float64(dur[i]) / 1000
		m.Tracks = append(m.Tracks, RippedTrackMeta{
			Position:      pos,
			Title:         title,
			Artist:        artist,
			LengthMs:      dur[i],
			RecordingMBID: tr.RecordingMBID,
			LocalID:       CassetteLocalID(artist, title, durSec),
		})
	}
	return m
}

func profileDiscID(toc *TOC) string {
	id, _ := toc.DiscID()
	return id
}
