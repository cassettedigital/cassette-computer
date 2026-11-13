// Real-audio visualizer feed (sidecar half).
//
// Two browser-facing endpoints, both CORS-wrapped like the rest of
// /api/playback/*:
//
//   GET /api/playback/levels           — a live spectrum/waveform/level frame,
//                                         proxied from the Swift engine's tap on
//                                         :5174 (the only process with the PCM).
//                                         Fail-soft to an idle frame so the web
//                                         poller never has to special-case a miss.
//   GET /api/playback/palette?trackId= — the current cover's dominant colors,
//                                         computed here from the same Navidrome
//                                         getCoverArt bytes the cover proxy uses.
//                                         Lets the browser follow the album's
//                                         colors WITHOUT a cross-origin pixel read.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"image"
	"io"
	"math"
	"net/http"
	"sort"
	"strings"
	"time"
)

// ─── Live levels (proxy of Swift /levels) ──────────────────────────────────────

func handlePlaybackLevels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// The frame source is per-OS: macOS proxies the Swift engine's PCM tap; other
	// engines (mpv) have no equivalent and fall back to the idle frame.
	playbackOut.writeLevels(w)
}

func writeLevelsIdle(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = io.WriteString(w, `{"bins":[],"wave":[],"level":0}`)
}

// ─── Cover palette (computed from Navidrome getCoverArt bytes) ──────────────────

type coverPalette struct {
	Bg      string   `json:"bg"`
	Ink     string   `json:"ink"`
	Accent  string   `json:"accent"`
	Accent2 string   `json:"accent2"`
	Palette []string `json:"palette"`
}

func handlePlaybackPalette(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	trackID := strings.TrimSpace(r.URL.Query().Get("trackId"))
	if !isPlausibleTrackID(trackID) {
		http.Error(w, "bad trackId", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	coverID := resolveCoverArtID(ctx, trackID)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, subsonicCoverArtURL(coverID, imageRungs[0]), nil)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	defer resp.Body.Close()
	ct := resp.Header.Get("Content-Type")
	if resp.StatusCode != http.StatusOK || !strings.HasPrefix(ct, "image/") {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	// Decoders (jpeg/png/gif/webp) are registered by cover-art.go's blank imports.
	img, _, err := image.Decode(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "max-age=86400")
	_ = json.NewEncoder(w).Encode(computeCoverPalette(img))
}

// computeCoverPalette samples the cover on a coarse grid and picks an
// accent-forward palette (mirrors the web's client-side extractor so the two
// paths agree). No allocation-heavy scaling — a strided sample of At() is plenty
// for a handful of colors.
func computeCoverPalette(img image.Image) coverPalette {
	b := img.Bounds()
	stepX := b.Dx() / 32
	if stepX < 1 {
		stepX = 1
	}
	stepY := b.Dy() / 32
	if stepY < 1 {
		stepY = 1
	}
	type sample struct{ r, g, bl, sat, val, lum, hue float64 }
	samples := make([]sample, 0, 1100)
	var ar, ag, ab float64
	for y := b.Min.Y; y < b.Max.Y; y += stepY {
		for x := b.Min.X; x < b.Max.X; x += stepX {
			cr, cg, cb, _ := img.At(x, y).RGBA()
			r := float64(cr >> 8)
			g := float64(cg >> 8)
			bl := float64(cb >> 8)
			ar += r
			ag += g
			ab += bl
			mx := math.Max(r, math.Max(g, bl))
			mn := math.Min(r, math.Min(g, bl))
			val := mx / 255
			sat := 0.0
			if mx > 0 {
				sat = (mx - mn) / mx
			}
			samples = append(samples, sample{r, g, bl, sat, val, (0.299*r + 0.587*g + 0.114*bl) / 255, palHue(r, g, bl)})
		}
	}
	n := float64(len(samples))
	if n == 0 {
		return coverPalette{Bg: "#141210", Ink: "#efe6d6", Accent: "#e87830", Accent2: "#d4a020", Palette: []string{"#e87830", "#d4a020"}}
	}
	accent := samples[0]
	for _, q := range samples {
		if q.sat*q.val > accent.sat*accent.val {
			accent = q
		}
	}
	accent2 := sample{r: accent.bl, g: accent.r, bl: accent.g} // channel-rotate complement fallback
	best := 0.0
	for _, q := range samples {
		if palHueDist(q.hue, accent.hue) > 40 && q.sat*q.val > best {
			best = q.sat * q.val
			accent2 = q
		}
	}
	bright := samples[0]
	for _, q := range samples {
		if q.lum > bright.lum {
			bright = q
		}
	}
	ink := sample{r: (bright.r + 255) / 2, g: (bright.g + 255) / 2, bl: (bright.bl + 255) / 2}
	bg := sample{r: ar / n * 0.18, g: ag / n * 0.18, bl: ab / n * 0.2}

	vib := make([]sample, 0, len(samples))
	for _, q := range samples {
		if q.sat > 0.3 && q.val > 0.35 {
			vib = append(vib, q)
		}
	}
	sort.Slice(vib, func(i, j int) bool { return vib[i].sat*vib[i].val > vib[j].sat*vib[j].val })
	if len(vib) > 6 {
		vib = vib[:6]
	}
	for len(vib) < 2 {
		vib = append(vib, accent, accent2)
	}
	sort.Slice(vib, func(i, j int) bool { return vib[i].lum < vib[j].lum })
	ramp := make([]string, 0, len(vib))
	for _, q := range vib {
		ramp = append(ramp, palHex(q.r, q.g, q.bl))
	}
	return coverPalette{
		Bg:      palHex(bg.r, bg.g, bg.bl),
		Ink:     palHex(ink.r, ink.g, ink.bl),
		Accent:  palHex(accent.r, accent.g, accent.bl),
		Accent2: palHex(accent2.r, accent2.g, accent2.bl),
		Palette: ramp,
	}
}

func palHue(r, g, b float64) float64 {
	mx := math.Max(r, math.Max(g, b))
	mn := math.Min(r, math.Min(g, b))
	d := mx - mn
	if d == 0 {
		return 0
	}
	var h float64
	switch mx {
	case r:
		h = math.Mod((g-b)/d, 6)
	case g:
		h = (b-r)/d + 2
	default:
		h = (r-g)/d + 4
	}
	h *= 60
	if h < 0 {
		h += 360
	}
	return h
}

func palHueDist(a, b float64) float64 {
	d := math.Mod(math.Abs(a-b), 360)
	if d > 180 {
		d = 360 - d
	}
	return d
}

func palHex(r, g, b float64) string {
	c := func(v float64) int {
		if v < 0 {
			return 0
		}
		if v > 255 {
			return 255
		}
		return int(v + 0.5)
	}
	return fmt.Sprintf("#%02x%02x%02x", c(r), c(g), c(b))
}
