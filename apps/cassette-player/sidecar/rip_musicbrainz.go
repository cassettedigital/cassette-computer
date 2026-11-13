// MusicBrainz disc lookup (Chunk 3).
//
// Given a Disc ID, resolve it to a release and a per-track tag mapping
// (position → title, artist, recording MBID). This is what lets a ripped track
// land already tagged with its portable MusicBrainz identity, so the existing
// sidecar resolver/library-sync recognise it immediately.
//
// Endpoint: GET /ws/2/discid/{id}?inc=recordings+artist-credits&fmt=json

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// CD-TEXT release-search budget (rung 2). Kept small: a rip is one disc at a
// time, but each candidate costs a tracklist fetch, so we search a few and
// fetch at most cdtextFetchCap of the plausible ones.
const (
	cdtextSearchLimit = 8
	cdtextFetchCap    = 3
)

// RippedTrackMeta is the tag mapping for one track of the matched release.
type RippedTrackMeta struct {
	Position      int
	Title         string
	Artist        string
	RecordingMBID string
	LengthMs      int
	// LocalID is the Cassette cross-device track identity (artist‖title‖dur
	// hash). Always derivable from the tags, but populated up-front for the
	// IMPORT-ANYWAY path so an unidentified track carries a stable identity the
	// moment it lands. Empty for MusicBrainz-matched tracks (the MBID is their
	// identity; the resolver computes the local ID downstream either way).
	LocalID string
}

// MatchedRelease is the album-level metadata for a disc, plus its tracklist
// (only the medium whose disc matched the Disc ID).
type MatchedRelease struct {
	ReleaseMBID      string
	ReleaseGroupMBID string // the album across all its pressings — the picker's grouping key
	Album            string
	AlbumArtist      string
	Date             string
	DiscID           string
	GnudbID          string // gnudb entry "category/discid", set when gnudb proposed this release (crosswalk)
	MediumPos        int
	MediumTitle      string // med.Title — e.g. "fABLE", "Demos"; "" when MB has none
	MediumCount      int    // len(rel.Media) — total discs in the release
	TrackCount       int
	Tracks           []RippedTrackMeta
	// Unidentified marks a release that carries no MusicBrainz identity — the
	// IMPORT-ANYWAY local identity built from the TOC (+ CD-TEXT when present).
	// NeedsNaming is true only when we couldn't even name the album, so a future
	// edit feature can target it. Both false for any MB-resolved release.
	Unidentified bool
	NeedsNaming  bool
}

// ── MB JSON shapes (only the fields we use) ──────────────────────────────────

type mbArtistCredit struct {
	Name       string `json:"name"`
	JoinPhrase string `json:"joinphrase"`
}

func joinCredits(cs []mbArtistCredit) string {
	out := ""
	for _, c := range cs {
		out += c.Name + c.JoinPhrase
	}
	return out
}

type mbTrack struct {
	Position     int              `json:"position"`
	Number       string           `json:"number"`
	Title        string           `json:"title"`
	Length       int              `json:"length"`
	ArtistCredit []mbArtistCredit `json:"artist-credit"`
	Recording    struct {
		ID     string           `json:"id"`
		Title  string           `json:"title"`
		Length int              `json:"length"`
		AC     []mbArtistCredit `json:"artist-credit"`
	} `json:"recording"`
}

type mbMedium struct {
	Position int       `json:"position"`
	Title    string    `json:"title"`
	Format   string    `json:"format"`
	Discs    []struct {
		ID string `json:"id"`
	} `json:"discs"`
	Tracks []mbTrack `json:"tracks"`
}

type mbRelease struct {
	ID           string           `json:"id"`
	Title        string           `json:"title"`
	Date         string           `json:"date"`
	ArtistCredit []mbArtistCredit `json:"artist-credit"`
	Media        []mbMedium       `json:"media"`
	ReleaseGroup struct {
		ID string `json:"id"`
	} `json:"release-group"`
}

type mbDiscResponse struct {
	ID       string      `json:"id"`
	Releases []mbRelease `json:"releases"`
	Error    string      `json:"error"`
}

// mbReleaseSearchResponse mirrors the /release search endpoint, which returns
// stub media (track counts, no tracklists) — enough to pre-filter by track
// count before fetching a full tracklist per candidate.
type mbReleaseSearchResponse struct {
	Releases []struct {
		ID    string           `json:"id"`
		Title string           `json:"title"`
		Media []mbSearchMedium `json:"media"`
	} `json:"releases"`
}

type mbSearchMedium struct {
	Format     string `json:"format"`
	TrackCount int    `json:"track-count"`
}

// ripMBLimiter holds the rip-path MusicBrainz requests to the 1 req/sec polite
// ceiling — the SAME limiter type and interval the file-scan resolver uses, so
// the multi-request confidence ladder (disc-id → fuzzy TOC → CD-TEXT search)
// never bursts MusicBrainz. A rip is user-present and one-disc-at-a-time, so a
// handful of serialized requests per inserted disc is well within bounds; this
// just keeps them polite. Never run these on a timer or in bulk.
var ripMBLimiter = &mbLimiter{interval: mbRequestInterval}

// mbGet performs one rate-limited MusicBrainz GET with the shared user agent.
// The single MB client for the rip path — disc-id, fuzzy-TOC, and release
// lookups all funnel through here (no second client, per spec).
func mbGet(endpoint string) (body []byte, status int, err error) {
	_ = ripMBLimiter.Wait(context.Background())
	req, _ := http.NewRequest(http.MethodGet, endpoint, nil)
	req.Header.Set("User-Agent", mbUserAgent)
	req.Header.Set("Accept", "application/json")
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	body, _ = io.ReadAll(resp.Body)
	return body, resp.StatusCode, nil
}

// lookupDiscID resolves a Disc ID to its best release match and all candidates.
// "best" = the first release with a medium that both carries this Disc ID and
// whose track count equals the TOC's; falls back to the first release. This is
// rung 1 of the ladder (resolveDisc) and the exact-match happy path — unchanged.
func lookupDiscID(discID string, tocTrackCount int) (best *MatchedRelease, candidates []*MatchedRelease, err error) {
	endpoint := fmt.Sprintf("%s/discid/%s?inc=recordings+artist-credits&fmt=json",
		mbAPIBase, url.PathEscape(discID))
	body, status, err := mbGet(endpoint)
	if err != nil {
		return nil, nil, fmt.Errorf("musicbrainz disc lookup: %w", err)
	}
	if status == http.StatusNotFound {
		return nil, nil, fmt.Errorf("disc id %q not found in MusicBrainz", discID)
	}
	if status != http.StatusOK {
		return nil, nil, fmt.Errorf("musicbrainz returned %d: %.200s", status, body)
	}

	var parsed mbDiscResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, nil, fmt.Errorf("parse musicbrainz response: %w", err)
	}
	if parsed.Error != "" {
		return nil, nil, fmt.Errorf("musicbrainz: %s", parsed.Error)
	}
	if len(parsed.Releases) == 0 {
		return nil, nil, fmt.Errorf("disc id %q has no releases", discID)
	}

	for _, rel := range parsed.Releases {
		med := mediumForDisc(rel, discID)
		if med == nil {
			continue
		}
		candidates = append(candidates, buildMatchedRelease(rel, med, discID))
	}
	if len(candidates) == 0 {
		return nil, nil, fmt.Errorf("no medium on any release carries disc id %q", discID)
	}

	best = candidates[0]
	for _, c := range candidates {
		if c.TrackCount == tocTrackCount {
			best = c
			break
		}
	}
	return best, candidates, nil
}

// fuzzyTOCLookup is rung 1.5: MusicBrainz's own fuzzy TOC match
// (/ws/2/discid/-?toc=…). It catches discs that ARE in MusicBrainz but never
// had a disc ID submitted — no CD-TEXT seed required — and returns full
// tracklists inline, so it's a single request. Each release is scored by
// resolveDisc. Returns nil on any failure (best-effort signal, never a gate).
//
// (gnudb/CDDB would slot in here as another text-free source for discs MB has
// never seen at all; this proves the candidate-source shape it'd plug into.)
func fuzzyTOCLookup(toc *TOC) []*MatchedRelease {
	n := toc.LastTrack - toc.FirstTrack + 1
	endpoint := mbAPIBase + "/discid/-?toc=" + tocQueryParam(toc) +
		"&inc=recordings+artist-credits&fmt=json"
	body, status, err := mbGet(endpoint)
	if err != nil || status != http.StatusOK {
		return nil
	}
	var parsed mbDiscResponse
	if json.Unmarshal(body, &parsed) != nil {
		return nil
	}
	var out []*MatchedRelease
	for _, rel := range parsed.Releases {
		// The fuzzy lookup gives no specific disc ID; pick the medium whose track
		// count matches the TOC.
		med := pickMedium(rel, "", n)
		if med == nil {
			continue
		}
		out = append(out, buildMatchedRelease(rel, med, ""))
	}
	return out
}

// searchReleasesByCDText is rung 2: a text-seeded MusicBrainz /release search
// using the CD-TEXT album (+ artist when present), then a bounded tracklist
// fetch for the few releases whose track count could match. Catches discs with
// CD-TEXT that the disc-id and fuzzy-TOC rungs missed. Bounded by
// cdtextFetchCap to keep the request count (and MB load) small.
func searchReleasesByCDText(artist, album string, tocTrackCount int) []*MatchedRelease {
	if album == "" {
		return nil
	}
	q := fmt.Sprintf(`release:"%s"`, escapeLuceneQuoted(album))
	if artist != "" {
		q += fmt.Sprintf(` AND artist:"%s"`, escapeLuceneQuoted(artist))
	}
	return searchReleasesMB(q, tocTrackCount, 0)
}

// searchReleasesByText runs a free-text MusicBrainz release search (JOB 4 manual
// search + JOB 2 cross-resolve). The query is the user's raw words; MB tokenizes
// it across release/artist fields. tolerance allows ±N track-count near-misses
// (0 = exact only; 1 = lenient manual-search mode).
func searchReleasesByText(query string, tocTrackCount int, tolerance int) []*MatchedRelease {
	if strings.TrimSpace(query) == "" {
		return nil
	}
	return searchReleasesMB(query, tocTrackCount, tolerance)
}

// searchReleasesMB is the shared /release search → bounded tracklist-fetch loop
// behind both the CD-TEXT and free-text searches. lucene is the query value.
func searchReleasesMB(lucene string, tocTrackCount int, tolerance int) []*MatchedRelease {
	endpoint := fmt.Sprintf("%s/release?query=%s&fmt=json&limit=%d",
		mbAPIBase, url.QueryEscape(lucene), cdtextSearchLimit)
	body, status, err := mbGet(endpoint)
	if err != nil || status != http.StatusOK {
		return nil
	}
	var sr mbReleaseSearchResponse
	if json.Unmarshal(body, &sr) != nil {
		return nil
	}

	var out []*MatchedRelease
	fetched := 0
	for _, r := range sr.Releases {
		if fetched >= cdtextFetchCap {
			break
		}
		// Skip releases that can't possibly match the disc before spending a
		// fetch on them.
		if !searchReleaseMightMatch(r.Media, tocTrackCount, tolerance) {
			continue
		}
		fetched++
		if rel := fetchReleaseTracklist(r.ID, tocTrackCount); rel != nil {
			out = append(out, rel)
		}
	}
	return out
}

// fetchReleaseTracklist pulls one release's full tracklist (the /release search
// endpoint returns only stub media) and builds a MatchedRelease from the medium
// whose track count matches the TOC. nil on any failure.
func fetchReleaseTracklist(releaseMBID string, tocTrackCount int) *MatchedRelease {
	endpoint := fmt.Sprintf("%s/release/%s?inc=recordings+artist-credits+discids+release-groups&fmt=json",
		mbAPIBase, url.PathEscape(releaseMBID))
	body, status, err := mbGet(endpoint)
	if err != nil || status != http.StatusOK {
		return nil
	}
	var rel mbRelease
	if json.Unmarshal(body, &rel) != nil {
		return nil
	}
	med := pickMedium(rel, "", tocTrackCount)
	if med == nil {
		return nil
	}
	return buildMatchedRelease(rel, med, "")
}

// fetchReleaseMedium pulls release R and builds a MatchedRelease from the medium
// that best fits THIS disc, for the multi-disc sibling bias (BUG-261): the medium
// registering discID when R lists it, else — among media whose track count equals
// the disc's — the one whose track durations best align to tocDurMs. Returns nil
// when no medium fits the disc's track count, so the caller REFUSES rather than
// force a fallback medium onto the wrong disc. One bounded MB call.
func fetchReleaseMedium(releaseMBID, discID string, tocTrackCount int, tocDurMs []int) *MatchedRelease {
	endpoint := fmt.Sprintf("%s/release/%s?inc=recordings+artist-credits+discids+release-groups&fmt=json",
		mbAPIBase, url.PathEscape(releaseMBID))
	body, status, err := mbGet(endpoint)
	if err != nil || status != http.StatusOK {
		return nil
	}
	var rel mbRelease
	if json.Unmarshal(body, &rel) != nil {
		return nil
	}
	med := bestMediumForDisc(rel, discID, tocTrackCount, tocDurMs)
	if med == nil {
		return nil // no medium fits this disc's track count — refuse (no fallback)
	}
	return buildMatchedRelease(rel, med, discID)
}

// bestMediumForDisc chooses the medium of R that IS this disc, for the sibling
// bias: the medium registering discID (unambiguous, even in a box set where discs
// share a track count), else — among media matching the disc's track count — the
// best duration fit. nil when no medium matches the track count, so the caller
// refuses rather than forcing a wrong medium. Pure; the HTTP fetch is its caller's.
func bestMediumForDisc(rel mbRelease, discID string, trackCount int, tocDurMs []int) *mbMedium {
	if discID != "" {
		if med := mediumForDisc(rel, discID); med != nil {
			return med
		}
	}
	var best *mbMedium
	var bestScore float64
	for i := range rel.Media {
		if len(rel.Media[i].Tracks) != trackCount {
			continue
		}
		if s := durationAlignment(buildMatchedRelease(rel, &rel.Media[i], ""), tocDurMs); best == nil || s > bestScore {
			best, bestScore = &rel.Media[i], s
		}
	}
	return best
}

// buildMatchedRelease turns one MB release + a chosen medium into a
// MatchedRelease with a fully populated tag mapping. Shared by every candidate
// source so they produce identical shapes. discID is stamped onto the result
// when known (disc-id rung); for fuzzy/text rungs it's filled in by the caller
// from the physical TOC.
func buildMatchedRelease(rel mbRelease, med *mbMedium, discID string) *MatchedRelease {
	m := &MatchedRelease{
		ReleaseMBID:      rel.ID,
		ReleaseGroupMBID: rel.ReleaseGroup.ID,
		Album:            rel.Title,
		AlbumArtist:      joinCredits(rel.ArtistCredit),
		Date:             rel.Date,
		DiscID:           discID,
		MediumPos:        med.Position,
		MediumTitle:      med.Title,
		MediumCount:      len(rel.Media),
		TrackCount:       len(med.Tracks),
	}
	for _, t := range med.Tracks {
		artist := joinCredits(t.ArtistCredit)
		if artist == "" {
			artist = joinCredits(t.Recording.AC)
		}
		if artist == "" {
			artist = m.AlbumArtist
		}
		length := t.Length
		if length == 0 {
			length = t.Recording.Length
		}
		m.Tracks = append(m.Tracks, RippedTrackMeta{
			Position:      t.Position,
			Title:         firstNonEmpty(t.Title, t.Recording.Title),
			Artist:        artist,
			RecordingMBID: t.Recording.ID,
			LengthMs:      length,
		})
	}
	return m
}

// pickMedium chooses the medium to treat as "the disc". Preference order:
// the medium carrying discID (exact), then the first medium whose track count
// equals trackCount (fuzzy/text), then the first medium. nil only when the
// release has no media.
func pickMedium(rel mbRelease, discID string, trackCount int) *mbMedium {
	if discID != "" {
		if med := mediumForDisc(rel, discID); med != nil {
			return med
		}
	}
	for i := range rel.Media {
		if len(rel.Media[i].Tracks) == trackCount {
			return &rel.Media[i]
		}
	}
	if len(rel.Media) > 0 {
		return &rel.Media[0]
	}
	return nil
}

// searchReleaseMightMatch reports whether any of a search result's stub media
// is within tolerance tracks of trackCount — a cheap pre-filter before fetching
// the tracklist. An empty media list passes through (MB sometimes omits stub
// media; let the full fetch decide).
func searchReleaseMightMatch(media []mbSearchMedium, trackCount int, tolerance int) bool {
	if len(media) == 0 {
		return true
	}
	for _, m := range media {
		diff := m.TrackCount - trackCount
		if diff < 0 {
			diff = -diff
		}
		if diff <= tolerance {
			return true
		}
	}
	return false
}

// tocQueryParam formats a TOC as MusicBrainz's `toc=` value:
// first+last+leadout+offset1+offset2+… (literal '+', matching mbTOCLookupURL).
func tocQueryParam(toc *TOC) string {
	parts := fmt.Sprintf("%d+%d+%d", toc.FirstTrack, toc.LastTrack, toc.LeadoutOffset)
	for _, o := range toc.TrackOffsets {
		parts += fmt.Sprintf("+%d", o)
	}
	return parts
}

// mediumForDisc finds the medium on a release whose disc list contains discID.
func mediumForDisc(rel mbRelease, discID string) *mbMedium {
	for i := range rel.Media {
		for _, d := range rel.Media[i].Discs {
			if d.ID == discID {
				return &rel.Media[i]
			}
		}
	}
	return nil
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}
