// Artist-photo materialization — the artist parallel of Fast Album Art.
//
// Album covers materialize a local folder cover; this does the same for the
// ARTIST photo, one directory level up (the artist folder shared by all of that
// artist's album folders). Source is our OWN already-stored catalog artist image
// (a read-only /api/player/artist-photo lookup — it never triggers an upstream
// Wikidata/Commons fetch), fetched once and written as artist.<ext>. So the
// artist wall renders instantly + offline on desktop, matching album covers, and
// the on-disk file is the user's canvas (the existing
// /api/library/artist-photo/replace door overwrites it to tune the library look).
//
// Music files embed ALBUM art, never artist portraits, so unlike album covers
// there is NO embedded-art source — only the catalog. A miss leaves the artist
// photo-less (the UI falls back to the catalog image), exactly like a coverless
// album. Best-effort throughout; negative-cached per artist dir.

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const artistPhotoCheckTTL = 24 * time.Hour

var (
	artistPhotoCheckedMu sync.Mutex
	artistPhotoCheckedAt = map[string]time.Time{} // artist dir -> last catalog-photo attempt
)

func artistPhotoCheckDue(dir string) bool {
	artistPhotoCheckedMu.Lock()
	defer artistPhotoCheckedMu.Unlock()
	last, seen := artistPhotoCheckedAt[dir]
	return !seen || time.Since(last) >= artistPhotoCheckTTL
}

func artistPhotoMarkChecked(dir string) {
	artistPhotoCheckedMu.Lock()
	defer artistPhotoCheckedMu.Unlock()
	artistPhotoCheckedAt[dir] = time.Now()
}

func artistPhotoForceRecheck(dir string) {
	artistPhotoCheckedMu.Lock()
	defer artistPhotoCheckedMu.Unlock()
	delete(artistPhotoCheckedAt, dir)
}

// lookupCatalogArtistPhotoURL asks the backend for an artist's stored PRIMARY
// image URL — the artist parallel of lookupCatalogCoverURL. Read-only: the
// endpoint never triggers an upstream import.
func lookupCatalogArtistPhotoURL(artist string) (string, error) {
	endpoint := fmt.Sprintf("%s/api/player/artist-photo?artist=%s", cassetteBase, url.QueryEscape(artist))
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
		return "", fmt.Errorf("artist-photo lookup HTTP %d", resp.StatusCode)
	}
	var body struct {
		PhotoURL string `json:"photo_url"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&body); err != nil {
		return "", err
	}
	return body.PhotoURL, nil
}

// existingArtistPhotoPath mirrors existingFolderCoverPath with artistPhotoBaseNames
// ({"artist"}): the path of an existing artist.* in dir, or "" when none exists.
func existingArtistPhotoPath(dir string) string {
	return existingStemImagePath(dir, artistPhotoBaseNames)
}

// writeArtistFolderPhoto normalizes bytes to a native-ratio, capped image
// (normalizeCover) and writes artist.<ext> in dir — the exact contract of
// writeFolderCover, one stem. Full-decode verified before the atomic write. The
// caller guards on an existing photo, so this never clobbers a user's replaced
// artist.jpg.
//
// Native aspect, NOT square: the artist wall (web + desktop + iOS) frames every
// photo with object-fit: cover / aspectFill, which crops a rectangle to fill the
// circle. Padding the photo to a square first bakes brand-black bars into the
// file that the crop can't remove — they show inside the circle as letterboxing.
// Kept native, the crop fills. (Album covers made the same move off square-padding
// for the same reason.)
func writeArtistFolderPhoto(dir string, data []byte, mime string) (bool, error) {
	data, mime = normalizeCover(data, mime)
	if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
		return false, nil // header-valid but corrupt → write nothing, keep the placeholder
	}
	dst := filepath.Join(dir, "artist"+imageExt(mime, data))
	if err := atomicWriteFile(dst, data, 0o644); err != nil {
		return false, fmt.Errorf("write artist photo: %w", err)
	}
	return true, nil
}

// artistDirForTrack returns the artist FOLDER for a track WITHOUT requiring the
// exact track file to exist. resolveTrackPath rejects tracks whose title carries
// a filesystem-illegal char (e.g. "?" or ":") that gets stripped from the on-disk
// filename — but the artist folder (two levels up) is unaffected, and that's all
// we need. We take getSong's reported path, resolve it to an absolute path the
// same way resolveTrackPath does, walk two levels up, and require only that the
// DIRECTORY exists under the music root.
func artistDirForTrack(trackID string) (string, error) {
	p, err := getSongPath(trackID)
	if err != nil || p == "" {
		return "", fmt.Errorf("getSong path unavailable: %v", err)
	}
	if !filepath.IsAbs(p) {
		p = filepath.Join(sidecarMusicDir, p)
	}
	return artistDirForPath(p)
}

// artistDirForPath is artistDirForTrack for a track whose absolute path is already
// known. Every writer of artist.<ext> goes through it (the hourly pass, the
// on-demand serve, the replace door) so none of them can land in the library root
// or above it (BUG-787).
func artistDirForPath(p string) (string, error) {
	dir := filepath.Dir(filepath.Dir(p)) // {music}/{Artist}/{Album}/track → {Artist}
	if !underMusicRoot(dir) {
		return "", fmt.Errorf("artist dir %q outside music root", dir)
	}
	// THE LIBRARY ROOT IS NOT AN ARTIST FOLDER. Going up two levels only yields an
	// artist directory for the nested {Artist}/{Album}/track layout. A FLAT album
	// folder — "{music}/Bon Iver - SABLE, fABLE/track.flac", which is how imported
	// (non-ripped) albums land — lands on {music} itself, and the prefix check above
	// happily accepts it because the root is trivially inside the root.
	//
	// That wrote an artist photo to "{music}/artist.jpg", and Navidrome's
	// artistartpriority ("artist.*, album/artist.*") then served that ONE file as the
	// portrait of every artist whose folder resolves to the root — which is how Laufey
	// and Mitski ended up wearing Bon Iver's face on the phone.
	//
	// A flat album has no artist directory of its own, so fall back to the ALBUM
	// folder. That is not a workaround: Navidrome's artistartpriority is
	// "artist.*, album/artist.*", so an artist.* sitting INSIDE an album folder is a
	// first-class location it already looks in. The photo stays inside the album it
	// belongs to, and nothing is ever written to the library root.
	if filepath.Clean(dir) == filepath.Clean(sidecarMusicDir) {
		dir = filepath.Dir(p) // {music}/{Artist - Album}/track → {Artist - Album}
		if filepath.Clean(dir) == filepath.Clean(sidecarMusicDir) {
			return "", fmt.Errorf("track %q sits directly in the library root", p)
		}
	}
	// A SHARED FOLDER IS NOT AN ARTIST FOLDER EITHER (BUG-553). A grouping folder two levels up (imports,
	// compilations) holds albums by several artists; the first one's artist.* written there would be served for all
	// of them. When the albums inside are credited to more than one artist, use the album folder, as for the root.
	if filepath.Clean(dir) != filepath.Clean(filepath.Dir(p)) && !folderHoldsOneArtist(dir) {
		dir = filepath.Dir(p) // {music}/{Group}/{Album}/track → {Album}
	}
	if info, statErr := os.Stat(dir); statErr != nil || !info.IsDir() {
		return "", fmt.Errorf("artist dir %q not a directory: %v", dir, statErr)
	}
	return dir, nil
}

// artistNameFromDir reads the artist tag from the first readable audio file under
// artistDir. On-disk filenames are sanitized (illegal chars stripped) so they
// always exist, which is why we read a real file's tag rather than trust the
// title-derived track path. Empty when the folder has no readable audio.
func artistNameFromDir(artistDir string) string {
	var found string
	_ = filepath.WalkDir(artistDir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || found != "" {
			return nil
		}
		if !isSupportedAudio(p) {
			return nil
		}
		if tags, tErr := readTags(p); tErr == nil && tags.Artist != "" {
			found = tags.Artist
			return filepath.SkipAll
		}
		return nil
	})
	return found
}

// materializeArtistPhotoForDir writes artist.<ext> into artistDir when it has
// none, sourced from our catalog artist image (read-only lookup, negative-cached
// per artist dir). The artist name is read from a real file in the folder — not a
// passed track path — so it's robust to the filename-sanitization mismatch.
// Idempotent + best-effort: (false, nil) = nothing to do. An existing photo is
// never touched, even one that doesn't decode (BUG-775, same rule as album covers).
// Callers outside an explicit replace check folderArtAllowed first (BUG-786).
func materializeArtistPhotoForDir(artistDir string) (wrote bool, err error) {
	if existingArtistPhotoPath(artistDir) != "" {
		return false, nil
	}
	if liveState == nil || liveState.BearerToken == "" {
		return false, nil
	}
	if !artistPhotoCheckDue(artistDir) {
		return false, nil
	}
	artistPhotoMarkChecked(artistDir)

	artist := artistNameFromDir(artistDir)
	if artist == "" {
		return false, nil
	}
	photoURL, err := lookupCatalogArtistPhotoURL(artist)
	if err != nil || photoURL == "" {
		return false, nil
	}
	data, mime, err := downloadImage(photoURL)
	if err != nil || len(data) == 0 {
		return false, nil
	}
	return writeArtistFolderPhoto(artistDir, data, mime)
}

// padBarTolerance is the per-channel slack (0-255) for matching coverPadColor when
// detecting the black square-pad bars an OLD build baked into an artist photo. JPEG
// is lossy, so an exact match would miss; a real photo still won't fill a whole
// edge with near-brand-black, so a small tolerance keeps the test specific.
const padBarTolerance = 12

// nearPadColor reports whether a 16-bit-per-channel pixel (as returned by
// image.Image.At().RGBA()) is within tolerance of coverPadColor.
func nearPadColor(r, g, b uint32) bool {
	within := func(v uint32, target uint8) bool {
		d := int(v>>8) - int(target)
		if d < 0 {
			d = -d
		}
		return d <= padBarTolerance
	}
	return within(r, coverPadColor.R) && within(g, coverPadColor.G) && within(b, coverPadColor.B)
}

// artistPhotoHasPadBars reports whether the image at path is one WE squared in an
// old build: a square canvas with solid coverPadColor bars on two opposite edges —
// left+right for a portrait source, top+bottom for a landscape one. It checks the
// two outermost edge lines are ENTIRELY near-brand-black, which a person's own
// artist photo will not be, so the reheal strips bars only from art we baked and
// never overrides a photo the person chose. A native (non-square, or bar-free
// square) photo returns false and is left untouched.
func artistPhotoHasPadBars(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	if err != nil {
		return false
	}
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= 2 || h <= 2 || w != h { // our pad output was always square
		return false
	}
	colAllPad := func(x int) bool {
		for y := b.Min.Y; y < b.Max.Y; y++ {
			r, g, bl, _ := img.At(x, y).RGBA()
			if !nearPadColor(r, g, bl) {
				return false
			}
		}
		return true
	}
	rowAllPad := func(y int) bool {
		for x := b.Min.X; x < b.Max.X; x++ {
			r, g, bl, _ := img.At(x, y).RGBA()
			if !nearPadColor(r, g, bl) {
				return false
			}
		}
		return true
	}
	leftRightBars := colAllPad(b.Min.X) && colAllPad(b.Max.X-1)
	topBottomBars := rowAllPad(b.Min.Y) && rowAllPad(b.Max.Y-1)
	return leftRightBars || topBottomBars
}

// rehealArtistPhotos walks root and strips the black square-pad bars an OLD build
// baked into artist photos. For every artist.<ext> that artistPhotoHasPadBars it
// removes the file and re-materializes the photo at NATIVE aspect from our catalog
// (writeArtistFolderPhoto no longer pads), so the wall's crop fills the circle. A
// photo WITHOUT our bars — the person's own pick, or one already native — is left
// untouched, so this never overrides a choice. Opt-in only
// (SIDECAR_REHEAL_ARTIST_PHOTOS=1, for libraries an old build wrote into); the
// barred file goes to the Trash, and on a catalog miss the UI falls back to the
// (native, filling) catalog image. Returns
// (#artist photos seen, #rehealed).
func rehealArtistPhotos(root string) (seen, healed int) {
	_ = filepath.WalkDir(root, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil || d.IsDir() {
			return nil
		}
		stem := strings.ToLower(strings.TrimSuffix(d.Name(), filepath.Ext(d.Name())))
		if !artistPhotoBaseNames[stem] {
			return nil
		}
		seen++
		if !artistPhotoHasPadBars(path) {
			return nil
		}
		dir := filepath.Dir(path)
		if err := trashStale(path); err != nil {
			log.Printf("artist reheal: move %s to the Trash: %v", path, err)
			return nil
		}
		// Clear the per-dir negative cache so the re-fetch actually runs, then
		// re-materialize native (best-effort; an unpaired sidecar or catalog miss
		// just leaves it gone and the UI falls back to the catalog image).
		artistPhotoForceRecheck(dir)
		if _, err := materializeArtistPhotoForDir(dir); err != nil {
			log.Printf("artist reheal: re-materialize %s: %v", dir, err)
		}
		healed++
		return nil
	})
	return seen, healed
}

// handleLibraryArtistPhoto — GET /api/library/artist-photo?trackId=<id>&size=<n> (size: the ladder rung that holds it)
//
// Serves the artist's local photo, read straight off disk, materializing it on
// demand if missing (so the first view works before a resolver pass), but only
// into a folder that arrived after the hub started watching (folderArtAllowed). Unlike
// album covers — proxied through Navidrome in handlePlaybackCover — the artist
// photo is served DIRECTLY: Navidrome's artist-art indexing is version/config
// dependent, whereas we own the materialized artist.<ext>. A miss → 404 so the
// web keeps its catalog image (and doesn't cache a broken tile).
func handleLibraryArtistPhoto(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	trackID := strings.TrimSpace(r.URL.Query().Get("trackId"))
	if !isPlausibleTrackID(trackID) {
		http.Error(w, "bad trackId", http.StatusBadRequest)
		return
	}
	artistDir, err := artistDirForTrack(trackID)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	path := existingArtistPhotoPath(artistDir)
	if path == "" && folderArtAllowed(artistDir) {
		if _, mErr := materializeArtistPhotoForDir(artistDir); mErr == nil {
			path = existingArtistPhotoPath(artistDir)
		}
	}
	if path == "" {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	f, err := os.Open(path)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	size := 0
	if n, err := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("size"))); err == nil && n > 0 {
		size = n
	}
	// A materialized artist photo is a MUTABLE local file: the reheal and the
	// user-replace door both rewrite it IN PLACE at the same path. The old
	// `max-age=86400` with no validator hard-cached it for a day, so a rewrite was
	// invisible to the desktop webview — the BUG-105 debar fixed every file on disk
	// yet the wall kept showing yesterday's barred pictures. Revalidate every load
	// instead: cheap on localhost, and ServeContent answers a matching
	// If-Modified-Since with a 304 (no body) so an unchanged photo still costs
	// almost nothing. ServeContent also sets Content-Type + Last-Modified.
	w.Header().Set("Cache-Control", "no-cache")
	// the ladder size that holds the asked box, made on this computer (picture-ladder.go), else the file
	if made, ct := ladderCopy(path, info, ladderRung(size)); made != "" {
		if t, err := os.Open(made); err == nil {
			defer t.Close()
			w.Header().Set("Content-Type", ct)
			http.ServeContent(w, r, "", info.ModTime(), t)
			return
		}
	}
	http.ServeContent(w, r, filepath.Base(path), info.ModTime(), f)
}
