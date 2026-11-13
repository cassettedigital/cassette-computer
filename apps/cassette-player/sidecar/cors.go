// CORS for the hub's HTTP API.
//
// The website at cassette.digital no longer calls the hub from a browser (the
// founder, 2026-10-29: its music pages point people to the app, and the shared
// local.cassette.digital certificate that made the call possible is retired), so
// no public origin is allowed. The desktop app reaches the hub through its own
// local server's /sidecar route, which sends no Origin. So a shipped hub allows
// no other origin at all: any page served on this computer, a dev server or a
// local tool, used to get every route just by being on :3000 or :3100 (BUG-858).
// Local development names its dev server where it starts a hub by hand
// (SIDECAR_CORS_ORIGINS in native/run-native.sh and docker-compose.dev.yml).
// There is deliberately NO wildcard — only named origins, plus same-origin (so
// the local :5173/rip station keeps working).
//
// Non-CORS callers (the desktop app's local server, the native app's Go HTTP
// client, curl, same-origin GETs) send no Origin header and always pass through
// untouched.

package main

import (
	"net/http"
	"strings"
)

// allowedRipOrigins is the cross-origin allowlist: empty unless
// SIDECAR_CORS_ORIGINS (comma-separated) names some, which only a hand-run dev
// hub does (BUG-858).
var allowedRipOrigins = corsOriginsFromEnv()

func corsOriginsFromEnv() map[string]bool {
	return parseOriginList(envOr("SIDECAR_CORS_ORIGINS", ""))
}

func parseOriginList(s string) map[string]bool {
	m := map[string]bool{}
	for _, p := range strings.Split(s, ",") {
		if o := strings.TrimSpace(strings.ToLower(p)); o != "" {
			m[o] = true
		}
	}
	return m
}

// originAllowed reports whether a caller may use the rip API. host is the
// request's Host header, used for the same-origin check.
func originAllowed(origin, host string) bool {
	o := strings.ToLower(strings.TrimSpace(origin))
	if o == "" {
		return true // not a CORS request: native app, curl, same-origin GET
	}
	if allowedRipOrigins[o] {
		return true
	}
	// Same-origin: the local :5173/rip station fetching its own sidecar may
	// send an Origin equal to the request Host. Compare host:port
	// scheme-agnostically so it works over both http and https. BUG-189: the
	// Host must ALSO be one of ours - a DNS-rebinding page sends a matching
	// Origin and Host on a domain that merely resolves here (see http-guards.go).
	if i := strings.Index(o, "://"); i >= 0 && strings.EqualFold(o[i+3:], host) && hostAllowed(host) {
		return true
	}
	return false
}

// crossSiteRefused says a page on another website made this request: the browser marks it
// Sec-Fetch-Site: cross-site, and an <img> or a link carries no Origin for originAllowed to refuse. A
// shipped hub answers no other website, so without this any page could load one of its pictures and
// tell from whether it arrived that Cassette is installed and running (BUG-870). Its own callers are
// never cross-site: the desktop app's window asks its own local server, which forwards the browser's
// same-origin mark; the hub's own pages are same-origin; the native helper, the shell and the phones
// send no Sec-Fetch-Site at all. A hand-run dev hub that names its dev servers (SIDECAR_CORS_ORIGINS)
// skips this, since a dev page on localhost asking 127.0.0.1 is another site to the browser.
func crossSiteRefused(r *http.Request) bool {
	if !strings.EqualFold(strings.TrimSpace(r.Header.Get("Sec-Fetch-Site")), "cross-site") {
		return false
	}
	return len(allowedRipOrigins) == 0
}

// corsMiddleware enforces the rip-API origin policy and answers preflight.
// Disallowed cross-origin callers are rejected with 403 — both the preflight
// and the actual request — rather than letting the rip command run while the
// browser silently swallows the response.
func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// BUG-189: refuse any request that does not name a host this sidecar is
		// reachable as, Origin or no Origin. The 127.0.0.1 bind alone does not
		// help against DNS rebinding, because the victim's browser is on this
		// same machine; pinning the Host header does.
		if !hostAllowed(r.Host) {
			http.Error(w, "host not allowed", http.StatusForbidden)
			return
		}
		if crossSiteRefused(r) {
			http.Error(w, "not for other sites", http.StatusForbidden)
			return
		}
		origin := r.Header.Get("Origin")
		allowed := originAllowed(origin, r.Host)

		if origin != "" && allowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Set("Access-Control-Max-Age", "600")
		}

		if origin != "" && !allowed {
			http.Error(w, "origin not allowed", http.StatusForbidden)
			return
		}

		// Preflight: answered here, never reaches the wrapped handler.
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next(w, r)
	}
}
