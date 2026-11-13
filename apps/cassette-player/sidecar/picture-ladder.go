// The image ladder on the hub (docs/reference/CASSETTE_IMAGES.md; plan docs/CASSETTE_IMAGE_LADDER_PLAN.md
// section 12). A person's own covers and artist photos are shown at the same five sizes as every other
// picture Cassette shows (imageRungs, generated from packages/cassette-kit tokens.json), made here, on
// their own computer, from the file in their folder, and kept in the OS cache folder (on macOS
// ~/Library/Caches/Cassette/picture-ladder). Their folders are only ever read: a made size never goes
// into a music folder.
//
// A size is made the first time something asks for it and kept until the cache passes its cap, oldest
// first. Each copy is named by the source's path, its modified time and the rung, so a cover changed in
// the app or by hand in Finder gets fresh copies and the old ones age out.

package main

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"log"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	xdraw "golang.org/x/image/draw"
)

const (
	// ladderJPEGQuality matches the quality Navidrome is started with (supervisor.go), so a cover looks
	// the same on the desktop and on the phones.
	ladderJPEGQuality = 85
	// ladderCacheCap bounds the cache folder; pruning takes it back to 80% of this, oldest first.
	ladderCacheCap   = 512 << 20
	ladderPruneEvery = 10 * time.Minute
)

var (
	// ladderSlots bounds how many pictures are decoded at once (BUG-869). A decoded original holds 1.5
	// to 4 bytes a pixel, so a 6000px cover takes 54 to 144 MB while it is made smaller, and a grid of
	// covers nobody has shown yet asks for all of them together: unbounded, that could take gigabytes.
	// A request waits for a slot; each size is made once and kept, so the wait is only ever the first time.
	ladderSlots = make(chan struct{}, 3)
	// ladderMaxPixels: a picture with more pixels than this is sent as it is instead of being decoded (a
	// poster or a scan dropped in a folder; covers are rarely past 25 million). Decoded, this many pixels is
	// 75 to 200 MB.
	ladderMaxPixels int64 = 50_000_000
)

// ladderRung is the rung for a requested size: the smallest rung that holds it, the top rung for
// anything larger, 0 (the original) when no size was asked.
func ladderRung(size int) int {
	if size <= 0 {
		return 0
	}
	for _, r := range imageRungs {
		if size <= r {
			return r
		}
	}
	return imageRungs[len(imageRungs)-1]
}

func ladderCacheDir() (string, error) {
	base, err := os.UserCacheDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "Cassette", "picture-ladder"), nil
}

// ladderCopy returns the made size of the picture at src for rung, and its content type. It returns ""
// (serve the original) when no rung was asked, the picture already fits inside the rung, it is in a
// format Go cannot read (HEIC, TIFF, AVIF), or anything goes wrong: the original always works.
func ladderCopy(src string, info os.FileInfo, rung int) (string, string) {
	if rung <= 0 {
		return "", ""
	}
	dir, err := ladderCacheDir()
	if err != nil {
		return "", ""
	}
	defer pruneLadderSoon(dir)
	sum := sha1.Sum([]byte(src))
	stem := fmt.Sprintf("%s-%d-%d", hex.EncodeToString(sum[:8]), info.ModTime().UnixNano(), rung)
	if p, ct, ok := ladderMade(dir, stem); ok {
		return p, ct
	}

	f, err := os.Open(src)
	if err != nil {
		return "", ""
	}
	defer f.Close()
	cfg, _, err := image.DecodeConfig(f) // the header only: a picture that already fits is never decoded
	if err != nil || (cfg.Width <= rung && cfg.Height <= rung) {
		return "", ""
	}
	if int64(cfg.Width)*int64(cfg.Height) > ladderMaxPixels {
		return "", ""
	}
	ladderSlots <- struct{}{}
	defer func() { <-ladderSlots }()
	if p, ct, ok := ladderMade(dir, stem); ok { // made by another request while this one waited
		return p, ct
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return "", ""
	}
	img, _, err := image.Decode(f)
	if err != nil {
		return "", ""
	}
	b := img.Bounds()
	scale := float64(rung) / float64(max(b.Dx(), b.Dy()))
	w := max(1, int(math.Round(float64(b.Dx())*scale)))
	h := max(1, int(math.Round(float64(b.Dy())*scale)))
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	xdraw.CatmullRom.Scale(dst, dst.Bounds(), img, b, xdraw.Src, nil)

	// JPEG unless the picture has see-through parts, which JPEG would turn black
	ext := ".jpg"
	if o, ok := img.(interface{ Opaque() bool }); ok && !o.Opaque() {
		ext = ".png"
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", ""
	}
	tmp, err := os.CreateTemp(dir, "making-*"+ext)
	if err != nil {
		return "", ""
	}
	if ext == ".png" {
		err = png.Encode(tmp, dst)
	} else {
		err = jpeg.Encode(tmp, dst, &jpeg.Options{Quality: ladderJPEGQuality})
	}
	if cerr := tmp.Close(); err == nil {
		err = cerr
	}
	out := filepath.Join(dir, stem+ext)
	if err == nil {
		err = os.Rename(tmp.Name(), out)
	}
	if err != nil {
		os.Remove(tmp.Name())
		return "", ""
	}
	return out, ladderContentType(ext)
}

// ladderMade is the size already made under stem, if there is one.
func ladderMade(dir, stem string) (string, string, bool) {
	for _, ext := range []string{".jpg", ".png"} {
		p := filepath.Join(dir, stem+ext)
		if st, err := os.Stat(p); err == nil && st.Size() > 0 {
			if time.Since(st.ModTime()) > 24*time.Hour {
				now := time.Now()
				_ = os.Chtimes(p, now, now) // in use: keep it out of the next prune
			}
			return p, ladderContentType(ext), true
		}
	}
	return "", "", false
}

func ladderContentType(ext string) string {
	if ext == ".png" {
		return "image/png"
	}
	return "image/jpeg"
}

var (
	ladderPruneMu   sync.Mutex
	ladderPrunedAt  time.Time
	ladderOldFolder sync.Once
)

// pruneLadderSoon runs pruneLadder in the background at most once every ladderPruneEvery.
func pruneLadderSoon(dir string) {
	ladderPruneMu.Lock()
	due := time.Since(ladderPrunedAt) >= ladderPruneEvery
	if due {
		ladderPrunedAt = time.Now()
	}
	ladderPruneMu.Unlock()
	if !due {
		return
	}
	go func() {
		// the three-size cache this replaced (cover-thumbs, 300 / 600 only, never cleaned): our own cache
		// files, never the person's
		ladderOldFolder.Do(func() { _ = os.RemoveAll(filepath.Join(filepath.Dir(dir), "cover-thumbs")) })
		if n, freed := pruneLadder(dir, ladderCacheCap); n > 0 {
			log.Printf("picture-ladder: pruned %d sizes (%d MB) to stay under %d MB", n, freed>>20, ladderCacheCap>>20)
		}
	}()
}

// pruneLadder deletes the least recently used sizes until the folder is back under 80% of capBytes, and
// any half-made file left by a crash. It returns how many files it removed and how many bytes they held.
func pruneLadder(dir string, capBytes int64) (int, int64) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0, 0
	}
	type kept struct {
		path string
		size int64
		mod  time.Time
	}
	var files []kept
	var total, freed int64
	removed := 0
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		p := filepath.Join(dir, e.Name())
		if strings.HasPrefix(e.Name(), "making-") {
			if time.Since(info.ModTime()) > time.Hour && os.Remove(p) == nil {
				removed++
				freed += info.Size()
			}
			continue
		}
		files = append(files, kept{p, info.Size(), info.ModTime()})
		total += info.Size()
	}
	if total <= capBytes {
		return removed, freed
	}
	sort.Slice(files, func(i, j int) bool { return files[i].mod.Before(files[j].mod) })
	target := capBytes / 5 * 4
	for _, f := range files {
		if total <= target {
			break
		}
		if os.Remove(f.path) == nil {
			total -= f.size
			freed += f.size
			removed++
		}
	}
	return removed, freed
}
