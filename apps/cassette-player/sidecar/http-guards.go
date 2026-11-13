// HTTP guards for the local API (BUG-188, BUG-189).
//
// Two holes the 2026-08-12 cleanup audit found in the same review:
//
//   - BUG-188: /api/rip/start (and every other state-changing rip endpoint) never
//     checked the HTTP method, and the origin policy deliberately passes requests
//     that carry no Origin header (native app, curl). A plain
//     <img src="http://localhost:5173/api/rip/start"> on ANY web page produces
//     exactly that shape - a GET with no Origin - and would start ripping the disc
//     in the drive. Browsers attach an Origin header to cross-site POSTs, so
//     requiring POST on mutations lets the existing 403 in corsMiddleware cover
//     them. Every real caller already POSTs: the hosted dashboard (postSidecar),
//     the local /rip station, and the native disc watcher (notify()).
//
//   - BUG-189: the same-origin branch of originAllowed trusted the request's Host
//     header, so a DNS-rebinding page (attacker domain re-resolving to 127.0.0.1)
//     sends matching Origin and Host and passes for the whole surface. Nothing
//     pinned what Host is allowed to be. Now every request through corsMiddleware
//     must name one of the hosts this sidecar is actually reachable as, and so
//     must the navigated pages outside it (hostOnly, BUG-857).
package main

import (
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
)

// postOnly rejects anything but POST with 405 before the handler runs. OPTIONS
// preflights never reach here (corsMiddleware answers them first), so this
// wrapper sits INSIDE corsMiddleware at the route registration.
func postOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", http.MethodPost)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		next(w, r)
	}
}

// hostOnly refuses a request whose Host is not one this sidecar answers to,
// before the handler runs (BUG-857). It is the BUG-189 Host pin for the pages a
// browser navigates to rather than fetches (/, /status.json, /rip), which skip
// corsMiddleware because they need no CORS.
func hostOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !hostAllowed(r.Host) {
			http.Error(w, "host not allowed", http.StatusForbidden)
			return
		}
		next(w, r)
	}
}

// localHostSuffix is the HTTPS portal domain: local.cassette.digital resolves to
// 127.0.0.1 (see cert.go), and <device-id>.local.cassette.digital is the
// per-device ACME name. Both are ours; anything else claiming to be this host
// is not.
const localHostSuffix = "local.cassette.digital"

// extraAllowedHosts lets a deliberate deployment widen the Host allowlist without
// a rebuild (comma-separated hostnames or IPs, no port) - e.g. a LAN hostname
// once phones talk to the sidecar directly (BUG-078), or a container name when
// SIDECAR_BIND_ADDR is 0.0.0.0. Empty by default: loopback + portal only.
var extraAllowedHosts = parseOriginList(envOr("SIDECAR_ALLOWED_HOSTS", ""))

// ownHostNames is this machine's own names and addresses, computed once: the
// hostname the sidecar advertises to the cloud as lanHostname (the phone reaches
// `http://<lanHostname>:<sidecarPort>` for on-demand convergence, BUG-078), its
// mDNS form, and every non-loopback unicast address on its interfaces. A
// rebinding page cannot use any of these - its Host is the attacker's domain,
// never our own literal - so accepting them keeps the LAN path open at no cost.
var (
	ownHostOnce  sync.Once
	ownHostNames map[string]bool
)

func ownHosts() map[string]bool {
	ownHostOnce.Do(func() {
		m := map[string]bool{}
		if hn, err := os.Hostname(); err == nil && hn != "" {
			hn = strings.ToLower(hn)
			m[hn] = true
			m[strings.TrimSuffix(hn, ".local")+".local"] = true
		}
		if addrs, err := net.InterfaceAddrs(); err == nil {
			for _, a := range addrs {
				var ip net.IP
				switch v := a.(type) {
				case *net.IPNet:
					ip = v.IP
				case *net.IPAddr:
					ip = v.IP
				}
				if ip != nil && !ip.IsLoopback() && (ip.IsGlobalUnicast() || ip.IsLinkLocalUnicast()) {
					m[strings.ToLower(ip.String())] = true
				}
			}
		}
		ownHostNames = m
	})
	return ownHostNames
}

// hostAllowed reports whether a request's Host header names this sidecar. The
// port is ignored (the sidecar answers on :5173 and, when the shell proxies, on
// whatever it was handed); IPv6 literals may arrive bracketed, and a
// link-local IPv6 literal may carry a %zone suffix.
func hostAllowed(host string) bool {
	h := strings.ToLower(strings.TrimSpace(host))
	if h == "" {
		return false
	}
	// Strip the port. net.SplitHostPort handles "[::1]:5173" and "host:5173";
	// a bare host (no port) falls through unchanged.
	if hp, _, err := net.SplitHostPort(h); err == nil {
		h = hp
	}
	h = strings.TrimSuffix(strings.TrimPrefix(h, "["), "]")
	if i := strings.IndexByte(h, '%'); i >= 0 {
		h = h[:i]
	}
	switch h {
	case "localhost", "127.0.0.1", "::1", localHostSuffix:
		return true
	}
	if strings.HasSuffix(h, "."+localHostSuffix) {
		return true
	}
	if extraAllowedHosts[h] {
		return true
	}
	return ownHosts()[h]
}
