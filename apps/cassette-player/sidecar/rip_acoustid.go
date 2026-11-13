// AcoustID — audio-fingerprint identification (JOB 2/3).
//
// Some discs are in NO TOC-keyed database (no MusicBrainz disc ID, not in
// gnudb, no CD-TEXT) — the Eve 6 case the audit proved. The only thing left that
// uniquely identifies them is the AUDIO itself. We read ~120s of one track,
// fingerprint it with Chromaprint's fpcalc, and ask AcoustID which MusicBrainz
// recordings match. AcoustID gives identity (which recording); the disc's TOC
// then disambiguates WHICH release/pressing, via the existing scoreCandidate.
//
// This is a DELIBERATE action, not an on-insert rung: it reads audio and takes a
// few seconds, so it runs only when the user taps "Figure it out" (JOB 3). It is
// gated behind a free ACOUSTID_API_KEY; with no key the rung skips cleanly.
//
// Privacy (CASSETTE_OPEN_DATA_CONTRIBUTION.md): only the one-way fingerprint and
// the integer duration leave the machine — never audio samples, never file
// paths. The scratch WAV is deleted after fingerprinting.

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

const (
	fpcalcBin    = "fpcalc"
	acoustidBase = "https://api.acoustid.org"
	// fingerprintSpan reads the first 2 minutes of a track (fpcalc caps at 120s
	// anyway). cd-paranoia clamps to the track end if it's shorter.
	fingerprintSpanEnd = "02:00.00"
	// Drop AcoustID results below this acoustic score before resolving releases.
	acoustidMinScore = 0.5
	// Bound the per-scan MusicBrainz tracklist fetches (cost rail).
	acoustidReleaseFetchCap = 5
)

// acoustidLimiter holds AcoustID lookups to a polite 1 req/sec (well under
// AcoustID's documented 3 req/s ceiling). Same limiter pattern as the others.
var acoustidLimiter = &mbLimiter{interval: time.Second}

// scanActive guards the deliberate AcoustID scan so two can't run at once and so
// it never overlaps a rip (both touch the drive).
var scanActive atomic.Bool

func acoustidKey() string  { return os.Getenv("ACOUSTID_API_KEY") }
func acoustidEnabled() bool { return acoustidKey() != "" }

// ── AcoustID API shapes (only the fields we read) ────────────────────────────

type acoustIDResp struct {
	Status string `json:"status"`
	Error  *struct {
		Message string `json:"message"`
	} `json:"error"`
	Results []struct {
		ID         string  `json:"id"`
		Score      float64 `json:"score"`
		Recordings []struct {
			ID       string `json:"id"`
			Releases []struct {
				ID string `json:"id"`
			} `json:"releases"`
		} `json:"recordings"`
	} `json:"results"`
}

// ── Fingerprint a track ──────────────────────────────────────────────────────

// fingerprintTrack reads ~120s of one track to a scratch WAV via cd-paranoia and
// fingerprints it with fpcalc. Returns the compressed fingerprint + integer
// duration. The scratch audio is always cleaned up; nothing lands in the library.
func fingerprintTrack(trackPos int) (fingerprint string, durationSec int, err error) {
	if ripFixtureMode {
		return "", 0, fmt.Errorf("acoustid skipped in fixture mode")
	}
	if _, e := exec.LookPath(fpcalcBin); e != nil {
		return "", 0, fmt.Errorf("fpcalc not installed (brew install chromaprint / bundle it)")
	}
	tmp, err := os.MkdirTemp("", "cassette-fp-")
	if err != nil {
		return "", 0, err
	}
	defer os.RemoveAll(tmp) // scratch audio cleaned up unconditionally

	wav := filepath.Join(tmp, "fp.wav")
	// "<pos>[00:00.00]-<pos>[02:00.00]" reads the first 2 minutes of the track.
	span := fmt.Sprintf("%d[00:00.00]-%d[%s]", trackPos, trackPos, fingerprintSpanEnd)
	out, runErr := exec.Command(cdParanoiaBin, "-w", span, wav).CombinedOutput()
	if fi, statErr := os.Stat(wav); statErr != nil || fi.Size() == 0 {
		return "", 0, fmt.Errorf("cd-paranoia fingerprint read: %v: %.150s", runErr, out)
	}

	fpOut, err := exec.Command(fpcalcBin, "-json", wav).Output()
	if err != nil {
		return "", 0, fmt.Errorf("fpcalc: %w", err)
	}
	var fc struct {
		Fingerprint string  `json:"fingerprint"`
		Duration    float64 `json:"duration"`
	}
	if err := json.Unmarshal(fpOut, &fc); err != nil {
		return "", 0, fmt.Errorf("fpcalc json: %w", err)
	}
	if fc.Fingerprint == "" {
		return "", 0, fmt.Errorf("fpcalc produced an empty fingerprint")
	}
	return fc.Fingerprint, int(fc.Duration + 0.5), nil
}

// ── AcoustID lookup ──────────────────────────────────────────────────────────

// acoustidReleaseMBIDs sends the fingerprint + duration to AcoustID and returns
// the matched MusicBrainz RELEASE MBIDs (best acoustic score first, deduped).
// Only the fingerprint + duration leave the machine. nil on any failure.
func acoustidReleaseMBIDs(fingerprint string, durationSec int) []string {
	form := url.Values{}
	form.Set("client", acoustidKey())
	form.Set("fingerprint", fingerprint)
	form.Set("duration", strconv.Itoa(durationSec))
	form.Set("format", "json")
	form.Set("meta", "releaseids+recordingids")

	_ = acoustidLimiter.Wait(context.Background())
	// POST — the fingerprint is too long for a safe GET querystring.
	req, _ := http.NewRequest(http.MethodPost, acoustidBase+"/v2/lookup", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", mbUserAgent)
	resp, err := sharedHTTPClient.Do(req)
	if err != nil {
		log.Printf("acoustid: lookup request failed: %v", err)
		return nil
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var ar acoustIDResp
	if err := json.Unmarshal(body, &ar); err != nil {
		log.Printf("acoustid: decode failed: %v", err)
		return nil
	}
	if ar.Status != "ok" {
		msg := ar.Status
		if ar.Error != nil {
			msg = ar.Error.Message
		}
		log.Printf("acoustid: lookup error: %s", msg)
		return nil
	}
	rels := acoustidReleasesFromResp(ar)
	// Diagnostic: make a "no usable candidates" outcome explainable — separate
	// "AcoustID had no/weak match" (few results, low top score, 0 releases ≥ min)
	// from a downstream track-count rejection (releases present, all score 0).
	topScore := 0.0
	for _, r := range ar.Results {
		if r.Score > topScore {
			topScore = r.Score
		}
	}
	log.Printf("acoustid: lookup ok — %d result(s), top acoustic score %.2f, %d release MBID(s) ≥ min score %.2f",
		len(ar.Results), topScore, len(rels), acoustidMinScore)
	return rels
}

// acoustidReleasesFromResp extracts the matched release MBIDs from a parsed
// response: drop results below acoustidMinScore, then dedupe release MBIDs in
// best-score-first order. Pure — unit-tested.
func acoustidReleasesFromResp(ar acoustIDResp) []string {
	var out []string
	seen := map[string]bool{}
	for _, res := range ar.Results {
		if res.Score < acoustidMinScore {
			continue
		}
		for _, rec := range res.Recordings {
			for _, rel := range rec.Releases {
				if rel.ID != "" && !seen[rel.ID] {
					seen[rel.ID] = true
					out = append(out, rel.ID)
				}
			}
		}
	}
	return out
}

// acoustidScoredCandidates is the full rung: fingerprint track 1, look it up,
// resolve each matched release's tracklist from MusicBrainz, and score it against
// the disc TOC (track-count hard gate + duration alignment). AcoustID's acoustic
// score gives identity; the TOC scorer confirms the pressing — so a high AcoustID
// score with a TOC mismatch still loses. Source "acoustid".
func acoustidScoredCandidates(toc *TOC) (cands []*RipScoredCandidate, fingerprint string) {
	tocDur := tocTrackDurationsMs(toc)
	n := len(tocDur)

	fp, dur, err := fingerprintTrack(toc.FirstTrack)
	if err != nil {
		log.Printf("acoustid: fingerprint failed: %v", err)
		return nil, ""
	}
	log.Printf("acoustid: fingerprinted track %d — %d-byte fp, %ds (disc has %d tracks)", toc.FirstTrack, len(fp), dur, n)
	relMBIDs := acoustidReleaseMBIDs(fp, dur)
	if len(relMBIDs) == 0 {
		log.Printf("acoustid: no usable release MBIDs — disc isn't in AcoustID's fingerprint DB (or every match was below min score)")
		return nil, fp
	}

	discID, _ := toc.DiscID()
	var out []*RipScoredCandidate
	fetched := 0
	for _, mbid := range relMBIDs {
		if fetched >= acoustidReleaseFetchCap {
			break
		}
		fetched++
		rel := fetchReleaseTracklist(mbid, n)
		if rel == nil {
			log.Printf("acoustid: release %s — MusicBrainz tracklist fetch empty/failed", mbid)
			continue
		}
		rel.DiscID = discID
		s := scoreCandidate(rel, tocDur, nil)
		if s <= 0 {
			log.Printf("acoustid: release %s %q dropped — %d tracks vs disc %d (track-count gate)", mbid, rel.Album, rel.TrackCount, n)
			continue
		}
		log.Printf("acoustid: release %s %q kept — score %.2f", mbid, rel.Album, s)
		out = append(out, &RipScoredCandidate{Release: rel, Confidence: s, Source: "acoustid", Sources: []string{"acoustid"}})
	}
	return out, fp
}

// ── The deliberate scan (JOB 3) ──────────────────────────────────────────────

// scanningProgress is the quiet in-progress state shown while the AcoustID scan
// reads + fingerprints the disc.
func scanningProgress() *RipProgress {
	return &RipProgress{
		State: "detecting", Message: "Listening to the disc…",
		DrivePresent: true, DiscPresent: true, PermissionState: "granted",
	}
}

// runAcoustIDScan fingerprints the disc, merges any AcoustID candidates into the
// stashed resolution, and re-publishes the result — a confident match (→ the
// confident state) or more guesses (→ the not-confident state). Best-effort:
// on no match it falls back to whatever the instant rungs already had.
func runAcoustIDScan(dr *detectResult) {
	defer scanActive.Store(false)
	publishRip(scanningProgress())

	found, fingerprint := acoustidScoredCandidates(dr.toc)
	// JOB 1/7 — the fingerprint and the recordings it matched are intrinsic facts;
	// stamp them on the profile so they persist into the disc-identity record and
	// become rung-zero / cross-pressing-cluster keys for future inserts.
	if dr.profile != nil {
		if fingerprint != "" {
			dr.profile.Fingerprint = fingerprint
		}
		dr.profile.RecordingMBIDs = recordingMBIDsOf(found)
	}
	merged := resolutionFromScored(mergeScored(dr.res.Candidates, found))
	merged.Profile = dr.profile
	// BUG-261: re-apply the multi-disc sibling bias after the AcoustID merge, so a
	// fingerprint-driven single-disc match is steered onto the set's release too.
	// Idempotent when the instant-rung pass already promoted it (same release wins).
	if dr.profile != nil {
		applySiblingSetBias(merged, dr.profile, tocTrackDurationsMs(dr.toc), dr.discID, dr.cdtext)
	}
	// Layer 1 — if the merged winner holds an MBID but placeholder titles (e.g. the
	// cached local_memory candidate outranked a fresh one), fill the real titles.
	if merged.Release != nil {
		ensureRealTitles(merged.Release)
	}
	dr2 := &detectResult{res: merged, toc: dr.toc, discID: dr.discID, cdtext: dr.cdtext, profile: dr.profile}
	pendingResolution.Store(dr2)
	if found == nil {
		log.Printf("acoustid: scan found no usable candidates for freedb %s", freedbDiscIDHex(dr.toc))
	}
	publishDetected(dr2)
}

// recordingMBIDsOf collects the distinct recording MBIDs across a candidate set
// — the pressing-independent keys that link cross-pressing clusters.
func recordingMBIDsOf(cands []*RipScoredCandidate) []string {
	seen := map[string]bool{}
	var out []string
	for _, c := range cands {
		if c == nil || c.Release == nil {
			continue
		}
		for _, t := range c.Release.Tracks {
			if t.RecordingMBID != "" && !seen[t.RecordingMBID] {
				seen[t.RecordingMBID] = true
				out = append(out, t.RecordingMBID)
			}
		}
	}
	return out
}

// resolutionFromScored builds a RipResolution from a candidate slice: keep
// score>0, best-first, capped at maxCandidates, best becomes the release.
func resolutionFromScored(cands []*RipScoredCandidate) *RipResolution {
	out := make([]*RipScoredCandidate, 0, len(cands))
	for _, c := range cands {
		if c != nil && c.Confidence > 0 {
			out = append(out, c)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Confidence > out[j].Confidence })
	if len(out) > maxCandidates {
		out = out[:maxCandidates]
	}
	res := &RipResolution{Candidates: out}
	if len(out) > 0 {
		res.Release = out[0].Release
		res.Confidence = out[0].Confidence
	}
	return res
}

// handleRipAcoustID triggers the deliberate audio-fingerprint scan ("Figure it
// out", JOB 3/5c). Returns immediately; the scan publishes progress + the result
// via the status poll. Skips cleanly (200, unavailable:true) when no key is set.
func handleRipAcoustID(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if ripActive.Load() {
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "alreadyRipping": true, "error": "A rip is already in progress."})
		return
	}
	if !acoustidEnabled() {
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "unavailable": true, "error": "Audio identification isn’t set up yet (no AcoustID key)."})
		return
	}
	dr := pendingResolution.Load()
	if dr == nil || dr.toc == nil {
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "No disc detected. Detect the disc first."})
		return
	}
	if !scanActive.CompareAndSwap(false, true) {
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": "Already listening to the disc."})
		return
	}
	go runAcoustIDScan(dr)
	_, _ = w.Write([]byte(`{"ok":true}`))
}
