// Contribution capture (JOB 5) — LOCAL ONLY. Submits nothing.
//
// Per CASSETTE_OPEN_DATA_CONTRIBUTION.md, every confident or user-confirmed disc
// match banks a structured record of what we *would* contribute back to the open
// commons (MusicBrainz disc IDs, gnudb disc entries) — building a reviewable
// dataset before any live submission. The load-bearing rules from that doc,
// enforced here:
//
//   - QUALITY GATE: capture ONLY on an auto-match ≥ confidenceAutoSelect or a
//     user-confirmed match. NEVER from the import-as-unknown path. NEVER a guess.
//   - ATTRIBUTE: tie each record to the signed-in account (SubsonicUsername),
//     null when signed out. No anonymous bulk identity.
//   - PRIVACY: only public identifiers about the physical disc (TOC, disc IDs,
//     matched release/artist/album). NEVER file paths, library contents, or
//     listening history.
//   - NO EXTERNAL WRITE PATH: this file reads and appends to a LOCAL file only.
//     There is, by construction, no call to any MusicBrainz/gnudb/AcoustID
//     write/submit endpoint. Live submission is a separate, gated future phase.
//
// Store: an append-only JSONL file in the sidecar data dir (one record per
// line). Append-only fits a growing audit log far better than rewriting
// sidecar.json wholesale, is crash-safe (each line is independent), and exports
// trivially to JSON or CSV (handleRipContributions).

package main

import (
	"encoding/csv"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"
)

// tocRaw is the physical disc fingerprint — a fact about the object, not the
// person holding it (the privacy line the companion doc draws).
type tocRaw struct {
	FirstTrack    int   `json:"first_track"`
	LastTrack     int   `json:"last_track"`
	LeadoutOffset int   `json:"leadout_offset"`
	TrackOffsets  []int `json:"track_offsets"`
}

// CandidateContribution is one reviewable record of what we would contribute.
// snake_case JSON keys (the column contract). attribution is a pointer so an
// unauthenticated capture serializes as null, not "".
type CandidateContribution struct {
	ComputedMBDiscID  string  `json:"computed_mb_disc_id"`
	FreedbDiscID      string  `json:"freedb_disc_id"`
	TOCRaw            tocRaw  `json:"toc_raw"`
	MatchedReleaseMBID string `json:"matched_release_mbid"`
	MatchedArtist     string  `json:"matched_artist"`
	MatchedAlbum      string  `json:"matched_album"`
	IdentitySource    string  `json:"identity_source"`    // mb_disc_id|mb_fuzzy_toc|cd_text|gnudb|manual_search
	ContributionType  string  `json:"contribution_type"`  // musicbrainz_disc_id|gnudb_submission|none
	Confidence        float64 `json:"confidence"`
	Attribution       *string `json:"attribution"`
	CreatedAt         string  `json:"created_at"`
}

var contribMu sync.Mutex // serializes appends to the JSONL store

func contributionsPath() string {
	return filepath.Join(sidecarDataDir, "candidate_contributions.jsonl")
}

// identitySourceLabel maps an internal resolver source to the contribution
// vocabulary the dataset (and any future submission) speaks.
func identitySourceLabel(source string) string {
	switch source {
	case "discid":
		return "mb_disc_id"
	case "mb-toc":
		return "mb_fuzzy_toc"
	case "cdtext":
		return "cd_text"
	case "gnudb_mb_rescue":
		// An MB release found by searching MB with gnudb's own text (rung 5). It is
		// a MusicBrainz identity, not CD-TEXT and not a TOC match — its own label.
		return "mb_name_search"
	case "gnudb":
		return "gnudb"
	case "acoustid":
		return "acoustid"
	case "manual":
		return "manual_search"
	default:
		return source
	}
}

// deriveContributionType decides what, if anything, this match could give back:
//   - musicbrainz_disc_id: an MB release is known but the match did NOT come from
//     an exact MB disc ID, so MB has no disc ID for this TOC — the gap we can fill.
//   - gnudb_submission: identified confidently with no MB release and not from
//     gnudb, so gnudb most likely lacks this disc.
//   - none: MB already has the disc ID (matched via it), or there's nothing
//     cleanly contributable. Still logged, for coverage stats.
//
// Best-effort and conservative: it never claims a gap it can't substantiate
// (e.g. it does not probe gnudb on an MB-disc-ID hit). The dataset is for human
// review before anything is submitted.
func deriveContributionType(identitySource string, hasMBID bool) string {
	switch {
	case identitySource == "mb_disc_id":
		return "none"
	case hasMBID:
		return "musicbrainz_disc_id"
	case identitySource == "gnudb":
		return "none"
	default:
		return "gnudb_submission"
	}
}

// attributionFromState returns the signed-in account identifier, or nil when
// unpaired. Local-only — this never leaves the machine in the capture phase.
func attributionFromState() *string {
	if liveState == nil || liveState.SubsonicUsername == "" {
		return nil
	}
	u := liveState.SubsonicUsername
	return &u
}

// captureMatchContribution banks one record for a confident/confirmed match.
// Caller MUST only invoke it from the auto-match (≥ threshold) and user-confirm
// paths — never import-as-unknown. Best-effort: a capture failure is logged and
// never affects the rip.
func captureMatchContribution(dr *detectResult, chosen *MatchedRelease, source string, confidence float64) {
	if dr == nil || dr.toc == nil || chosen == nil {
		return
	}
	label := identitySourceLabel(source)
	rec := CandidateContribution{
		ComputedMBDiscID: dr.discID,
		FreedbDiscID:     freedbDiscIDHex(dr.toc),
		TOCRaw: tocRaw{
			FirstTrack:    dr.toc.FirstTrack,
			LastTrack:     dr.toc.LastTrack,
			LeadoutOffset: dr.toc.LeadoutOffset,
			TrackOffsets:  append([]int(nil), dr.toc.TrackOffsets...),
		},
		MatchedReleaseMBID: chosen.ReleaseMBID,
		MatchedArtist:      chosen.AlbumArtist,
		MatchedAlbum:       chosen.Album,
		IdentitySource:     label,
		ContributionType:   deriveContributionType(label, chosen.ReleaseMBID != ""),
		Confidence:         confidence,
		Attribution:        attributionFromState(),
		CreatedAt:          nowFn().UTC().Format(time.RFC3339),
	}
	if err := appendContribution(rec); err != nil {
		log.Printf("contrib: could not record candidate contribution: %v", err)
	} else {
		log.Printf("contrib: banked %s contribution for %q — %q (%s, conf %.2f)",
			rec.ContributionType, rec.MatchedArtist, rec.MatchedAlbum, rec.IdentitySource, rec.Confidence)
	}
}

// appendContribution serializes one record as a JSON line and appends it. The
// ONLY write in this subsystem — and it is to a local file, never a network.
func appendContribution(rec CandidateContribution) error {
	data, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	contribMu.Lock()
	defer contribMu.Unlock()
	if err := os.MkdirAll(sidecarDataDir, 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(contributionsPath(), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(append(data, '\n'))
	return err
}

// loadContributions reads every banked record. Skips malformed lines rather than
// failing the whole export.
func loadContributions() ([]CandidateContribution, error) {
	contribMu.Lock()
	defer contribMu.Unlock()
	data, err := os.ReadFile(contributionsPath())
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var out []CandidateContribution
	for _, line := range splitJSONLines(data) {
		var rec CandidateContribution
		if json.Unmarshal(line, &rec) == nil {
			out = append(out, rec)
		}
	}
	return out, nil
}

// splitJSONLines splits on newlines, dropping blanks. (Kept local so the store
// stays dependency-free.)
func splitJSONLines(data []byte) [][]byte {
	var out [][]byte
	start := 0
	for i := 0; i <= len(data); i++ {
		if i == len(data) || data[i] == '\n' {
			if i > start {
				line := data[start:i]
				if len(line) > 0 {
					out = append(out, line)
				}
			}
			start = i + 1
		}
	}
	return out
}

// ── Export (the artifact the founder takes to MusicBrainz / gnudb) ───────────

// handleRipContributions dumps the captured dataset for review. ?format=csv
// returns CSV; anything else returns a JSON array. Read-only; local data only.
func handleRipContributions(w http.ResponseWriter, r *http.Request) {
	recs, err := loadContributions()
	if err != nil {
		http.Error(w, "could not read contributions: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if r.URL.Query().Get("format") == "csv" {
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="candidate_contributions.csv"`)
		writeContributionsCSV(w, recs)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(map[string]any{"count": len(recs), "contributions": recs})
}

func writeContributionsCSV(w http.ResponseWriter, recs []CandidateContribution) {
	cw := csv.NewWriter(w)
	defer cw.Flush()
	_ = cw.Write([]string{
		"created_at", "identity_source", "contribution_type", "confidence",
		"computed_mb_disc_id", "freedb_disc_id", "matched_release_mbid",
		"matched_artist", "matched_album", "attribution", "toc_raw",
	})
	for _, c := range recs {
		attr := ""
		if c.Attribution != nil {
			attr = *c.Attribution
		}
		tocJSON, _ := json.Marshal(c.TOCRaw)
		_ = cw.Write([]string{
			c.CreatedAt, c.IdentitySource, c.ContributionType,
			strconv.FormatFloat(c.Confidence, 'f', -1, 64),
			c.ComputedMBDiscID, c.FreedbDiscID, c.MatchedReleaseMBID,
			c.MatchedArtist, c.MatchedAlbum, attr, string(tocJSON),
		})
	}
}

// summarizeContributions is a tiny coverage view (used by the CLI dump and handy
// for logs): counts by contribution_type.
func summarizeContributions(recs []CandidateContribution) map[string]int {
	out := map[string]int{}
	for _, c := range recs {
		out[c.ContributionType]++
	}
	return out
}
