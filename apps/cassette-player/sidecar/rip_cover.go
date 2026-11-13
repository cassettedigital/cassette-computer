// Cover art + iTunes lookups (JOB 2 cover, JOB 3 fallback, JOB 4 search source).
//
// Identification gets a ripped album its name; this gets it a face. Two free,
// keyless, rate-limited sources, consumed for DISPLAY ONLY (per
// CASSETTE_OPEN_DATA_CONTRIBUTION.md, cover art is never contributed back):
//
//   - Cover Art Archive (CAA), keyed by the MusicBrainz release MBID.
//   - the iTunes Search API, keyed by artist+album — the fallback when CAA is
//     empty or there's no MBID, closing the gap where even Apple's own art is
//     reachable but MusicBrainz's isn't.
//
// The iTunes Search API also backs JOB 4's text search (album lookup → tracks).
// All of it shares sharedHTTPClient and a polite limiter — no duplicate clients.

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	caaBase     = "https://coverartarchive.org"
	itunesBase  = "https://itunes.apple.com"
	itunesLimit = 8
)

// coverLimiter holds CAA + iTunes API calls to a polite 1 req/sec (same limiter
// pattern as MusicBrainz/gnudb, separate instance — different hosts).
var coverLimiter = &mbLimiter{interval: time.Second}

// getJSON does one rate-limited JSON GET through the shared client.
func getJSON(limiter *mbLimiter, endpoint string, v any) error {
	if limiter != nil {
		_ = limiter.Wait(context.Background())
	}
	req, _ := http.NewRequest(http.MethodGet, endpoint, nil)
	req.Header.Set("User-Agent", mbUserAgent)
	req.Header.Set("Accept", "application/json")
	resp, err := sharedHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d from %s", resp.StatusCode, endpoint)
	}
	return json.NewDecoder(resp.Body).Decode(v)
}

// ── Cover fetch (JOB 2 + JOB 3) ──────────────────────────────────────────────

// fetchReleaseCover returns front-cover image bytes for a release, trying
// sources in order of precision: Cover Art Archive on the disc's EXACT release
// edition; then CAA on the release's RELEASE-GROUP (BUG-363 — the edition you
// hold may carry no art of its own yet while a sibling edition, e.g. digital,
// already does; MusicBrainz groups those under one release-group, and CAA
// separately tracks art at that level too); then the iTunes Search API (by
// artist+album — the least precise, since it's name-matched, not MBID-matched).
// ok is false when nothing has art. Display-only; never contributed.
func fetchReleaseCover(rel *MatchedRelease) (data []byte, mime string, ok bool) {
	if rel == nil {
		return nil, "", false
	}
	if rel.ReleaseMBID != "" {
		if d, m, got := caaFrontCover(rel.ReleaseMBID); got {
			return d, m, true
		}
	}
	if rel.ReleaseGroupMBID != "" {
		if d, m, got := caaFrontCoverByReleaseGroup(rel.ReleaseGroupMBID); got {
			return d, m, true
		}
	}
	if coverURL, got := itunesCoverURL(rel.AlbumArtist, rel.Album); got {
		if d, m, err := downloadImage(coverURL); err == nil && len(d) > 0 {
			return d, m, true
		}
	}
	return nil, "", false
}

// discOwnCover is the disc's own cover, for the folder a rip just made (BUG-919): first the one the rip
// panel showed, asked of the cloud the same way (lookupDiscCoverURL: the disc's release and name, never
// the album the library later files it as), else the disc's release straight from the Cover Art Archive
// (fetchReleaseCover: the release, its release group, then the name-checked iTunes art). triedRelease
// says the second was asked, so the end of the rip doesn't ask it again. A disc we couldn't name at all
// has no cover of its own to ask for.
func discOwnCover(rel *MatchedRelease) (data []byte, mime string, ok bool, triedRelease bool) {
	if rel == nil || rel.NeedsNaming || (rel.ReleaseMBID == "" && strings.TrimSpace(rel.Album) == "") {
		return nil, "", false, false
	}
	if u, err := lookupDiscCoverURL(rel.ReleaseMBID, rel.Album, rel.AlbumArtist); err == nil && u != "" {
		if d, m, derr := downloadImage(u); derr == nil && len(d) > 0 {
			return d, m, true, false
		}
	}
	d, m, got := fetchReleaseCover(rel)
	return d, m, got, true
}

// caaFrontURL is the deterministic Cover Art Archive front-image URL for a
// release MBID — a stable redirect endpoint, so the crosswalk can record a cover
// URL without spending a fetch. Empty for a release with no MBID.
func caaFrontURL(releaseMBID string) string {
	if releaseMBID == "" {
		return ""
	}
	return fmt.Sprintf("%s/release/%s/front", caaBase, url.PathEscape(releaseMBID))
}

// caaFrontCover downloads the Cover Art Archive front image for a release MBID.
// CAA 302-redirects /front to the actual image; downloadImage follows it.
func caaFrontCover(releaseMBID string) (data []byte, mime string, ok bool) {
	endpoint := fmt.Sprintf("%s/release/%s/front", caaBase, url.PathEscape(releaseMBID))
	d, m, err := downloadImage(endpoint)
	if err != nil || len(d) == 0 {
		return nil, "", false
	}
	return d, m, true
}

// caaFrontCoverByReleaseGroup downloads the Cover Art Archive front image filed
// against a RELEASE-GROUP rather than one specific release edition — CAA tracks
// art at both levels, and a release-group's cover can exist (contributed against
// a different edition of the same album) even when the exact edition you hold
// has none. Same shape as caaFrontCover, different CAA endpoint.
func caaFrontCoverByReleaseGroup(releaseGroupMBID string) (data []byte, mime string, ok bool) {
	endpoint := fmt.Sprintf("%s/release-group/%s/front", caaBase, url.PathEscape(releaseGroupMBID))
	d, m, err := downloadImage(endpoint)
	if err != nil || len(d) == 0 {
		return nil, "", false
	}
	return d, m, true
}

// itunesCoverURL finds the highest-resolution iTunes artwork for an album. The
// search returns artworkUrl100 (a 100×100 URL); its size segment upsizes by
// substitution.
//
// GUARDED: the free-text search readily ranks a sibling single/EP first — e.g.
// iTunes lists Petey's artist as "Petey USA", so the term "Petey USA" matches the
// ARTIST and a "Like a Mantra - Single" wins results[0], which the old blind
// results[0] return then stamped onto the "USA" album as the wrong cover. We now
// accept ONLY a result whose ALBUM matches the request (under the resolver's
// foldGroupText normalization — the load-bearing check, since the wrong sibling is
// a different collection name) AND whose ARTIST is compatible (exact fold, or one
// name contains the other, so the "Petey USA" vs "Petey" naming quirk doesn't
// reject the correct album). No match → no cover; a placeholder beats a confident
// wrong cover.
func itunesCoverURL(artist, album string) (string, bool) {
	results, err := itunesSearchAlbums(strings.TrimSpace(artist + " " + album))
	if err != nil || len(results) == 0 {
		return "", false
	}
	wantAlbum := foldGroupText(album)
	wantArtist := foldGroupText(artist)
	for _, r := range results {
		if r.ArtworkUrl100 == "" {
			continue
		}
		if foldGroupText(r.CollectionName) != wantAlbum {
			continue // different album (the wrong-cover defect) → reject
		}
		gotArtist := foldGroupText(r.ArtistName)
		if gotArtist != wantArtist &&
			!strings.Contains(gotArtist, wantArtist) &&
			!strings.Contains(wantArtist, gotArtist) {
			continue // album matches but a different artist → reject
		}
		// "…/100x100bb.jpg" → "…/1200x1200bb.jpg". Safe even if the pattern is absent.
		return strings.Replace(r.ArtworkUrl100, "100x100", "1200x1200", 1), true
	}
	return "", false
}

// ── iTunes Search API (cover + JOB 4 text search) ────────────────────────────

type itunesEntry struct {
	WrapperType     string `json:"wrapperType"` // "collection" | "track"
	CollectionID    int64  `json:"collectionId"`
	ArtistName      string `json:"artistName"`
	CollectionName  string `json:"collectionName"`
	TrackName       string `json:"trackName"`
	TrackNumber     int    `json:"trackNumber"`
	TrackTimeMillis int    `json:"trackTimeMillis"`
	TrackCount      int    `json:"trackCount"`
	ArtworkUrl100   string `json:"artworkUrl100"`
	ReleaseDate     string `json:"releaseDate"`
}

type itunesResponse struct {
	Results []itunesEntry `json:"results"`
}

// itunesSearchAlbums runs an album search by free-text term.
func itunesSearchAlbums(term string) ([]itunesEntry, error) {
	if strings.TrimSpace(term) == "" {
		return nil, fmt.Errorf("empty term")
	}
	endpoint := fmt.Sprintf("%s/search?term=%s&entity=album&limit=%d",
		itunesBase, url.QueryEscape(term), itunesLimit)
	var out itunesResponse
	if err := getJSON(coverLimiter, endpoint, &out); err != nil {
		return nil, err
	}
	return out.Results, nil
}

// itunesAlbumTracks looks up an album's tracklist by collection id.
func itunesAlbumTracks(collectionID int64) []itunesEntry {
	endpoint := fmt.Sprintf("%s/lookup?id=%d&entity=song", itunesBase, collectionID)
	var out itunesResponse
	if err := getJSON(coverLimiter, endpoint, &out); err != nil {
		return nil
	}
	var tracks []itunesEntry
	for _, r := range out.Results {
		if r.WrapperType == "track" {
			tracks = append(tracks, r)
		}
	}
	return tracks
}

// itunesReleasesByText turns an album-search term into candidate MatchedReleases
// (JOB 4): for each album whose track count is within tolerance of the TOC, look
// up its tracklist. No MBID (iTunes isn't MusicBrainz) — cross-resolve may
// attach one later. Bounded by itunesFetchCap reads.
func itunesReleasesByText(term string, tocTrackCount int, tolerance int) []*MatchedRelease {
	albums, err := itunesSearchAlbums(term)
	if err != nil {
		return nil
	}
	var out []*MatchedRelease
	fetched := 0
	for _, a := range albums {
		if a.WrapperType != "collection" || a.CollectionID == 0 {
			continue
		}
		if a.TrackCount != 0 {
			diff := a.TrackCount - tocTrackCount
			if diff < 0 {
				diff = -diff
			}
			if diff > tolerance {
				continue // cheap pre-filter
			}
		}
		if fetched >= itunesFetchCap {
			break
		}
		fetched++
		tracks := itunesAlbumTracks(a.CollectionID)
		trackDiff := len(tracks) - tocTrackCount
		if trackDiff < 0 {
			trackDiff = -trackDiff
		}
		if trackDiff > tolerance {
			continue
		}
		rel := &MatchedRelease{
			Album:       a.CollectionName,
			AlbumArtist: a.ArtistName,
			Date:        yearOf(a.ReleaseDate),
			TrackCount:  len(tracks),
		}
		for _, t := range tracks {
			rel.Tracks = append(rel.Tracks, RippedTrackMeta{
				Position: t.TrackNumber,
				Title:    t.TrackName,
				Artist:   firstNonEmpty(t.ArtistName, a.ArtistName),
				LengthMs: t.TrackTimeMillis,
			})
		}
		out = append(out, rel)
	}
	return out
}

const itunesFetchCap = 3

// yearOf pulls the leading YYYY off an ISO date ("2003-09-23T…" → "2003").
func yearOf(date string) string {
	if len(date) >= 4 {
		return date[:4]
	}
	return date
}
