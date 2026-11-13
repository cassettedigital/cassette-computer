package main

import (
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// BUG-188: a GET with no Origin - the <img src=...> shape any web page can
// produce - must never reach a state-changing rip handler.
func TestPostOnlyRejectsGetBeforeHandler(t *testing.T) {
	reached := false
	h := corsMiddleware(postOnly(func(w http.ResponseWriter, r *http.Request) { reached = true }))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "http://localhost:5173/api/rip/start", nil)
	h(rec, req)
	if reached {
		t.Fatal("GET reached the rip handler - the never-rip-unprompted rule is open from any web page")
	}
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET must be 405, got %d", rec.Code)
	}
	if rec.Header().Get("Allow") != http.MethodPost {
		t.Fatalf("405 must advertise Allow: POST, got %q", rec.Header().Get("Allow"))
	}

	reached = false
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodPost, "http://localhost:5173/api/rip/start", nil)
	h(rec, req)
	if !reached {
		t.Fatal("a plain POST from a non-CORS caller (native app, curl) must still reach the handler")
	}
}

// A cross-site POST carries an Origin the browser sets; an unknown one is
// refused by corsMiddleware before the method check even matters.
func TestPostOnlyCrossSitePostStillNeedsAllowedOrigin(t *testing.T) {
	reached := false
	h := corsMiddleware(postOnly(func(w http.ResponseWriter, r *http.Request) { reached = true }))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "http://localhost:5173/api/rip/start", nil)
	req.Header.Set("Origin", "https://evil.example")
	h(rec, req)
	if reached || rec.Code != http.StatusForbidden {
		t.Fatalf("cross-site POST from an unknown origin must be 403 and never reach the handler (reached=%v code=%d)", reached, rec.Code)
	}
}

// withDevOrigins stands in for a hand-run dev hub started with
// SIDECAR_CORS_ORIGINS naming the web dev servers (native/run-native.sh).
func withDevOrigins(t *testing.T) {
	t.Helper()
	prev := allowedRipOrigins
	allowedRipOrigins = parseOriginList("http://localhost:3100,http://localhost:3000")
	t.Cleanup(func() { allowedRipOrigins = prev })
}

// Preflights are answered by corsMiddleware and never see the 405.
func TestPostOnlyPreflightStillAnswered(t *testing.T) {
	withDevOrigins(t)
	h := corsMiddleware(postOnly(func(w http.ResponseWriter, r *http.Request) { t.Fatal("preflight reached the handler") }))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodOptions, "http://localhost:5173/api/rip/start", nil)
	req.Header.Set("Origin", "http://localhost:3100")
	req.Header.Set("Access-Control-Request-Method", "POST")
	h(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("preflight from the local dev server must be 204, got %d", rec.Code)
	}
}

// The website no longer reaches the hub from a browser (2026-10-29): its origins
// are refused like any other public site's, preflight and request alike.
func TestWebsiteOriginRefused(t *testing.T) {
	for _, origin := range []string{"https://cassette.digital", "https://www.cassette.digital"} {
		for _, method := range []string{http.MethodOptions, http.MethodPost} {
			reached := false
			h := corsMiddleware(func(w http.ResponseWriter, r *http.Request) { reached = true })
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(method, "http://localhost:5173/api/rip/start", nil)
			req.Header.Set("Origin", origin)
			req.Header.Set("Access-Control-Request-Method", "POST")
			h(rec, req)
			if reached || rec.Code != http.StatusForbidden {
				t.Fatalf("%s from %s must be 403 and never reach the handler (reached=%v code=%d)", method, origin, reached, rec.Code)
			}
		}
	}
}

// BUG-858: with no SIDECAR_CORS_ORIGINS, a hub trusts no other origin, the dev
// ports included, preflight and request alike, on the trash route and the rest.
func TestNoCrossOriginAllowedByDefault(t *testing.T) {
	t.Setenv("SIDECAR_CORS_ORIGINS", "")
	if got := corsOriginsFromEnv(); len(got) != 0 {
		t.Fatalf("default cross-origin allowlist = %v, want empty", got)
	}
	prev := allowedRipOrigins
	allowedRipOrigins = corsOriginsFromEnv()
	t.Cleanup(func() { allowedRipOrigins = prev })

	for _, origin := range []string{"http://localhost:3000", "http://localhost:3100", "http://127.0.0.1:3100"} {
		for _, method := range []string{http.MethodOptions, http.MethodPost} {
			reached := false
			h := corsMiddleware(func(w http.ResponseWriter, r *http.Request) { reached = true })
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(method, "http://localhost:5173/api/library/trash", nil)
			req.Header.Set("Origin", origin)
			req.Header.Set("Access-Control-Request-Method", "POST")
			h(rec, req)
			if reached || rec.Code != http.StatusForbidden {
				t.Fatalf("%s from %s must be 403 by default (reached=%v code=%d)", method, origin, reached, rec.Code)
			}
			if rec.Header().Get("Access-Control-Allow-Origin") != "" {
				t.Fatalf("%s from %s must get no allow header", method, origin)
			}
		}
	}
	// The app's own path (no Origin, through its /sidecar route) is untouched.
	reached := false
	h := corsMiddleware(func(w http.ResponseWriter, r *http.Request) { reached = true })
	h(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "http://127.0.0.1:5173/api/library/trash", nil))
	if !reached {
		t.Fatal("a request with no Origin must still reach the handler")
	}
}

// A dev hub that names its dev servers lets exactly those through.
func TestDevOriginsFromEnv(t *testing.T) {
	t.Setenv("SIDECAR_CORS_ORIGINS", " http://localhost:3100 , HTTP://LOCALHOST:3000,")
	got := corsOriginsFromEnv()
	if len(got) != 2 || !got["http://localhost:3100"] || !got["http://localhost:3000"] {
		t.Fatalf("parsed dev origins = %v", got)
	}
}

// BUG-189: only hosts this sidecar is actually reachable as pass.
func TestHostAllowed(t *testing.T) {
	yes := []string{
		"localhost:5173", "localhost", "127.0.0.1:5173", "127.0.0.1", "[::1]:5173", "::1",
		"local.cassette.digital:5173", "local.cassette.digital",
		"abc123.local.cassette.digital:5173", "LOCALHOST:5173", "Local.Cassette.Digital",
	}
	// The machine's own advertised name (lanHostname) and its own interface
	// addresses are ours too - that is the phone's LAN path (BUG-078).
	if hn, err := os.Hostname(); err == nil && hn != "" {
		yes = append(yes, hn+":5173", strings.TrimSuffix(strings.ToLower(hn), ".local")+".local:5173")
	}
	for ip := range ownHosts() {
		if net.ParseIP(ip) != nil && !strings.Contains(ip, ":") {
			yes = append(yes, ip+":5173")
		}
	}
	for _, h := range yes {
		if !hostAllowed(h) {
			t.Errorf("hostAllowed(%q) = false, want true", h)
		}
	}
	no := []string{
		"", "evil.example:5173", "evil.example", "cassette.digital:5173", "www.cassette.digital",
		"notlocal.cassette.digital", "local.cassette.digital.evil.example:5173",
		"192.168.1.20:5173", "10.0.0.5", "localhost.evil.example",
	}
	for _, h := range no {
		if hostAllowed(h) {
			t.Errorf("hostAllowed(%q) = true, want false", h)
		}
	}
}

// The DNS-rebinding shape: Origin and Host agree, but on a host that is not ours.
func TestCorsMiddlewareRefusesUnknownHostEvenWhenOriginMatches(t *testing.T) {
	reached := false
	h := corsMiddleware(func(w http.ResponseWriter, r *http.Request) { reached = true })

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "http://evil.example:5173/api/library/trash", nil)
	req.Host = "evil.example:5173"
	req.Header.Set("Origin", "http://evil.example:5173")
	h(rec, req)
	if reached || rec.Code != http.StatusForbidden {
		t.Fatalf("rebinding request must be 403 and never reach the handler (reached=%v code=%d)", reached, rec.Code)
	}

	// ...and with NO Origin at all (a simple same-origin GET from the rebound page).
	reached = false
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "http://evil.example:5173/api/rip/status.json", nil)
	req.Host = "evil.example:5173"
	h(rec, req)
	if reached || rec.Code != http.StatusForbidden {
		t.Fatalf("no-Origin request to an unknown Host must be 403 (reached=%v code=%d)", reached, rec.Code)
	}

	// The genuine same-origin case (the local /rip station) still works.
	reached = false
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "http://localhost:5173/api/rip/status.json", nil)
	req.Host = "localhost:5173"
	req.Header.Set("Origin", "http://localhost:5173")
	h(rec, req)
	if !reached || rec.Code != http.StatusOK {
		t.Fatalf("same-origin request on a known host must pass (reached=%v code=%d)", reached, rec.Code)
	}
}

// BUG-870: a page on another website loading one of the hub's pictures (an <img>, so no Origin) is
// refused, so it can't tell Cassette is installed and running. The desktop app (same-origin, forwarded by
// its own local server), a typed address ("none") and native callers (no header) still get through; a
// hand-run dev hub that names its dev servers lets them in.
func TestCrossSitePictureRefused(t *testing.T) {
	prev := allowedRipOrigins
	allowedRipOrigins = map[string]bool{}
	t.Cleanup(func() { allowedRipOrigins = prev })

	for _, path := range []string{"/api/library/artist-photo?trackId=abc", "/api/playback/cover?id=abc", "/api/rip/status.json"} {
		for site, want := range map[string]bool{"cross-site": false, "Cross-Site": false, "same-origin": true, "same-site": true, "none": true, "": true} {
			reached := false
			h := corsMiddleware(func(w http.ResponseWriter, r *http.Request) { reached = true })
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:5173"+path, nil)
			if site != "" {
				req.Header.Set("Sec-Fetch-Site", site)
			}
			h(rec, req)
			if reached != want {
				t.Errorf("%s with Sec-Fetch-Site %q: reached=%v, want %v (status %d)", path, site, reached, want, rec.Code)
			}
			if !want && rec.Code != http.StatusForbidden {
				t.Errorf("%s cross-site: status %d, want 403", path, rec.Code)
			}
		}
	}

	allowedRipOrigins = parseOriginList("http://localhost:3100")
	reached := false
	h := corsMiddleware(func(w http.ResponseWriter, r *http.Request) { reached = true })
	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:5173/api/library/artist-photo?trackId=abc", nil)
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	h(httptest.NewRecorder(), req)
	if !reached {
		t.Fatal("a dev hub that names its dev servers must still answer their pictures")
	}
}
