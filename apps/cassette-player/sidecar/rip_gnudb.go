// gnudb — the dense, TOC-keyed identification rung (JOB 1).
//
// MusicBrainz's disc-ID index is sparse (crowd-submitted), so a mainstream
// commercial CD with no submitted MB disc ID and no CD-TEXT has nothing to match
// against — it falls to "Unknown album" even though Apple (via licensed
// Gracenote) names it instantly. gnudb is the free open successor to CDDB/freedb:
// a dense database keyed by the *freedb disc ID*, a looser TOC fingerprint than
// the MusicBrainz disc ID. This file computes that fingerprint from the TOC the
// sidecar already parses and queries gnudb over its CDDB-protocol HTTP gateway.
//
// The freedb disc ID is a DIFFERENT, looser fingerprint than the MusicBrainz
// disc ID (rip_discid.go), so both are kept — they key different databases.
//
// Endpoint note: the legacy freedb.freedb.org host is dead; gnudb.org is the
// living successor and serves the same CDDB protocol at the gateway below. The
// live round-trip is the one seam only a physical disc fully confirms (like
// cd-paranoia's sector read); the freedb-ID computation and the response parser
// are pure and unit-tested.

package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	// Bound the per-disc `read` fan-out (one read per candidate match).
	gnudbReadCap = 4

	// Confidence weights by freedb match type. The freedb disc ID already encodes
	// the TOC, so an EXACT (200) hit is a TOC-fingerprint match — high confidence,
	// though below an MB exact disc ID (1.0) because freedb IDs collide more often.
	// An INEXACT (211) hit is a near-miss that the user should confirm, so it
	// lands in the confirm band (below confidenceAutoSelect).
	gnudbExactWeight   = 0.95
	gnudbInexactWeight = 0.62
)

// sharedHTTPClient is the single client the non-MusicBrainz external lookups
// (the iTunes Search API, the Cover Art Archive) share — so we don't stand up a
// duplicate client per source. It follows redirects (CAA 302s /front → image).
// MusicBrainz keeps its own path (mbGet).
var sharedHTTPClient = &http.Client{Timeout: 20 * time.Second}

// gnudbHTTPClient is dedicated to gnudb because the CDDB CGI is served over plain
// HTTP and the HTTPS path 404s — so we must NEVER follow a redirect that could
// upgrade the scheme. ErrUseLastResponse returns the redirect response as-is
// instead of following it.
var gnudbHTTPClient = &http.Client{
	Timeout: 20 * time.Second,
	CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

// gnudb endpoint + client identity.
//
// Host: gnudb's CDDB-over-HTTP gateway. MUST be reachable over plain http:// —
// the HTTPS vhost 404s on /~cddb/cddb.cgi (confirmed live 2026-06-21; gnudb's
// own howto documents http). proto=6 (set per-request) selects UTF-8 responses.
// GNUDB_HOST lets the operator point at their registered uniqcode host
// (<uniqcode>.gnudb.org) as gnudb's registration asks; defaults to the shared
// gnudb.gnudb.org.
//
// Client name: gnudb's gateway only honors client names on its recognized list —
// an unlisted name (incl. "cassette") is rejected "500 Unknown <name>", and this
// is INDEPENDENT of uniqcode registration (proven 2026-06-25: the uniqcode host
// rejects "cassette" too). To get "cassette" listed, email info@gnudb.org; until
// then GNUDB_CLIENT_NAME must be an already-recognized client (e.g. libcddb) or
// every lookup 500s. The contact email becomes the hello user@host.
var (
	gnudbHost        = envOr("GNUDB_HOST", "gnudb.gnudb.org")
	gnudbEndpoint    = "http://" + gnudbHost + "/~cddb/cddb.cgi"
	gnudbClientName  = envOr("GNUDB_CLIENT_NAME", "cassette")
	gnudbContactMail = envOr("GNUDB_CONTACT_EMAIL", "fork@cassette.digital")
)

// gnudbHelloString builds the CDDB hello param: "<user> <host> <client> <ver>".
// user/host come from the contact email so gnudb sees a valid-looking address.
func gnudbHelloString() string {
	user, host := "cassette", "cassette.digital"
	if at := strings.IndexByte(gnudbContactMail, '@'); at > 0 {
		user, host = gnudbContactMail[:at], gnudbContactMail[at+1:]
	}
	return fmt.Sprintf("%s %s %s 1.0", user, host, gnudbClientName)
}

// gnudbLimiter holds gnudb requests to a polite 1 req/sec — the SAME limiter
// pattern (mbLimiter) the MusicBrainz path uses, a separate instance because
// it's a different host.
var gnudbLimiter = &mbLimiter{interval: time.Second}

// gnudbHit is one parsed gnudb entry plus whether it came from an exact (200) or
// inexact (211) freedb-ID match.
type gnudbHit struct {
	release *MatchedRelease
	exact   bool
}

// ── freedb disc ID (the TOC fingerprint gnudb is keyed by) ───────────────────

// cddbSum sums the decimal digits of n (the freedb checksum primitive).
func cddbSum(n int) int {
	s := 0
	for n > 0 {
		s += n % 10
		n /= 10
	}
	return s
}

// freedbDiscID computes the 32-bit freedb/CDDB disc ID from a TOC:
//
//	id = ((checksum % 0xff) << 24) | (total_seconds << 8) | num_tracks
//
// checksum = Σ digitsum(track_offset_frames / 75); total_seconds = leadout/75 −
// firstTrack/75. Track offsets are absolute CD frames (75/sec, incl. the 150
// lead-in) — exactly what TOC.TrackOffsets already holds.
func freedbDiscID(toc *TOC) uint32 {
	checksum := 0
	for _, off := range toc.TrackOffsets {
		checksum += cddbSum(off / 75)
	}
	first := 0
	if len(toc.TrackOffsets) > 0 {
		first = toc.TrackOffsets[0]
	}
	totalSeconds := toc.LeadoutOffset/75 - first/75
	n := len(toc.TrackOffsets)
	return uint32(((checksum % 0xff) << 24) | (totalSeconds << 8) | n)
}

// freedbDiscIDHex is the 8-char lowercase-hex disc ID used in CDDB requests.
func freedbDiscIDHex(toc *TOC) string {
	return fmt.Sprintf("%08x", freedbDiscID(toc))
}

// cddbQueryArgs builds the `cddb query` argument string:
//
//	<discid> <ntrks> <off1> <off2> … <offN> <nsecs>
//
// where offs are per-track frame offsets and nsecs is the lead-out position in
// seconds (total disc length).
func cddbQueryArgs(toc *TOC) string {
	parts := make([]string, 0, len(toc.TrackOffsets)+3)
	parts = append(parts, freedbDiscIDHex(toc), strconv.Itoa(len(toc.TrackOffsets)))
	for _, off := range toc.TrackOffsets {
		parts = append(parts, strconv.Itoa(off))
	}
	parts = append(parts, strconv.Itoa(toc.LeadoutOffset/75))
	return strings.Join(parts, " ")
}

// ── gnudb client ─────────────────────────────────────────────────────────────

// gnudbGet performs one rate-limited CDDB command over the HTTP gateway and
// returns the raw response body. cmd is the bare command (e.g. "cddb query …").
func gnudbGet(cmd string) (string, error) {
	if ripFixtureMode {
		return "", fmt.Errorf("gnudb skipped in fixture mode")
	}
	_ = gnudbLimiter.Wait(context.Background())
	u := fmt.Sprintf("%s?cmd=%s&hello=%s&proto=6",
		gnudbEndpoint, url.QueryEscape(cmd), url.QueryEscape(gnudbHelloString()))
	req, _ := http.NewRequest(http.MethodGet, u, nil)
	req.Header.Set("User-Agent", mbUserAgent)
	resp, err := gnudbHTTPClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		// A redirect (e.g. an http→https upgrade to the 404ing path) lands here.
		return "", fmt.Errorf("gnudb HTTP %d", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	return string(body), nil
}

// gnudbLookup runs the query→read flow and returns the parsed candidate entries
// with their match type. Best-effort: any failure yields nil (never a gate — the
// rip proceeds regardless). Track durations are filled from the TOC so the
// candidate scores through the existing scorer's hard track-count gate.
func gnudbLookup(toc *TOC) []gnudbHit {
	qresp, err := gnudbGet("cddb query " + cddbQueryArgs(toc))
	if err != nil {
		log.Printf("gnudb: query failed (%v) for freedb %s — rung 2 contributed nothing", err, freedbDiscIDHex(toc))
		return nil
	}
	// Make a server-side rejection observable instead of silent. "500 Unknown
	// <client>" means GNUDB_CLIENT_NAME isn't registered (email info@gnudb.org);
	// "202" is a normal no-match.
	if code, _ := splitCode(strings.TrimSpace(firstNonEmptyLine(qresp))); code == 500 {
		log.Printf("gnudb: server rejected the request: %.80q — set GNUDB_CLIENT_NAME to a registered client (email info@gnudb.org to register %q)",
			firstNonEmptyLine(qresp), gnudbClientName)
		return nil
	}
	matches := parseGnudbQuery(qresp)
	tocDur := tocTrackDurationsMs(toc)

	var hits []gnudbHit
	for i, m := range matches {
		if i >= gnudbReadCap {
			break
		}
		rresp, err := gnudbGet(fmt.Sprintf("cddb read %s %s", m.category, m.discID))
		if err != nil {
			continue
		}
		entry := parseGnudbRead(rresp)
		if entry.album == "" || len(entry.titles) == 0 {
			continue
		}
		rel := &MatchedRelease{
			Album:       entry.album,
			AlbumArtist: entry.artist,
			Date:        entry.year,
			GnudbID:     m.category + "/" + m.discID, // crosswalk: the gnudb entry id
			TrackCount:  len(entry.titles),
		}
		for j, title := range entry.titles {
			dur := 0
			if j < len(tocDur) {
				dur = tocDur[j]
			}
			rel.Tracks = append(rel.Tracks, RippedTrackMeta{
				Position: toc.FirstTrack + j,
				Title:    strings.TrimSpace(title),
				Artist:   entry.artist,
				LengthMs: dur,
			})
		}
		hits = append(hits, gnudbHit{release: rel, exact: m.exact})
	}
	return hits
}

// gnudbConfidence scores a gnudb hit: the scorer's hard track-count gate
// (a wrong count → 0) times the freedb match-type weight. Duration alignment is
// trivially perfect for gnudb (durations come from the same TOC), so the match
// type — not the duration — is what separates an auto-select from a confirm.
func gnudbConfidence(hit gnudbHit, tocDur []int) float64 {
	base := scoreCandidate(hit.release, tocDur, nil) // enforces the track-count hard gate
	if base <= 0 {
		return 0
	}
	if hit.exact {
		return base * gnudbExactWeight
	}
	return base * gnudbInexactWeight
}

// ── response parsing (pure; unit-tested) ─────────────────────────────────────

type gnudbMatch struct {
	category string
	discID   string
	dtitle   string
	exact    bool
}

// parseGnudbQuery parses a `cddb query` response into candidate matches.
//
//	200 <cat> <id> <dtitle>                       — exact, single match
//	211 …                                         — inexact / multiple; lines follow
//	  <cat> <id> <dtitle>                          (until a lone ".")
//	210 …                                         — exact, multiple; lines follow
//	202                                            — no match
func parseGnudbQuery(resp string) []gnudbMatch {
	lines := strings.Split(strings.ReplaceAll(resp, "\r\n", "\n"), "\n")
	if len(lines) == 0 {
		return nil
	}
	code, rest := splitCode(strings.TrimSpace(lines[0]))
	switch code {
	case 200: // exact single match — the rest of line 0 is "<cat> <id> <dtitle>"
		if m, ok := parseMatchLine(rest, true); ok {
			return []gnudbMatch{m}
		}
	case 210, 211: // multiple matches, one per following line until "."
		exact := code == 210
		var out []gnudbMatch
		for _, ln := range lines[1:] {
			ln = strings.TrimSpace(ln)
			if ln == "." || ln == "" {
				if ln == "." {
					break
				}
				continue
			}
			if m, ok := parseMatchLine(ln, exact); ok {
				out = append(out, m)
			}
		}
		return out
	}
	return nil
}

// parseMatchLine parses "<category> <discid> <dtitle>".
func parseMatchLine(s string, exact bool) (gnudbMatch, bool) {
	s = strings.TrimSpace(s)
	parts := strings.SplitN(s, " ", 3)
	if len(parts) < 3 || parts[0] == "" || parts[1] == "" {
		return gnudbMatch{}, false
	}
	return gnudbMatch{category: parts[0], discID: parts[1], dtitle: strings.TrimSpace(parts[2]), exact: exact}, true
}

type gnudbEntry struct {
	artist string
	album  string
	year   string
	titles []string
}

// parseGnudbRead parses a `cddb read` entry (key=value lines). DTITLE is
// "Artist / Album"; TTITLEn are per-track titles in order; DYEAR is the year.
// Lines starting with "#" are comments; the entry ends at a lone ".".
func parseGnudbRead(resp string) gnudbEntry {
	var e gnudbEntry
	titleByIdx := map[int]string{}
	maxIdx := -1
	for _, raw := range strings.Split(strings.ReplaceAll(resp, "\r\n", "\n"), "\n") {
		line := strings.TrimRight(raw, "\r")
		t := strings.TrimSpace(line)
		if t == "." {
			break
		}
		if t == "" || strings.HasPrefix(t, "#") {
			continue
		}
		key, val, ok := splitKV(line)
		if !ok {
			continue
		}
		switch {
		case key == "DTITLE":
			// "Artist / Album". gnudb wraps long values across multiple DTITLE
			// lines (concatenate), so append.
			e.album += val // temp accumulate raw, split after
		case key == "DYEAR":
			if e.year == "" {
				e.year = strings.TrimSpace(val)
			}
		case strings.HasPrefix(key, "TTITLE"):
			if idx, err := strconv.Atoi(strings.TrimPrefix(key, "TTITLE")); err == nil {
				titleByIdx[idx] += val // concatenate wrapped values
				if idx > maxIdx {
					maxIdx = idx
				}
			}
		}
	}
	// Split the accumulated DTITLE into artist / album.
	if e.album != "" {
		if i := strings.Index(e.album, " / "); i >= 0 {
			e.artist = strings.TrimSpace(e.album[:i])
			e.album = strings.TrimSpace(e.album[i+3:])
		} else {
			e.album = strings.TrimSpace(e.album)
		}
	}
	for i := 0; i <= maxIdx; i++ {
		e.titles = append(e.titles, strings.TrimSpace(titleByIdx[i]))
	}
	return e
}

// splitCode pulls a leading integer status code off a CDDB response line,
// returning the code and the remainder.
func splitCode(s string) (int, string) {
	i := strings.IndexByte(s, ' ')
	if i < 0 {
		if n, err := strconv.Atoi(s); err == nil {
			return n, ""
		}
		return -1, s
	}
	n, err := strconv.Atoi(s[:i])
	if err != nil {
		return -1, s
	}
	return n, strings.TrimSpace(s[i+1:])
}

// splitKV splits a "KEY=value" line. The key is everything before the first '='.
func splitKV(s string) (key, val string, ok bool) {
	i := strings.IndexByte(s, '=')
	if i <= 0 {
		return "", "", false
	}
	return strings.TrimSpace(s[:i]), s[i+1:], true
}
