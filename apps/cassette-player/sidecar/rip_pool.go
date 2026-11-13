// The shared disc-identity pool — the WRITE path's local half.
//
// Gather the quality-gated disc-identity records from disc_identity.jsonl, strip
// the machine-local fields the server must stamp itself (confirmer + timestamps),
// and dedup by mb_disc_id (best record wins) so the local file's append-
// multiplication never even leaves the machine. The result rides along in the
// existing library-sync POST as `discIdentities`.
//
// Mirrors the server-side gate + best-record-wins in
// apps/cassette/src/lib/disc-pool.ts. Keep the two in lockstep.

package main

import "sort"

// poolMinConfidence mirrors confidenceAutoSelect / POOL_MIN_CONFIDENCE.
const poolMinConfidence = 0.80

// confirmedViaRank is the final best-record-wins tiebreak (mirrors
// CONFIRMED_VIA_RANK server-side). Higher wins; an unknown value ranks 0.
var confirmedViaRank = map[string]int{
	"user_pick":   3,
	"user_relink": 3, // a post-rip library re-match — a deliberate user correction
	"acoustid":    3,
	"auto":        2,
	"detect":      1,
	"backfill":    0,
}

func poolViaRank(via string) int { return confirmedViaRank[via] }

// poolDiscIdentity is the disc-identity record sent to the shared pool — the rich
// record MINUS the machine-local fields (confirmer, created_at, updated_at), which
// the server stamps itself. JSON keys match the server's parseWireDiscIdentity.
type poolDiscIdentity struct {
	MBDiscID        string           `json:"mb_disc_id"`
	FreedbDiscID    string           `json:"freedb_disc_id,omitempty"`
	TOCSignature    string           `json:"toc_signature,omitempty"`
	TOCRaw          tocRaw           `json:"toc_raw"`
	TrackCount      int              `json:"track_count"`
	Fingerprint     string           `json:"fingerprint,omitempty"`
	ReleaseMBID     string           `json:"release_mbid,omitempty"`
	Album           string           `json:"album,omitempty"`
	AlbumArtist     string           `json:"album_artist,omitempty"`
	Date            string           `json:"date,omitempty"`
	GnudbID         string           `json:"gnudb_id,omitempty"`
	CoverURL        string           `json:"cover_url,omitempty"`
	// Disc position within a multi-disc release — an intrinsic disc fact, not local
	// attribution, so it's shared (lets cross-user consensus carry disc order too).
	// Inert until the server's parseWireDiscIdentity + disc-pool consensus adopt it.
	MediumPos       int              `json:"medium_pos,omitempty"`
	MediumCount     int              `json:"medium_count,omitempty"`
	MediumTitle     string           `json:"medium_title,omitempty"`
	TrackRecordings []TrackRecording `json:"track_recordings,omitempty"`
	ClusterID       string           `json:"cluster_id,omitempty"`
	Confidence      float64          `json:"confidence"`
	Sources         []string         `json:"sources,omitempty"`
	Corroborated    bool             `json:"corroborated"`
	ConfirmedVia    string           `json:"confirmed_via,omitempty"`
	Negatives       []SourceNegative `json:"negatives,omitempty"`
	// WasOverride — the contributor confirmed an identity other than the default
	// first offered for this disc. Capture-only signal (see DiscIdentityRecord);
	// carried to the server but inert to consensus until a demote policy is decided.
	WasOverride bool `json:"was_override,omitempty"`
	// Whether a FULL rip of this disc has completed locally (Phase-2 consensus
	// gate). Sent explicitly (no omitempty) so the server distinguishes "reported
	// incomplete" from "older sidecar that never sends it" — both parse to false,
	// but the server's contribution upsert is sticky so neither retracts a prior true.
	RipComplete bool `json:"rip_complete"`
}

// poolGated is the entrance gate (mirrors passesPoolGate): confident (>=0.80) OR a
// user/AcoustID confirmation. The import-as-unknown path never persists a record,
// so it never reaches here; the gate enforces it regardless. A record with no
// mb_disc_id can't be pooled (mb_disc_id is the global key).
func poolGated(r *DiscIdentityRecord) bool {
	if r.MBDiscID == "" {
		return false
	}
	if r.Confidence >= poolMinConfidence {
		return true
	}
	return r.ConfirmedVia == "user_pick" || r.ConfirmedVia == "user_relink" || r.ConfirmedVia == "acoustid"
}

// poolRecordBetter mirrors isBetterRecord: higher confidence, then corroborated
// over not, then confirmed_via rank.
func poolRecordBetter(a, b DiscIdentityRecord) bool {
	if a.Confidence != b.Confidence {
		return a.Confidence > b.Confidence
	}
	if a.Corroborated != b.Corroborated {
		return a.Corroborated && !b.Corroborated
	}
	return poolViaRank(a.ConfirmedVia) > poolViaRank(b.ConfirmedVia)
}

// toPoolDiscIdentity copies the public disc facts, dropping the machine-local
// fields (confirmer, created_at, updated_at) that must never leave the machine.
func toPoolDiscIdentity(r DiscIdentityRecord) poolDiscIdentity {
	return poolDiscIdentity{
		MBDiscID:        r.MBDiscID,
		FreedbDiscID:    r.FreedbDiscID,
		TOCSignature:    r.TOCSignature,
		TOCRaw:          r.TOCRaw,
		TrackCount:      r.TrackCount,
		Fingerprint:     r.Fingerprint,
		ReleaseMBID:     r.ReleaseMBID,
		Album:           r.Album,
		AlbumArtist:     r.AlbumArtist,
		Date:            r.Date,
		GnudbID:         r.GnudbID,
		CoverURL:        r.CoverURL,
		MediumPos:       r.MediumPos,
		MediumCount:     r.MediumCount,
		MediumTitle:     r.MediumTitle,
		TrackRecordings: r.TrackRecordings,
		ClusterID:       r.ClusterID,
		Confidence:      r.Confidence,
		Sources:         r.Sources,
		Corroborated:    r.Corroborated,
		ConfirmedVia:    r.ConfirmedVia,
		Negatives:       r.Negatives,
		WasOverride:     r.WasOverride,
		RipComplete:     r.RipComplete,
	}
}

// gatherPoolDiscIdentities loads the persisted disc-identity records, keeps only
// the quality-gated ones, dedups by mb_disc_id (best wins), and returns the
// stripped wire records, sorted by mb_disc_id for a deterministic payload.
func gatherPoolDiscIdentities() []poolDiscIdentity {
	recs := loadDiscIdentities()
	best := map[string]DiscIdentityRecord{}
	for i := range recs {
		r := recs[i]
		if !poolGated(&r) {
			continue
		}
		if cur, ok := best[r.MBDiscID]; !ok || poolRecordBetter(r, cur) {
			best[r.MBDiscID] = r
		}
	}
	out := make([]poolDiscIdentity, 0, len(best))
	for _, r := range best {
		out = append(out, toPoolDiscIdentity(r))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].MBDiscID < out[j].MBDiscID })
	return out
}
