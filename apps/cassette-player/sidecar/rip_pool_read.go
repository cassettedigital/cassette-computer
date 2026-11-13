// The shared disc-identity pool — the READ path's local half (P4).
//
// On disc insert, after the local rung-zero memory misses, ask the cloud whether
// another user has already identified this exact disc (by mb_disc_id). A hit seeds
// the ladder BEFORE any external lookup, so a disc the community already knows
// resolves instantly. Fail-soft and bounded: a miss, an error, or no token all
// return nil and the ladder falls through to the network rungs exactly as before.
//
// Mirrors the server's GET /api/player/disc-pool response (disc-pool.ts).

package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// sharedPoolHit is the consensus identity the server returns for a disc. Only the
// derived consensus, never per-user attribution. Consensus is "auto" (>=2 agreeing
// accounts) or "suggest" (one voice). Decision is the older field: the server pins
// it to "suggest" so apps installed before BUG-1011, which skipped their own lookups
// on "auto", treat every pool answer as a hint. Either way this app never picks on
// a pool answer alone (poolRungCandidate). CrossPressing is true when this is a
// duration-matched SIBLING pressing (P5), not the exact disc.
type sharedPoolHit struct {
	Found            bool             `json:"found"`
	CrossPressing    bool             `json:"cross_pressing"`
	MBDiscID         string           `json:"mb_disc_id"`
	ReleaseMBID      string           `json:"release_mbid"`
	Album            string           `json:"album"`
	AlbumArtist      string           `json:"album_artist"`
	Date             string           `json:"date"`
	GnudbID          string           `json:"gnudb_id"`
	CoverURL         string           `json:"cover_url"`
	MediumPos        int              `json:"medium_pos"`
	MediumCount      int              `json:"medium_count"`
	MediumTitle      string           `json:"medium_title"`
	TrackRecordings  []TrackRecording `json:"track_recordings"`
	Decision         string           `json:"decision"`
	Consensus        string           `json:"consensus"`
	Confidence       float64          `json:"confidence"`
	ContributorCount int              `json:"contributor_count"`
	AgreementCount   int              `json:"agreement_count"`
}

// poolReadTimeout bounds the on-insert lookup so a slow/unreachable backend never
// stalls disc detection — the ladder's network rungs are the fallback.
const poolReadTimeout = 4 * time.Second

// fetchSharedPoolIdentity asks the cloud for a consensus identity for mbDiscID,
// also sending the disc's track count + per-track durations so the server can fall
// back to a cross-pressing match (a different pressing of the same album) when the
// exact disc id misses. Returns nil on any miss/error/no-token (the ladder then
// proceeds to the network rungs). Never blocks longer than poolReadTimeout.
func fetchSharedPoolIdentity(mbDiscID string, trackCount int, durationsMs []int) *sharedPoolHit {
	if mbDiscID == "" || liveState == nil || liveState.BearerToken == "" {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), poolReadTimeout)
	defer cancel()

	q := url.Values{}
	q.Set("mb_disc_id", mbDiscID)
	// Cross-pressing signals (best-effort): omit if the durations don't line up
	// with the track count, so the server only ever gets a coherent vector.
	if trackCount > 0 && len(durationsMs) == trackCount {
		q.Set("track_count", strconv.Itoa(trackCount))
		parts := make([]string, len(durationsMs))
		for i, d := range durationsMs {
			parts[i] = strconv.Itoa(d)
		}
		q.Set("durations", strings.Join(parts, ","))
	}
	endpoint := cassetteBase + "/api/player/disc-pool?" + q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("Authorization", "Bearer "+liveState.BearerToken)

	resp, err := (&http.Client{Timeout: poolReadTimeout}).Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil
	}

	var hit sharedPoolHit
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&hit); err != nil {
		return nil
	}
	if !hit.Found || hit.MBDiscID == "" {
		return nil
	}
	return &hit
}
