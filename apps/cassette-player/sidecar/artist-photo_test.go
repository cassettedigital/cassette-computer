package main

import (
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"path/filepath"
	"testing"
)

// writeTestArtistJPEG encodes img as dir/artist.jpg and returns the path.
func writeTestArtistJPEG(t *testing.T, dir string, img image.Image) string {
	t.Helper()
	p := filepath.Join(dir, "artist.jpg")
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := jpeg.Encode(f, img, &jpeg.Options{Quality: 95}); err != nil {
		t.Fatal(err)
	}
	return p
}

func fill(img *image.RGBA, c color.Color) {
	b := img.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			img.Set(x, y, c)
		}
	}
}

// artistPhotoHasPadBars is the ownership guard for the reheal: it must fire on the
// square-pad bars an OLD build baked in, and NEVER on a photo the person chose.
func TestArtistPhotoHasPadBars(t *testing.T) {
	const side = 200
	photo := color.RGBA{R: 200, G: 120, B: 40, A: 255}

	// Portrait source padded to square → brand-black bars LEFT and RIGHT.
	portrait := image.NewRGBA(image.Rect(0, 0, side, side))
	fill(portrait, coverPadColor)
	for y := 0; y < side; y++ {
		for x := 60; x < 140; x++ { // center vertical band = the real photo
			portrait.Set(x, y, photo)
		}
	}
	if p := writeTestArtistJPEG(t, t.TempDir(), portrait); !artistPhotoHasPadBars(p) {
		t.Error("portrait padded to square (L/R bars) should be detected as padded")
	}

	// Landscape source padded to square → brand-black bars TOP and BOTTOM.
	landscape := image.NewRGBA(image.Rect(0, 0, side, side))
	fill(landscape, coverPadColor)
	for y := 60; y < 140; y++ {
		for x := 0; x < side; x++ {
			landscape.Set(x, y, photo)
		}
	}
	if p := writeTestArtistJPEG(t, t.TempDir(), landscape); !artistPhotoHasPadBars(p) {
		t.Error("landscape padded to square (T/B bars) should be detected as padded")
	}

	// A native NON-square photo — no bars. Must be left alone.
	native := image.NewRGBA(image.Rect(0, 0, side, side*2/3))
	fill(native, color.RGBA{R: 90, G: 110, B: 130, A: 255})
	if p := writeTestArtistJPEG(t, t.TempDir(), native); artistPhotoHasPadBars(p) {
		t.Error("a native non-square photo must NOT be treated as padded")
	}

	// A person's own EDGE-TO-EDGE square photo — square, but no brand bars. Must
	// be left untouched so the reheal never overrides a choice.
	square := image.NewRGBA(image.Rect(0, 0, side, side))
	fill(square, color.RGBA{R: 70, G: 140, B: 90, A: 255})
	if p := writeTestArtistJPEG(t, t.TempDir(), square); artistPhotoHasPadBars(p) {
		t.Error("an edge-to-edge square photo (no brand bars) must NOT be treated as padded")
	}
}
