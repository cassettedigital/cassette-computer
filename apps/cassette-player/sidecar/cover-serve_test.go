package main

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

// serveFolderCover must stream the actual on-disk bytes with an image content type
// and an hour's cache: this is the fast path that replaces the two-hop Navidrome
// proxy, so a regression here is the "covers went slow again" bug. It was no-cache,
// which made the window re-ask for every cover on every page (2026-10-31 audit); a
// cover replaced in the app gets a new address (local-cover-epoch v=) instead.
func TestServeFolderCover_StreamsFileBytes(t *testing.T) {
	dir := t.TempDir()
	coverPath := filepath.Join(dir, "cover.jpg")
	if err := os.WriteFile(coverPath, jpegBytes, 0o644); err != nil {
		t.Fatalf("write cover: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/playback/cover?trackId=x&size=92", nil)
	rec := httptest.NewRecorder()
	if ok := serveFolderCover(rec, req, coverPath, 92); !ok {
		t.Fatal("serveFolderCover returned false for a readable file")
	}
	res := rec.Result()
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); ct != "image/jpeg" {
		t.Errorf("Content-Type = %q, want image/jpeg", ct)
	}
	if cc := res.Header.Get("Cache-Control"); cc != "private, max-age=3600" {
		t.Errorf("Cache-Control = %q, want private, max-age=3600", cc)
	}
	if !bytes.Equal(rec.Body.Bytes(), jpegBytes) {
		t.Errorf("body did not match the on-disk cover bytes (got %d bytes, want %d)", rec.Body.Len(), len(jpegBytes))
	}
}

// A missing/unopenable path must return false WITHOUT writing a response, so the
// caller can still fall back to the Navidrome proxy.
func TestServeFolderCover_MissingFileFallsThrough(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	if ok := serveFolderCover(rec, req, filepath.Join(t.TempDir(), "nope.jpg"), 300); ok {
		t.Fatal("serveFolderCover returned true for a missing file")
	}
	if rec.Body.Len() != 0 {
		t.Errorf("wrote %d bytes for a missing file; must write nothing so the caller can fall back", rec.Body.Len())
	}
}

// The trackID→coverPath cache must self-heal: an entry whose file has since been
// removed (a cover replaced with a different extension, or an album moved) is
// dropped rather than served as a dead path.
func TestFolderCoverPathForTrack_StaleCacheEntryIsDropped(t *testing.T) {
	const trackID = "stale-track"
	gone := filepath.Join(t.TempDir(), "cover.jpg") // never created
	coverPathCache.Store(trackID, gone)
	t.Cleanup(func() { coverPathCache.Delete(trackID) })

	// With no Navidrome to re-resolve against, this returns "" — but the point is
	// the dead cache entry must not survive.
	_ = folderCoverPathForTrack(trackID)
	if _, ok := coverPathCache.Load(trackID); ok {
		t.Error("stale cache entry was not dropped after its file went missing")
	}
}

// A big cover asked for a small box comes back at the ladder rung that holds the box (300 → 480 on its
// long side) and is kept in the cache folder, so the next ask reads the made copy.
func TestServeFolderCover_SmallBoxGetsAResizedCopy(t *testing.T) {
	t.Setenv("HOME", t.TempDir()) // os.UserCacheDir on macOS is $HOME/Library/Caches
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	big := image.NewRGBA(image.Rect(0, 0, 1000, 800))
	for x := 0; x < 1000; x++ {
		for y := 0; y < 800; y++ {
			big.Set(x, y, color.RGBA{uint8(x), uint8(y), 90, 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, big, nil); err != nil {
		t.Fatal(err)
	}
	coverPath := filepath.Join(t.TempDir(), "cover.jpg")
	if err := os.WriteFile(coverPath, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		rec := httptest.NewRecorder()
		if ok := serveFolderCover(rec, httptest.NewRequest(http.MethodGet, "/", nil), coverPath, 300); !ok {
			t.Fatal("serveFolderCover returned false")
		}
		cfg, err := jpeg.DecodeConfig(bytes.NewReader(rec.Body.Bytes()))
		if err != nil {
			t.Fatalf("pass %d: not a jpeg: %v", i, err)
		}
		if cfg.Width != 480 || cfg.Height != 384 {
			t.Errorf("pass %d: got %dx%d, want 480x384", i, cfg.Width, cfg.Height)
		}
	}
	// a box past the picture's own size gets the original (1200 holds a 1000px cover; nothing is enlarged)
	rec := httptest.NewRecorder()
	serveFolderCover(rec, httptest.NewRequest(http.MethodGet, "/", nil), coverPath, 1200)
	if !bytes.Equal(rec.Body.Bytes(), buf.Bytes()) {
		t.Error("a large box should get the original file")
	}
}

// ─── The cover's version in its address (BUG-920) ─────────────────────────────

func coverCacheOf(t *testing.T, coverPath, query string) string {
	t.Helper()
	rec := httptest.NewRecorder()
	if ok := serveFolderCover(rec, httptest.NewRequest(http.MethodGet, "/api/playback/cover?trackId=x"+query, nil), coverPath, 0); !ok {
		t.Fatal("serveFolderCover returned false for a readable file")
	}
	return rec.Result().Header.Get("Cache-Control")
}

// An address naming the cover in the folder now is kept for good; one naming another (the cloud hasn't
// heard of a change yet) is asked again every time, so a stale address never pins a picture; one naming
// none keeps the hour.
func TestServeFolderCover_VersionedAddressIsKeptForGood(t *testing.T) {
	dir := t.TempDir()
	coverPath := filepath.Join(dir, "cover.jpg")
	if err := os.WriteFile(coverPath, jpegBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	now := folderCoverVersion(dir)
	if now == "" {
		t.Fatal("no version for a folder with a cover")
	}
	if got := coverCacheOf(t, coverPath, "&cv="+now); got != "private, max-age=31536000, immutable" {
		t.Errorf("current version: Cache-Control = %q, want kept for good", got)
	}
	// a record spanning folders carries several, comma-joined; one of them being this folder's is enough
	if got := coverCacheOf(t, coverPath, "&cv=0123456789abcdef,"+now); got != "private, max-age=31536000, immutable" {
		t.Errorf("version among several: Cache-Control = %q, want kept for good", got)
	}
	if got := coverCacheOf(t, coverPath, "&cv=0123456789abcdef"); got != "no-cache" {
		t.Errorf("stale version: Cache-Control = %q, want no-cache", got)
	}
	if got := coverCacheOf(t, coverPath, "&cv=NOT-HEX"); got != "private, max-age=3600" {
		t.Errorf("junk version: Cache-Control = %q, want the unversioned hour", got)
	}
	if got := coverCacheOf(t, coverPath, ""); got != "private, max-age=3600" {
		t.Errorf("no version: Cache-Control = %q, want the unversioned hour", got)
	}
}

// The version is the fingerprint the library sync sends the cloud for the album (the web builds the
// address from that one), and it follows a new picture in the folder at once, never a stale memo.
func TestFolderCoverVersion_IsTheSyncFingerprintAndFollowsAChange(t *testing.T) {
	dir := t.TempDir()
	coverPath := filepath.Join(dir, "cover.jpg")
	if err := os.WriteFile(coverPath, jpegBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	want, ok := hashCoverFiles(coverFilesForAlbum([]string{dir}))
	if !ok {
		t.Fatal("hashCoverFiles failed")
	}
	first := folderCoverVersion(dir)
	if first != want {
		t.Fatalf("version %q, want the sync's fingerprint %q", first, want)
	}
	if again := folderCoverVersion(dir); again != first {
		t.Errorf("same folder, same cover: %q then %q", first, again)
	}
	if err := os.WriteFile(coverPath, pngBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	if next := folderCoverVersion(dir); next == first || next == "" {
		t.Errorf("after a new picture the version is %q (was %q); want a new one", next, first)
	}
	if got := coverCacheOf(t, coverPath, "&cv="+first); got != "no-cache" {
		t.Errorf("the old version after a change: Cache-Control = %q, want no-cache", got)
	}
	if err := os.Remove(coverPath); err != nil {
		t.Fatal(err)
	}
	if gone := folderCoverVersion(dir); gone != "" {
		t.Errorf("no cover left, version %q; want none", gone)
	}
}

// The Navidrome fallback (no folder cover yet) is never kept, but answers "not changed" to the ask that
// comes back with its ETag; once a folder cover lands at the same address the same ask gets the new
// picture, never a "not changed" (the reason it is an ETag and not a date).
func TestPlaybackCover_FallbackAnswersNotChangedUntilAFolderCoverLands(t *testing.T) {
	music := t.TempDir()
	albumDir := filepath.Join(music, "Hall & Oates", "The Very Best Of")
	if err := os.MkdirAll(albumDir, 0o755); err != nil {
		t.Fatal(err)
	}
	trackPath := filepath.Join(albumDir, "01 - Rich Girl.flac")
	nd := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/rest/getSong":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"subsonic-response":{"status":"ok","song":{"coverArt":"mf-abc_6543abcd","albumId":"al1","path":` + strconv.Quote(trackPath) + `}}}`))
		case "/rest/getCoverArt":
			w.Header().Set("Content-Type", "image/jpeg")
			w.Header().Set("Last-Modified", "Sat, 07 Nov 2026 10:00:00 GMT")
			_, _ = w.Write(jpegBytes)
		default:
			http.NotFound(w, r)
		}
	}))
	defer nd.Close()
	oldMusic, oldBase := sidecarMusicDir, navidromeBase
	sidecarMusicDir, navidromeBase = music, nd.URL
	t.Cleanup(func() { sidecarMusicDir, navidromeBase = oldMusic, oldBase })
	const trackID = "fallback-track-919"
	t.Cleanup(func() { coverPathCache.Delete(trackID) })

	ask := func(ifNoneMatch string) *http.Response {
		req := httptest.NewRequest(http.MethodGet, "/api/playback/cover?trackId="+trackID+"&size=240", nil)
		if ifNoneMatch != "" {
			req.Header.Set("If-None-Match", ifNoneMatch)
		}
		rec := httptest.NewRecorder()
		handlePlaybackCover(rec, req)
		return rec.Result()
	}

	first := ask("")
	if first.StatusCode != http.StatusOK {
		t.Fatalf("first ask: status %d, want 200", first.StatusCode)
	}
	if cc := first.Header.Get("Cache-Control"); cc != "no-cache" {
		t.Errorf("fallback Cache-Control = %q, want no-cache", cc)
	}
	tag := first.Header.Get("ETag")
	if tag == "" {
		t.Fatal("fallback carries no ETag")
	}
	if again := ask(tag); again.StatusCode != http.StatusNotModified {
		t.Errorf("ask with its ETag: status %d, want 304", again.StatusCode)
	}

	if err := os.WriteFile(filepath.Join(albumDir, "cover.jpg"), pngBytes, 0o644); err != nil {
		t.Fatal(err)
	}
	landed := ask(tag)
	if landed.StatusCode != http.StatusOK {
		t.Fatalf("after a folder cover landed, the old ETag got status %d, want 200 with the new picture", landed.StatusCode)
	}
	body, _ := io.ReadAll(landed.Body)
	if !bytes.Equal(body, pngBytes) {
		t.Error("after a folder cover landed, the answer was not the folder's picture")
	}
}

// Navidrome's zero time (art with no date) gives no ETag, so a doubt always sends the picture.
func TestNavidromeCoverETag(t *testing.T) {
	if tag := navidromeCoverETag("al-x_0", 240, "Mon, 01 Jan 0001 00:00:00 GMT"); tag != "" {
		t.Errorf("zero date gave ETag %q, want none", tag)
	}
	if tag := navidromeCoverETag("al-x_0", 240, ""); tag != "" {
		t.Errorf("no date gave ETag %q, want none", tag)
	}
	a := navidromeCoverETag("al-x_65", 240, "Sat, 07 Nov 2026 10:00:00 GMT")
	if a == "" || a == navidromeCoverETag("al-x_65", 480, "Sat, 07 Nov 2026 10:00:00 GMT") || a == navidromeCoverETag("al-x_65", 240, "Sat, 07 Nov 2026 10:00:01 GMT") {
		t.Errorf("ETag %q must name the art, the size and the date", a)
	}
	if !etagListed(`W/`+a+`, "other"`, a) || etagListed(`"other"`, a) || !etagListed("*", a) {
		t.Error("etagListed misreads If-None-Match")
	}
}
