// Catalog-cover fallback for Fast Album Art.
//
// When an album carries no embedded art, we materialize its cover from our
// OWN already-imported catalog cover instead — a cheap GET of an asset we
// already own. This is NOT the gated demand-import path: the backend lookup
// (/api/player/album-cover) is strictly read-only and returns a cover only
// when one is already stored (cover_art_url populated). It never triggers a
// Cover Art Archive / MusicBrainz fetch, so the cost rails stay intact.
//
// Best-effort throughout: any miss or error returns ok=false and the album
// simply stays cover-less (the desktop edge path / a later pass can still
// cover it). A per-album negative cache keeps the hourly resolver pass from
// re-querying albums that genuinely have no catalog cover.

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"sync"
	"time"
)

// coverCheckTTL bounds how often we re-ask the backend about an album whose
// catalog cover we couldn't get, so a coverless album isn't re-queried on
// every resolver pass. Successful materializations are skipped earlier by
// hasFolderCover, so this only paces the genuine misses.
const coverCheckTTL = 24 * time.Hour

// maxCoverBytes caps a cover download. Set generously: catalog originals can be
// high-resolution (a 6000×6000 PNG runs tens of MB) and normalizeCover
// downscales whatever we fetch to <= coverMaxSide for storage anyway. When the cap is
// exceeded we REJECT the download rather than truncate — a truncated image is a
// corrupt cover (the bug that left a 25 MiB partial cover.png on a 6000×6000
// source, which then rendered black/missing on the phone).
const maxCoverBytes = 128 << 20 // 128 MB

var (
	coverCheckedMu sync.Mutex
	coverCheckedAt = map[string]time.Time{} // album dir -> last catalog-cover attempt
)

// catalogCoverForTrack fetches the album's already-owned catalog cover from
// the backend (read-only lookup) and returns the raw image bytes. Returns
// ok=false on any miss/error, and is negative-cached per album dir.
func catalogCoverForTrack(trackPath string) (data []byte, mime string, ok bool) {
	// Needs a paired backend session to authenticate the lookup.
	if liveState == nil || liveState.BearerToken == "" {
		return nil, "", false
	}
	dir := filepath.Dir(trackPath)
	if !coverCheckDue(dir) {
		return nil, "", false
	}
	coverMarkChecked(dir)

	tags, err := readTags(trackPath)
	if err != nil || tags.Artist == "" || tags.Album == "" {
		return nil, "", false
	}

	coverURL, err := lookupCatalogCoverURL(tags.Artist, tags.Album)
	if err != nil || coverURL == "" {
		return nil, "", false
	}

	data, mime, err = downloadImage(coverURL)
	if err != nil || len(data) == 0 {
		return nil, "", false
	}
	return data, mime, true
}

func coverCheckDue(dir string) bool {
	coverCheckedMu.Lock()
	defer coverCheckedMu.Unlock()
	last, seen := coverCheckedAt[dir]
	return !seen || time.Since(last) >= coverCheckTTL
}

func coverMarkChecked(dir string) {
	coverCheckedMu.Lock()
	defer coverCheckedMu.Unlock()
	coverCheckedAt[dir] = time.Now()
}

// lookupCatalogCoverURL asks the backend for an album's stored cover URL.
// Read-only: the endpoint never triggers an upstream import.
func lookupCatalogCoverURL(artist, album string) (string, error) {
	endpoint := fmt.Sprintf(
		"%s/api/player/album-cover?artist=%s&album=%s",
		cassetteBase,
		url.QueryEscape(artist),
		url.QueryEscape(album),
	)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+liveState.BearerToken)
	req.Header.Set("Accept", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("album-cover lookup HTTP %d", resp.StatusCode)
	}
	var body struct {
		CoverURL string `json:"cover_url"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&body); err != nil {
		return "", err
	}
	return body.CoverURL, nil
}

// lookupDiscCoverURL asks the cloud for the cover the rip panel shows for this disc: the same question
// (GET /api/catalog/disc-cover, the disc's release MBID, album and album artist, as lib/rip-status
// resolveDiscCover sends them) and so the same answer, which never depends on how the library later
// files the rip (BUG-919). Read-only on the cloud side. "" with no answer, no sign-in or no cover.
func lookupDiscCoverURL(releaseMBID, album, artist string) (string, error) {
	if liveState == nil || liveState.BearerToken == "" {
		return "", fmt.Errorf("not signed in")
	}
	q := url.Values{}
	if releaseMBID != "" {
		q.Set("releaseMbid", releaseMBID)
	}
	if album != "" {
		q.Set("album", album)
	}
	if artist != "" {
		q.Set("artist", artist)
	}
	if len(q) == 0 {
		return "", nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cassetteBase+"/api/catalog/disc-cover?"+q.Encode(), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+liveState.BearerToken)
	req.Header.Set("Accept", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("disc-cover lookup HTTP %d", resp.StatusCode)
	}
	var body struct {
		CoverURL string `json:"coverUrl"`
		// the same picture at the address to fetch the file from (the media host for our own copies);
		// a cloud from before it was added sends only coverUrl
		FileURL string `json:"fileUrl"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&body); err != nil {
		return "", err
	}
	if body.FileURL != "" {
		return body.FileURL, nil
	}
	return body.CoverURL, nil
}

// downloadImage GETs an image URL and returns its bytes + Content-Type.
func downloadImage(rawURL string) ([]byte, string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("cover download HTTP %d", resp.StatusCode)
	}
	// Read one byte past the cap so an oversized response can be DETECTED and
	// rejected, instead of silently truncated into a corrupt, half-written image.
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxCoverBytes+1))
	if err != nil {
		return nil, "", err
	}
	if len(data) > maxCoverBytes {
		return nil, "", fmt.Errorf(
			"cover exceeds %d bytes — refusing to store a truncated image", maxCoverBytes,
		)
	}
	return data, resp.Header.Get("Content-Type"), nil
}

// coverForceRecheck clears the negative-cache entry for an album dir so the next
// pass re-queries the catalog cover even if it was checked within coverCheckTTL.
// Used by the corrupt-cover heal: a cover we must replace has to be re-fetched.
func coverForceRecheck(dir string) {
	coverCheckedMu.Lock()
	defer coverCheckedMu.Unlock()
	delete(coverCheckedAt, dir)
}
