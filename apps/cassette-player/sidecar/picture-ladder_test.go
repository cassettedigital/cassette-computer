package main

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestLadderRung(t *testing.T) {
	for _, c := range []struct{ size, want int }{
		{-5, 0}, {0, 0}, {1, 120}, {92, 120}, {120, 120}, {121, 240}, {300, 480}, {600, 800}, {801, 1200}, {1400, 1200},
	} {
		if got := ladderRung(c.size); got != c.want {
			t.Errorf("ladderRung(%d) = %d, want %d", c.size, got, c.want)
		}
	}
}

// A cover with see-through parts is kept as PNG: JPEG would turn them black.
func TestLadderCopy_SeeThroughStaysPNG(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	img := image.NewNRGBA(image.Rect(0, 0, 1000, 500))
	for x := 0; x < 1000; x++ {
		for y := 0; y < 500; y++ {
			img.Set(x, y, color.NRGBA{200, 40, 40, uint8(x % 256)})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(t.TempDir(), "cover.png")
	if err := os.WriteFile(src, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(src)
	made, ct := ladderCopy(src, info, 240)
	if made == "" || ct != "image/png" {
		t.Fatalf("ladderCopy = %q, %q; want a PNG copy", made, ct)
	}
	f, err := os.Open(made)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	cfg, err := png.DecodeConfig(f)
	if err != nil || cfg.Width != 240 || cfg.Height != 120 {
		t.Errorf("copy is %dx%d (%v), want 240x120", cfg.Width, cfg.Height, err)
	}
}

// A picture Go cannot read (HEIC, TIFF, AVIF in a person's folder) is sent as it is.
func TestLadderCopy_UnreadableServesOriginal(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	src := filepath.Join(t.TempDir(), "cover.heic")
	if err := os.WriteFile(src, []byte("\x00\x00\x00\x18ftypheic not really"), 0o644); err != nil {
		t.Fatal(err)
	}
	info, _ := os.Stat(src)
	if made, _ := ladderCopy(src, info, 240); made != "" {
		t.Errorf("an unreadable picture made a copy (%s); it should be sent as it is", made)
	}
}

// writeLadderPNG writes a w x h opaque PNG and returns its path and info.
func writeLadderPNG(t *testing.T, w, h int) (string, os.FileInfo) {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		for y := 0; y < h; y++ {
			img.Set(x, y, color.RGBA{uint8(x), uint8(y), 90, 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	src := filepath.Join(t.TempDir(), "cover.png")
	if err := os.WriteFile(src, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(src)
	if err != nil {
		t.Fatal(err)
	}
	return src, info
}

// BUG-869: a picture past ladderMaxPixels is sent as it is, never decoded.
func TestLadderCopy_TooBigServesOriginal(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	src, info := writeLadderPNG(t, 600, 400)
	was := ladderMaxPixels
	ladderMaxPixels = 600*400 - 1
	defer func() { ladderMaxPixels = was }()
	if made, _ := ladderCopy(src, info, 240); made != "" {
		t.Fatalf("a picture past the pixel cap was decoded into %s", made)
	}
	ladderMaxPixels = 600 * 400
	if made, _ := ladderCopy(src, info, 240); made == "" {
		t.Fatal("a picture at the pixel cap should still be made smaller")
	}
}

// BUG-869: only len(ladderSlots) pictures are decoded at once; the next waits for a slot, then finds the
// size another request made while it waited.
func TestLadderCopy_WaitsForASlot(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	src, info := writeLadderPNG(t, 600, 400)
	for i := 0; i < cap(ladderSlots); i++ {
		ladderSlots <- struct{}{}
	}
	done := make(chan string, 1)
	go func() {
		made, _ := ladderCopy(src, info, 240)
		done <- made
	}()
	select {
	case made := <-done:
		t.Fatalf("a picture was decoded with every slot taken (%q)", made)
	case <-time.After(150 * time.Millisecond):
	}
	<-ladderSlots
	var made string
	select {
	case made = <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("a freed slot didn't let the waiting picture through")
	}
	for i := 1; i < cap(ladderSlots); i++ {
		<-ladderSlots
	}
	if made == "" {
		t.Fatal("no copy made once a slot was free")
	}

	// many at once: every one gets the same copy, and nothing half-made is left behind
	var wg sync.WaitGroup
	got := make([]string, 12)
	src2, info2 := writeLadderPNG(t, 640, 480)
	for i := range got {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			got[i], _ = ladderCopy(src2, info2, 120)
		}(i)
	}
	wg.Wait()
	for i, g := range got {
		if g == "" || g != got[0] {
			t.Fatalf("request %d got %q, request 0 got %q", i, g, got[0])
		}
	}
	entries, _ := os.ReadDir(filepath.Dir(got[0]))
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "making-") {
			t.Errorf("half-made file left behind: %s", e.Name())
		}
	}
	if len(entries) != 2 {
		t.Errorf("cache holds %d files, want 2 (one size of each picture)", len(entries))
	}
}

// Over the cap, the least recently used sizes go first, down to 80% of the cap; a half-made file left
// by a crash goes too.
func TestPruneLadder(t *testing.T) {
	dir := t.TempDir()
	old := time.Now().Add(-48 * time.Hour)
	write := func(name string, n int, mod time.Time) {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, bytes.Repeat([]byte{1}, n), 0o644); err != nil {
			t.Fatal(err)
		}
		_ = os.Chtimes(p, mod, mod)
	}
	for i := 0; i < 10; i++ {
		write("a"+strings.Repeat("x", i)+".jpg", 100, old.Add(time.Duration(i)*time.Minute))
	}
	write("making-1.jpg", 50, old)
	removed, _ := pruneLadder(dir, 500) // 1000 bytes held; back to 400
	if removed != 7 {
		t.Errorf("removed %d files, want 7 (6 oldest sizes + the half-made one)", removed)
	}
	if _, err := os.Stat(filepath.Join(dir, "a"+strings.Repeat("x", 9)+".jpg")); err != nil {
		t.Error("the most recently used size was removed")
	}
	if _, err := os.Stat(filepath.Join(dir, "a.jpg")); err == nil {
		t.Error("the least recently used size survived")
	}
}

// Navidrome gets the ladder's quality and a bigger picture cache, unless the launcher or the person set
// their own.
func TestWithPictureDefaults(t *testing.T) {
	got := strings.Join(withPictureDefaults([]string{"PATH=/bin"}), " ")
	if !strings.Contains(got, "ND_COVERARTQUALITY=85") || !strings.Contains(got, "ND_IMAGECACHESIZE=1GB") {
		t.Errorf("defaults not added: %s", got)
	}
	got = strings.Join(withPictureDefaults([]string{"ND_IMAGECACHESIZE=200MB"}), " ")
	if strings.Contains(got, "ND_IMAGECACHESIZE=1GB") || !strings.Contains(got, "ND_IMAGECACHESIZE=200MB") {
		t.Errorf("a set value was overridden: %s", got)
	}
}
