// Folder-cover materialization for Fast Album Art.
//
// Principle: never resize at display time. We place a full-resolution
// cover image in each album folder so the Cassette Player (Navidrome)
// serves it as the album's *original* art — Navidrome's default
// CoverArtPriority puts `cover.*` ahead of `embedded`, so a materialized
// cover wins automatically — and so a freshly-ripped album's cover is
// indexed and cache-warmed in the same scan, with no display-time resize
// when the user first scrolls to it.
//
// The image is normalized at the source (see normalizeCover): capped at
// coverMaxSide on its longest side but kept at its NATIVE aspect ratio — never
// padded to a square, never cropped. A cover already within the cap is stored
// verbatim (lossless pass-through, alpha preserved); an oversized one is scaled
// to fit. This is the single point where every image entering the system (album
// covers and artist photos, embedded-extracted or catalog-fetched) is sanely
// sized while its true shape is preserved, so no black letterbox bars are ever
// baked into the file. Both use it: their frames all crop to fill (object-fit:
// cover / aspectFill), so native aspect is what fills the frame, and
// square-padding would only bar them out.
//
// Sources, in order of preference:
//  1. Embedded art already in a track's tags (free, local, exact) — FLAC
//     PICTURE blocks and MP3 APIC frames.
//  2. (cover-art-fetch.go, added separately) our own catalog cover fetched
//     by MBID, for albums that carry no embedded art. A cheap GET of an
//     asset we already own — NOT the gated discovery path.
//
// Guards: idempotent, never-overwrite, never-delete. If the album folder already
// has a cover.*/folder.*/front.* picture (a prior materialization or the
// person's own art), we leave it untouched, even one we can't decode (BUG-775).
// The automatic pass only reaches album folders that arrived after the hub
// started watching the library (folderArtAllowed, BUG-786); a rip writes into
// the folder it just made.

package main

import (
	"bytes"
	"fmt"
	"image"
	"image/color"
	_ "image/gif" // register GIF decoder for image.Decode
	"image/jpeg"
	"image/png" // PNG encode (alpha-preserving cover output) + decoder registration
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/bogem/id3v2/v2"
	flacpicture "github.com/go-flac/flacpicture/v2"
	flac "github.com/go-flac/go-flac/v2"
	xdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/webp" // register WebP decoder for image.Decode
)

// coverMaxSide caps the longest side of a cover (and artist photo) the hub writes into a folder: a rip, a
// new folder, a pick. It is the image ladder's top rung (imageRungs), so the largest size any screen asks
// for is sharp (the founder, 2026-11-04; it was 1000). Forward only: a picture already in a folder is
// never rewritten to meet it.
const coverMaxSide = 1200

// coverPadColor is the brand near-black (matches the app's bg4 #161310) that OLD
// builds baked as square-pad bars into non-square artist photos. Nothing pads any
// more (both covers and artist photos use normalizeCover, native ratio), so it is
// never written today. It is retained as the fingerprint the artist-photo reheal
// matches to strip those baked-in bars from libraries materialized before the fix
// (see artistPhotoHasPadBars).
var coverPadColor = color.RGBA{R: 0x16, G: 0x13, B: 0x10, A: 0xFF}

// coverBaseNames are the filename stems that Navidrome's default
// CoverArtPriority treats as folder cover art, when the file is a picture
// (folderImageExts). If any exists we never write and never overwrite.
var coverBaseNames = map[string]bool{"cover": true, "folder": true, "front": true}

// folderImageExts are the extensions that make a cover/folder/front/artist file a
// picture. Anything else with that stem (a Cover.pdf booklet, a front.txt note) is
// not art and never counts as, or is replaced as, a cover. Wider than what Go can
// decode on purpose: a person's front.tif or cover.heic is still their cover, so
// it blocks a write beside it and is never treated as broken.
var folderImageExts = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true,
	".bmp": true, ".tif": true, ".tiff": true, ".heic": true, ".heif": true, ".avif": true,
}

// isStemImage reports whether name is a picture whose stem is in stems,
// case-insensitively ("Cover.JPG" is a cover; "Cover.pdf" and "cover-art.jpg" are not).
func isStemImage(name string, stems map[string]bool) bool {
	ext := strings.ToLower(filepath.Ext(name))
	stem := strings.ToLower(strings.TrimSuffix(name, filepath.Ext(name)))
	return stems[stem] && folderImageExts[ext]
}

// mimeImageURL is the special "MIME type" a FLAC/ID3 picture block uses to
// say the payload is a URL link rather than embedded image bytes. We skip
// those — there is nothing local to materialize.
const mimeImageURL = "-->"

// materializeCoverForAlbumDir writes a full-resolution cover image into dir
// when the album has none, sourced from the embedded art of one of its
// tracks. Returns (true, nil) only when a new cover file was written.
//
// Idempotent and safe to call on every pass: it no-ops when a cover already
// exists. Best-effort by contract — (false, nil) means "nothing to do / no
// embedded art found", which is not a failure.
//
// An existing cover is left alone even when it doesn't decode (BUG-775). The old
// self-heal deleted it and wrote a new one, which permanently removed a person's
// own scans in formats Go can't read. Everything we write is decode-checked first
// (writeFolderCover), so a broken cover here is not ours to fix.
func materializeCoverForAlbumDir(dir string) (wrote bool, err error) {
	if existingFolderCoverPath(dir) != "" {
		return false, nil
	}
	firstAudio, data, mime, err := embeddedCoverInDir(dir)
	if err != nil {
		return false, err
	}
	// Source 1: embedded art — free, local, exact.
	if len(data) > 0 {
		return writeFolderCover(dir, data, mime)
	}
	// Source 2: no embedded art in any track — fall back to our own
	// already-owned catalog cover (read-only lookup; never triggers an
	// upstream import). Best-effort and negative-cached per album.
	if firstAudio != "" {
		if data, mime, ok := catalogCoverForTrack(firstAudio); ok {
			return writeFolderCover(dir, data, mime)
		}
	}
	return false, nil
}

// materializeEmbeddedCover is materializeCoverForAlbumDir's first source alone: the art inside the
// album's own files, never the catalog. The rip's first cover step, so that the disc's own cover comes
// next and the cover of whatever album the cloud matched comes only after both (BUG-919). Same guards:
// a folder that has a cover keeps it.
func materializeEmbeddedCover(dir string) (wrote bool, err error) {
	if existingFolderCoverPath(dir) != "" {
		return false, nil
	}
	_, data, mime, err := embeddedCoverInDir(dir)
	if err != nil || len(data) == 0 {
		return false, err
	}
	return writeFolderCover(dir, data, mime)
}

// embeddedCoverInDir returns the first embedded picture among dir's tracks, and the first track
// (the one the catalog lookup reads tags from) whether or not any carries art.
func embeddedCoverInDir(dir string) (firstAudio string, data []byte, mime string, err error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", nil, "", fmt.Errorf("read album dir: %w", err)
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		track := filepath.Join(dir, e.Name())
		if !isSupportedAudio(track) {
			continue
		}
		if firstAudio == "" {
			firstAudio = track
		}
		if data, mime := embeddedArt(track); len(data) > 0 {
			return firstAudio, data, mime, nil
		}
	}
	return firstAudio, nil, "", nil
}

// writeFolderCover normalizes image bytes to a native-ratio, capped cover (see
// normalizeCover) and writes them as cover.<ext> in dir. Conforming covers
// (within coverMaxSide) pass through losslessly; oversized ones are scaled to
// fit, keeping their shape. The extension follows the result MIME.
func writeFolderCover(dir string, data []byte, mime string) (bool, error) {
	data, mime = normalizeCover(data, mime)
	// §5/Rule 1: verify the bytes FULLY decode before writing. normalizeCover
	// only reads the header on its pass-through path, so a header-valid but
	// truncated/corrupt source would slip through — catch it here and write
	// nothing, so the album falls to the placeholder rather than a broken cover
	// file. (materializeCoverForAlbumDir's never-overwrite guard already means a
	// failed materialize never blanks an existing good cover.jpg.)
	if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
		return false, nil
	}
	dst := filepath.Join(dir, "cover"+imageExt(mime, data))
	if err := atomicWriteFile(dst, data, 0o644); err != nil {
		return false, fmt.Errorf("write cover: %w", err)
	}
	return true, nil
}

// replaceFolderCover FORCIBLY replaces dir's folder cover with newData,
// deleting every existing cover.*/folder.*/front.* file first.
//
// This is deliberately a SEPARATE function from materializeCoverForAlbumDir,
// not a parameter/flag on it: that function's contract is "never overwrite an
// existing cover", and it is called automatically on every rip/resolve pass. This function exists for
// exactly one path — a human clicked "replace" in the UI — and must never be
// reachable from the automatic materialization pass. Callers are responsible
// for only invoking this on explicit user action.
//
// writeFolderCover always names its output "cover.<ext>" regardless of what
// the prior file was called (e.g. a pre-existing folder.png) — so without the
// explicit removal here, replacing a folder.png with a JPEG would leave BOTH
// files on disk (Navidrome's cover.* > folder.* priority means the new one
// would still win on display, but the stale file would linger, not actually
// be gone). We remove every cover-priority filename before writing the new
// one so "replace" really means replace.
func replaceFolderCover(dir string, newData []byte, mime string) (bool, error) {
	coverForceRecheck(dir) // bypass the negative cache, same as the rip's post-registration retry
	return replaceStemImage(dir, coverBaseNames, "cover", newData, mime, normalizeCover)
}

// trashStale is how a replace clears the old picture: the macOS Trash. A variable
// only so tests can keep their fixtures out of the real Trash.
var trashStale = trashFile

// artistPhotoBaseNames is replaceArtistFolderPhoto's never-linger set — same
// role as coverBaseNames, one filename stem instead of three (no Navidrome
// serving convention to match here; this is purely our own app's local cache).
var artistPhotoBaseNames = map[string]bool{"artist": true}

// replaceArtistFolderPhoto FORCIBLY replaces dir's artist photo with newData —
// the same explicit-replace contract as replaceFolderCover, one directory
// level up (the artist folder, not an album folder). No automatic
// materialization pass writes here (unlike album covers, nothing else ever
// tries to fill in an artist photo), so there's no negative cache to bypass.
func replaceArtistFolderPhoto(dir string, newData []byte, mime string) (bool, error) {
	return replaceStemImage(dir, artistPhotoBaseNames, "artist", newData, mime, normalizeCover)
}

// replaceStemImage is the shared "delete every file whose stem is in
// staleStems, then write newData as <primaryStem>.<ext>" contract behind both
// replaceFolderCover and replaceArtistFolderPhoto — same full-decode
// verification, same atomic write. Both callers pass normalizeCover now (native
// ratio, no pad); the func stays a parameter so a caller could vary it.
func replaceStemImage(dir string, staleStems map[string]bool, primaryStem string, newData []byte, mime string, normalize func([]byte, string) ([]byte, string)) (bool, error) {
	// Snapshot the directory BEFORE touching anything, so a read failure aborts
	// before any change.
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false, fmt.Errorf("read dir: %w", err)
	}
	// Validate and durably write the NEW cover FIRST — decode-check it, then
	// atomic temp-write + rename into place. Only after the replacement is safely
	// on disk do we remove the old stems. Previously the stale stems were deleted
	// up front, so a decode failure (a truncated/partial upload that still sniffed
	// as an image), a full disk, or a permission error left the album with NO cover
	// on disk at all — destroying the user's own source-of-truth file with nothing
	// to restore it. This ordering guarantees the old cover survives any failure.
	data, mime := normalize(newData, mime)
	if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
		return false, nil
	}
	dst := filepath.Join(dir, primaryStem+imageExt(mime, data))
	if err := atomicWriteFile(dst, data, 0o644); err != nil {
		return false, fmt.Errorf("write %s: %w", primaryStem, err)
	}
	// Now move the other stale pictures to the Trash, never the file we just wrote.
	// Only pictures: a Cover.pdf booklet shares the stem but is not art (BUG-775).
	// The Trash, not a delete, so a person who replaced the wrong album can get
	// their old cover back. The compare ignores case because macOS does: a prior
	// "Cover.jpg" IS the "cover.jpg" just written, and trashing it would take the
	// new cover with it.
	dstName := filepath.Base(dst)
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if strings.EqualFold(name, dstName) || !isStemImage(name, staleStems) {
			continue
		}
		if err := trashStale(filepath.Join(dir, name)); err != nil {
			// The new picture is already in place and wins by name; a leftover old
			// one is untidy, never worth losing a file over.
			log.Printf("replace %s: could not move %q to the Trash: %v", primaryStem, name, err)
		}
	}
	return true, nil
}

// normalizeCover returns image bytes (album covers AND artist photos) capped at
// coverMaxSide on the longest side while preserving the source's NATIVE aspect
// ratio — it never pads to a square and never crops, so no black letterbox bars
// are ever baked in. A source
// already within the cap passes through unchanged (lossless, alpha preserved),
// EXCEPT a CMYK/YCCK JPEG, which is re-drawn into RGBA even when within cap (CMYK
// renders black or inverted in iOS ImageIO and browsers). An oversized source is
// scaled to fit. On any decode/encode failure it returns the input unchanged
// (best-effort: bad data still lands as a file rather than nothing).
//
// Output format follows the SOURCE format so alpha survives the re-encode: a
// JPEG source re-encodes to JPEG q90 (opaque, smaller); a PNG/GIF/WebP source
// re-encodes to PNG (lossless, keeps any alpha channel). We NEVER emit WebP —
// golang.org/x/image/webp is decode-only.
func normalizeCover(data []byte, mime string) (outData []byte, outMime string) {
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return data, mime // undecodable → verbatim fallback
	}
	// Lossless pass-through: within the cap on BOTH sides and not CMYK. Non-square
	// is fine — we no longer force square, so a within-cap rectangle is stored
	// exactly as delivered, alpha and all.
	if cfg.Width > 0 && cfg.Height > 0 &&
		cfg.Width <= coverMaxSide && cfg.Height <= coverMaxSide &&
		cfg.ColorModel != color.CMYKModel {
		return data, mime
	}

	src, decFormat, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return data, mime
	}
	if format == "" {
		format = decFormat
	}
	b := src.Bounds()
	sw, sh := b.Dx(), b.Dy()
	if sw <= 0 || sh <= 0 {
		return data, mime
	}

	// Scale the longest side down to the cap, preserving aspect. When we're here
	// only to de-CMYK a within-cap image, scale stays 1.0 and dimensions hold.
	scale := 1.0
	if longest := max(sw, sh); longest > coverMaxSide {
		scale = float64(coverMaxSide) / float64(longest)
	}
	dw := max(1, int(math.Round(float64(sw)*scale)))
	dh := max(1, int(math.Round(float64(sh)*scale)))

	canvas := image.NewRGBA(image.Rect(0, 0, dw, dh))
	xdraw.CatmullRom.Scale(canvas, canvas.Bounds(), src, b, xdraw.Src, nil)

	out, outFmtMime := encodeCover(canvas, format)
	if out == nil {
		return data, mime // encode failed → verbatim fallback
	}
	return out, outFmtMime
}

// encodeCover serializes a normalized album cover, choosing the format so alpha
// survives: a JPEG source → JPEG q90 (opaque, smaller); everything else → PNG
// (lossless, keeps any alpha channel). Never emits WebP (the x/image decoder is
// import-only). Returns (nil, "") on encode failure so the caller keeps the
// original bytes.
func encodeCover(img image.Image, sourceFormat string) ([]byte, string) {
	var buf bytes.Buffer
	if sourceFormat == "jpeg" {
		if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
			return nil, ""
		}
		return buf.Bytes(), "image/jpeg"
	}
	if err := png.Encode(&buf, img); err != nil {
		return nil, ""
	}
	return buf.Bytes(), "image/png"
}

// hasFolderCover reports whether dir already contains a cover.*/folder.*/
// front.* file (case-insensitive stem). This is the never-overwrite guard.
func hasFolderCover(dir string) bool {
	return existingFolderCoverPath(dir) != ""
}

// existingFolderCoverPath returns the path of an existing cover.*/folder.*/
// front.* picture in dir, or "" when none exists.
func existingFolderCoverPath(dir string) string {
	return existingStemImagePath(dir, coverBaseNames)
}

// existingStemImagePath returns the first picture in dir whose stem is in stems
// (isStemImage), or "".
func existingStemImagePath(dir string, stems map[string]bool) string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	for _, e := range entries {
		if !e.IsDir() && isStemImage(e.Name(), stems) {
			return filepath.Join(dir, e.Name())
		}
	}
	return ""
}

// coverFileDecodes reports whether the file at path is a fully-decodable image.
func coverFileDecodes(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	_, _, err = image.Decode(f)
	return err == nil
}

// embeddedArt returns the bytes + MIME of the best embedded picture in a
// FLAC or MP3 file, preferring the front cover. Returns (nil, "") when the
// file carries no usable picture or can't be read — callers treat that as
// "no embedded art", never a hard error (materialization is best-effort).
func embeddedArt(path string) (data []byte, mime string) {
	switch strings.ToLower(extOf(path)) {
	case ".flac":
		return flacArt(path)
	case ".mp3":
		return mp3Art(path)
	default:
		return nil, ""
	}
}

func flacArt(path string) (data []byte, mime string) {
	f, err := parseFLACMeta(path)
	if err != nil {
		return nil, ""
	}
	var fallback *flacpicture.MetadataBlockPicture
	for _, block := range f.Meta {
		if block.Type != flac.Picture {
			continue
		}
		pic, perr := flacpicture.ParseFromMetaDataBlock(*block)
		if perr != nil || pic == nil || len(pic.ImageData) == 0 || pic.MIME == mimeImageURL {
			continue
		}
		if pic.PictureType == flacpicture.PictureTypeFrontCover {
			return pic.ImageData, pic.MIME
		}
		if fallback == nil {
			fallback = pic
		}
	}
	if fallback != nil {
		return fallback.ImageData, fallback.MIME
	}
	return nil, ""
}

func mp3Art(path string) (data []byte, mime string) {
	tag, err := id3v2.Open(path, id3v2.Options{Parse: true})
	if err != nil {
		return nil, ""
	}
	defer tag.Close()
	var fallback *id3v2.PictureFrame
	for _, fr := range tag.GetFrames("APIC") {
		pf, ok := fr.(id3v2.PictureFrame)
		if !ok || len(pf.Picture) == 0 || pf.MimeType == mimeImageURL {
			continue
		}
		if pf.PictureType == id3v2.PTFrontCover {
			return pf.Picture, pf.MimeType
		}
		if fallback == nil {
			f := pf
			fallback = &f
		}
	}
	if fallback != nil {
		return fallback.Picture, fallback.MimeType
	}
	return nil, ""
}

// imageExt maps an embedded picture's MIME (falling back to content
// sniffing) to a file extension. We store the original bytes verbatim, so
// the extension only needs to match the actual format for Navidrome's
// decoder — and `cover.*` matches regardless.
func imageExt(mime string, data []byte) string {
	m := strings.ToLower(strings.TrimSpace(mime))
	if m == "" || m == mimeImageURL {
		m = http.DetectContentType(data)
	}
	switch {
	case strings.Contains(m, "png"):
		return ".png"
	case strings.Contains(m, "webp"):
		return ".webp"
	case strings.Contains(m, "gif"):
		return ".gif"
	default:
		// JPEG is by far the most common embedded format, and the safe
		// default when the MIME is unrecognized but the bytes are an image.
		return ".jpg"
	}
}
