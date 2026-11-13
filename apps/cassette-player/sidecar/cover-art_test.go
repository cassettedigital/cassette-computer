package main

import (
	"bytes"
	"image"
	"image/jpeg"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/bogem/id3v2/v2"
	flacpicture "github.com/go-flac/flacpicture/v2"
	flac "github.com/go-flac/go-flac/v2"
)

// Real, decodable images. flacpicture.NewFromImageData decodes the bytes to
// record the picture's dimensions, so a fixture must be a genuine image (not
// just the right magic bytes); http.DetectContentType also classifies these
// correctly for the imageExt sniff path. Materialization stores bytes
// verbatim, so the tests compare them as-is.
var (
	jpegBytes = mustEncodeImage("jpeg")
	pngBytes  = mustEncodeImage("png")
)

func mustEncodeImage(format string) []byte {
	img := image.NewRGBA(image.Rect(0, 0, 8, 8))
	for i := range img.Pix {
		img.Pix[i] = 0x80
	}
	var b bytes.Buffer
	var err error
	switch format {
	case "jpeg":
		err = jpeg.Encode(&b, img, nil)
	case "png":
		err = png.Encode(&b, img)
	}
	if err != nil {
		panic(err)
	}
	return b.Bytes()
}

func mustEncodeImageSize(format string, w, h int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for i := range img.Pix {
		img.Pix[i] = 0x80
	}
	var b bytes.Buffer
	var err error
	switch format {
	case "jpeg":
		err = jpeg.Encode(&b, img, nil)
	case "png":
		err = png.Encode(&b, img)
	}
	if err != nil {
		panic(err)
	}
	return b.Bytes()
}

func TestNormalizeCover(t *testing.T) {
	// Within-cap square → lossless pass-through, unchanged bytes.
	small := mustEncodeImageSize("jpeg", 8, 8)
	if out, mime := normalizeCover(small, "image/jpeg"); !bytes.Equal(out, small) ||
		mime != "image/jpeg" {
		t.Error("within-cap square cover should pass through unchanged")
	}

	// Within-cap NON-square → pass through unchanged (native shape preserved, NOT
	// padded to square, NOT re-encoded). This is the whole point of the change.
	rect := mustEncodeImageSize("png", 800, 600)
	if out, mime := normalizeCover(rect, "image/png"); !bytes.Equal(out, rect) ||
		mime != "image/png" {
		t.Error("within-cap non-square cover should pass through unchanged (no square-pad)")
	}

	// Oversized non-square PNG → scaled to fit the cap, aspect PRESERVED (still
	// non-square), output stays PNG so alpha would survive.
	widePng := mustEncodeImageSize("png", 1600, 800)
	out, mime := normalizeCover(widePng, "image/png")
	if mime != "image/png" {
		t.Errorf("png source should re-encode to png (alpha-preserving), got %q", mime)
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("decode transformed cover: %v", err)
	}
	if cfg.Width != coverMaxSide {
		t.Errorf("longest side 1600 should cap to %d, got %d", coverMaxSide, cfg.Width)
	}
	if cfg.Height != coverMaxSide/2 {
		t.Errorf("2:1 aspect not preserved: %dx%d (want %dx%d)", cfg.Width, cfg.Height, coverMaxSide, coverMaxSide/2)
	}
	if cfg.Width == cfg.Height {
		t.Error("non-square cover must NOT be squared")
	}

	// Oversized non-square JPEG → scaled, aspect preserved, output stays JPEG.
	wideJpeg := mustEncodeImageSize("jpeg", 2400, 1200)
	outJ, mimeJ := normalizeCover(wideJpeg, "image/jpeg")
	if mimeJ != "image/jpeg" {
		t.Errorf("jpeg source should stay jpeg, got %q", mimeJ)
	}
	cfgJ, _, _ := image.DecodeConfig(bytes.NewReader(outJ))
	if cfgJ.Width != coverMaxSide || cfgJ.Height != coverMaxSide/2 {
		t.Errorf("jpeg aspect/cap wrong: %dx%d", cfgJ.Width, cfgJ.Height)
	}

	// Oversized square → capped, still square.
	big := mustEncodeImageSize("jpeg", 1600, 1600)
	outBig, _ := normalizeCover(big, "image/jpeg")
	cfgBig, _, _ := image.DecodeConfig(bytes.NewReader(outBig))
	if cfgBig.Width != coverMaxSide || cfgBig.Height != coverMaxSide {
		t.Errorf("oversized square not capped: %dx%d", cfgBig.Width, cfgBig.Height)
	}

	// Undecodable → verbatim fallback.
	junk := []byte("not an image")
	if out, mime := normalizeCover(junk, "image/jpeg"); !bytes.Equal(out, junk) ||
		mime != "image/jpeg" {
		t.Error("undecodable bytes should pass through unchanged")
	}
}

func TestHasFolderCover(t *testing.T) {
	cases := []struct {
		file string
		want bool
	}{
		{"cover.jpg", true}, {"Cover.JPG", true}, {"folder.png", true},
		{"front.jpeg", true}, {"FRONT.webp", true},
		{"backcover.jpg", false}, {"art.jpg", false}, {"track.flac", false},
		{"cover-art.jpg", false}, // stem "cover-art" is not "cover"
		// BUG-775: a picture we can't decode is still the person's cover; a
		// booklet or a note that shares the stem is not a cover at all.
		{"front.tif", true}, {"cover.heic", true}, {"folder.bmp", true},
		{"Cover.pdf", false}, {"front.txt", false},
	}
	for _, c := range cases {
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, c.file), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		if got := hasFolderCover(dir); got != c.want {
			t.Errorf("hasFolderCover with %q = %v, want %v", c.file, got, c.want)
		}
	}
}

func TestImageExt(t *testing.T) {
	cases := []struct {
		mime string
		data []byte
		want string
	}{
		{"image/jpeg", nil, ".jpg"},
		{"IMAGE/JPEG", nil, ".jpg"},
		{"image/png", nil, ".png"},
		{"image/webp", nil, ".webp"},
		{"image/gif", nil, ".gif"},
		{"", pngBytes, ".png"},                          // empty MIME → sniff
		{mimeImageURL, jpegBytes, ".jpg"},               // "-->" link MIME → sniff
		{"application/octet-stream", jpegBytes, ".jpg"}, // unknown non-empty → default jpg
	}
	for _, c := range cases {
		if got := imageExt(c.mime, c.data); got != c.want {
			t.Errorf("imageExt(%q) = %q, want %q", c.mime, got, c.want)
		}
	}
}

// writeMP3WithArt writes a tag-only MP3 (an ID3v2 tag is readable on its own,
// no audio frames required) carrying a single APIC frame. Self-contained —
// no external binaries.
func writeMP3WithArt(t *testing.T, dir, name, mime string, ptype byte, pic []byte) string {
	t.Helper()
	tag := id3v2.NewEmptyTag()
	tag.AddAttachedPicture(id3v2.PictureFrame{
		Encoding:    id3v2.EncodingUTF8,
		MimeType:    mime,
		PictureType: ptype,
		Description: "cover",
		Picture:     pic,
	})
	p := filepath.Join(dir, name)
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tag.WriteTo(f); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestMP3ArtRoundTrip(t *testing.T) {
	dir := t.TempDir()
	p := writeMP3WithArt(t, dir, "track.mp3", "image/jpeg", id3v2.PTFrontCover, jpegBytes)
	data, mime := mp3Art(p)
	if !bytes.Equal(data, jpegBytes) {
		t.Fatalf("mp3Art bytes = %d, want %d", len(data), len(jpegBytes))
	}
	if mime != "image/jpeg" {
		t.Errorf("mime = %q, want image/jpeg", mime)
	}
}

func TestMaterializeFromEmbeddedMP3(t *testing.T) {
	dir := t.TempDir()
	writeMP3WithArt(t, dir, "01 track.mp3", "image/jpeg", id3v2.PTFrontCover, jpegBytes)
	wrote, err := materializeCoverForAlbumDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !wrote {
		t.Fatal("expected a cover to be written")
	}
	got, err := os.ReadFile(filepath.Join(dir, "cover.jpg"))
	if err != nil {
		t.Fatalf("cover.jpg not written: %v", err)
	}
	if !bytes.Equal(got, jpegBytes) {
		t.Error("materialized cover bytes are not faithful to the embedded art")
	}
	// Idempotent: a second pass must no-op now that a cover exists.
	wrote2, err := materializeCoverForAlbumDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if wrote2 {
		t.Error("second materialize call should no-op when a cover already exists")
	}
}

func TestMaterializeNeverOverwrite(t *testing.T) {
	dir := t.TempDir()
	// A real (decodable) user cover — distinct from the embedded art — must be
	// left untouched.
	userArt := mustEncodeImageSize("jpeg", 16, 16)
	if err := os.WriteFile(filepath.Join(dir, "cover.jpg"), userArt, 0o644); err != nil {
		t.Fatal(err)
	}
	writeMP3WithArt(t, dir, "01 track.mp3", "image/jpeg", id3v2.PTFrontCover, jpegBytes)
	wrote, err := materializeCoverForAlbumDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if wrote {
		t.Error("must not overwrite a valid existing cover file")
	}
	got, _ := os.ReadFile(filepath.Join(dir, "cover.jpg"))
	if !bytes.Equal(got, userArt) {
		t.Error("existing valid user cover was modified")
	}
}

// TestReplaceFolderCoverOverwritesExisting proves the explicit-replace path
// does the OPPOSITE of materializeCoverForAlbumDir on the same fixture: it
// overwrites a perfectly valid, decodable existing cover. This is the crux of
// the feature — replaceFolderCover must not inherit the never-overwrite
// guard.
func TestReplaceFolderCoverOverwritesExisting(t *testing.T) {
	dir := t.TempDir()
	oldArt := mustEncodeImageSize("jpeg", 16, 16)
	if err := os.WriteFile(filepath.Join(dir, "cover.jpg"), oldArt, 0o644); err != nil {
		t.Fatal(err)
	}
	newArt := mustEncodeImageSize("jpeg", 32, 32)

	wrote, err := replaceFolderCover(dir, newArt, "image/jpeg")
	if err != nil {
		t.Fatal(err)
	}
	if !wrote {
		t.Fatal("replaceFolderCover must report wrote=true on success")
	}
	got, err := os.ReadFile(filepath.Join(dir, "cover.jpg"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(got, oldArt) {
		t.Error("cover.jpg still holds the OLD art — replace did not overwrite")
	}
	// normalizeCover passes a conforming (within-cap, RGB) JPEG through
	// losslessly, so the written bytes should equal the new source.
	if !bytes.Equal(got, newArt) {
		t.Error("cover.jpg does not hold the new art bytes")
	}
}

// TestReplaceFolderCoverRemovesStaleName proves the old file is actually
// GONE from the folder, not just shadowed by a same-priority-or-lower file
// sitting alongside it. writeFolderCover always names its output
// "cover.<ext>" regardless of what the prior cover was called — so a prior
// folder.png must be moved to the Trash during replace, or it would linger on
// disk after a "replace".
func TestReplaceFolderCoverRemovesStaleName(t *testing.T) {
	dir := t.TempDir()
	oldArt := mustEncodeImageSize("png", 16, 16)
	oldPath := filepath.Join(dir, "folder.png")
	if err := os.WriteFile(oldPath, oldArt, 0o644); err != nil {
		t.Fatal(err)
	}
	newArt := mustEncodeImageSize("jpeg", 32, 32)

	wrote, err := replaceFolderCover(dir, newArt, "image/jpeg")
	if err != nil {
		t.Fatal(err)
	}
	if !wrote {
		t.Fatal("replaceFolderCover must report wrote=true on success")
	}
	if _, statErr := os.Stat(oldPath); !os.IsNotExist(statErr) {
		t.Errorf("folder.png must leave the folder, not sit alongside the new cover.jpg (stat err: %v)", statErr)
	}
	newPath := filepath.Join(dir, "cover.jpg")
	if _, statErr := os.Stat(newPath); statErr != nil {
		t.Errorf("cover.jpg must exist after replace: %v", statErr)
	}
}

// TestReplaceFolderCoverNoExistingCover proves replace also works as a
// plain "write" when the album has no cover yet — the normal
// materializeCoverForAlbumDir path must remain reachable/unaffected for
// albums that never had a cover replaced.
func TestReplaceFolderCoverNoExistingCover(t *testing.T) {
	dir := t.TempDir()
	newArt := mustEncodeImageSize("jpeg", 20, 20)

	wrote, err := replaceFolderCover(dir, newArt, "image/jpeg")
	if err != nil {
		t.Fatal(err)
	}
	if !wrote {
		t.Fatal("replaceFolderCover must report wrote=true even with no prior cover")
	}
	got, err := os.ReadFile(filepath.Join(dir, "cover.jpg"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, newArt) {
		t.Error("cover.jpg does not hold the new art bytes")
	}
}

// TestReplaceFolderCoverKeepsOldOnUndecodable locks BUG-077's ordering: when the
// replacement bytes do not decode (a truncated upload that still sniffs as an
// image), replace must report "didn't write" AND leave the user's existing cover
// exactly as it was. Before e1bdaea9 (2026-08-05) the stale stems were deleted
// first, so a bad replacement destroyed the only cover the album had.
func TestReplaceFolderCoverKeepsOldOnUndecodable(t *testing.T) {
	dir := t.TempDir()
	oldArt := mustEncodeImageSize("jpeg", 16, 16)
	oldPath := filepath.Join(dir, "cover.jpg")
	if err := os.WriteFile(oldPath, oldArt, 0o644); err != nil {
		t.Fatal(err)
	}
	// Header present, pixel data cut off: DecodeConfig may pass, Decode must not.
	truncated := pngBytes[:len(pngBytes)/2]

	wrote, err := replaceFolderCover(dir, truncated, "image/png")
	if err != nil {
		t.Fatalf("an undecodable replacement is a refusal, not an error: %v", err)
	}
	if wrote {
		t.Fatal("replaceFolderCover must not report wrote=true for bytes that do not decode")
	}
	got, err := os.ReadFile(oldPath)
	if err != nil {
		t.Fatalf("the existing cover.jpg must survive a refused replace: %v", err)
	}
	if !bytes.Equal(got, oldArt) {
		t.Error("the existing cover.jpg was altered by a refused replace")
	}
	if _, statErr := os.Stat(filepath.Join(dir, "cover.png")); !os.IsNotExist(statErr) {
		t.Errorf("no cover.png may be written from undecodable bytes (stat err: %v)", statErr)
	}
}

// TestMaterializeLeavesUndecodableCover (BUG-775): a cover we can't decode is
// left exactly as it is and nothing is written beside it. The old self-heal
// deleted it, which permanently removed people's own scans.
func TestMaterializeLeavesUndecodableCover(t *testing.T) {
	dir := t.TempDir()
	// Truncated PNG: header present, pixel data cut off → does not fully decode.
	corrupt := pngBytes[:len(pngBytes)/2]
	if err := os.WriteFile(filepath.Join(dir, "cover.png"), corrupt, 0o644); err != nil {
		t.Fatal(err)
	}
	writeMP3WithArt(t, dir, "01 track.mp3", "image/jpeg", id3v2.PTFrontCover, jpegBytes)

	wrote, err := materializeCoverForAlbumDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if wrote {
		t.Error("must not write a cover beside the person's own, readable or not")
	}
	if got, _ := os.ReadFile(filepath.Join(dir, "cover.png")); !bytes.Equal(got, corrupt) {
		t.Error("the undecodable cover.png must be left exactly as it was")
	}
	if _, statErr := os.Stat(filepath.Join(dir, "cover.jpg")); !os.IsNotExist(statErr) {
		t.Error("no cover.jpg should have been written")
	}
}

// TestMaterializeIgnoresBookletNamedCover: a Cover.pdf booklet is not a cover,
// is never touched, and doesn't stop a real cover being written beside it.
func TestMaterializeIgnoresBookletNamedCover(t *testing.T) {
	dir := t.TempDir()
	booklet := []byte("%PDF-1.4 booklet")
	if err := os.WriteFile(filepath.Join(dir, "Cover.pdf"), booklet, 0o644); err != nil {
		t.Fatal(err)
	}
	writeMP3WithArt(t, dir, "01 track.mp3", "image/jpeg", id3v2.PTFrontCover, jpegBytes)
	wrote, err := materializeCoverForAlbumDir(dir)
	if err != nil || !wrote {
		t.Fatalf("expected a cover written beside the booklet: wrote=%v err=%v", wrote, err)
	}
	if got, _ := os.ReadFile(filepath.Join(dir, "Cover.pdf")); !bytes.Equal(got, booklet) {
		t.Error("the booklet must be left exactly as it was")
	}
}

// TestReplaceFolderCoverKeepsBookletAndSameNameCover: an explicit replace moves
// only old PICTURES aside. A Cover.pdf booklet stays, and a prior "Cover.jpg"
// (the same file as "cover.jpg" on macOS) must not take the new cover with it.
func TestReplaceFolderCoverKeepsBookletAndSameNameCover(t *testing.T) {
	dir := t.TempDir()
	booklet := []byte("%PDF-1.4 booklet")
	if err := os.WriteFile(filepath.Join(dir, "Cover.pdf"), booklet, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "Cover.jpg"), mustEncodeImageSize("jpeg", 16, 16), 0o644); err != nil {
		t.Fatal(err)
	}
	newArt := mustEncodeImageSize("jpeg", 32, 32)
	if wrote, err := replaceFolderCover(dir, newArt, "image/jpeg"); err != nil || !wrote {
		t.Fatalf("replace: wrote=%v err=%v", wrote, err)
	}
	if got, _ := os.ReadFile(filepath.Join(dir, "Cover.pdf")); !bytes.Equal(got, booklet) {
		t.Error("the booklet must survive a cover replace")
	}
	cover := existingFolderCoverPath(dir)
	if cover == "" {
		t.Fatal("the new cover must still be there")
	}
	if got, _ := os.ReadFile(cover); !bytes.Equal(got, newArt) {
		t.Error("the folder must hold the new art")
	}
}

// TestFLACArtRoundTrip exercises the FLAC PICTURE-block path end to end on a
// real FLAC (built with ffmpeg+flac, like TestEncodeTagLand). Skipped when
// those binaries are absent.
func TestFLACArtRoundTrip(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not on PATH")
	}
	if _, err := exec.LookPath("flac"); err != nil {
		t.Skip("flac not on PATH")
	}
	tmp := t.TempDir()
	wav := filepath.Join(tmp, "in.wav")
	if out, err := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi",
		"-i", "sine=frequency=440:duration=1", "-ac", "2", "-ar", "44100", wav).CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg synth: %v %s", err, out)
	}
	flacPath := filepath.Join(tmp, "track.flac")
	if out, err := exec.Command("flac", "-s", "-f", "-o", flacPath, wav).CombinedOutput(); err != nil {
		t.Fatalf("flac encode: %v %s", err, out)
	}
	addFLACPicture(t, flacPath, jpegBytes, "image/jpeg", flacpicture.PictureTypeFrontCover)

	data, mime := flacArt(flacPath)
	if !bytes.Equal(data, jpegBytes) {
		t.Fatalf("flacArt bytes = %d, want %d", len(data), len(jpegBytes))
	}
	if mime != "image/jpeg" {
		t.Errorf("mime = %q, want image/jpeg", mime)
	}

	wrote, err := materializeCoverForAlbumDir(tmp)
	if err != nil || !wrote {
		t.Fatalf("materialize: wrote=%v err=%v", wrote, err)
	}
	got, _ := os.ReadFile(filepath.Join(tmp, "cover.jpg"))
	if !bytes.Equal(got, jpegBytes) {
		t.Error("materialized FLAC cover not faithful")
	}
}

func addFLACPicture(t *testing.T, path string, img []byte, mime string, ptype flacpicture.PictureType) {
	t.Helper()
	f, err := flac.ParseFile(path)
	if err != nil {
		t.Fatal(err)
	}
	pic, err := flacpicture.NewFromImageData(ptype, "", img, mime)
	if err != nil {
		t.Fatal(err)
	}
	block := pic.Marshal()
	f.Meta = append(f.Meta, &block)
	var buf bytes.Buffer
	if _, err := f.WriteTo(&buf); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}

func mustOpen(t *testing.T, path string) *os.File {
	t.Helper()
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { f.Close() })
	return f
}

// TestFLACArt_RealFile validates extraction against a real embedded-art FLAC
// from the user's library. Opt-in via COVER_TEST_FLAC so the suite stays
// portable.
func TestFLACArt_RealFile(t *testing.T) {
	p := os.Getenv("COVER_TEST_FLAC")
	if p == "" {
		t.Skip("set COVER_TEST_FLAC to a FLAC with embedded art to run")
	}
	data, mime := flacArt(p)
	if len(data) == 0 {
		t.Fatalf("no embedded art extracted from %s", p)
	}
	t.Logf("extracted %d bytes, mime=%q → %s", len(data), mime, imageExt(mime, data))
}
