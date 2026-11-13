// The phones' way in over the home Wi-Fi, encrypted (BUG-870).
//
// Navidrome used to listen on the whole network in plain http, so a phone's music-server login and the music
// itself crossed the Wi-Fi in the clear, and for a moment on first launch anyone on the network could create its
// admin. Now Navidrome listens on this computer only, and the hub answers the network on Navidrome's old port in
// its place: TLS for phones that know this computer's key, plain http for phones from before (until they update),
// and only the Subsonic API the phones use, passed through to Navidrome, plus one ask of the hub itself: read the
// music folder again (lanConvergePath).
//
// The certificate is this computer's own, made once and kept for good: no shared key, no public issuer, nothing
// that renews (the founder, 2026-10-29). Phones don't check it against a name; they compare its public key with
// the one the cloud told them at pairing (lanTLSPin, sent on register and heartbeat). A new key (a wiped data
// folder) reaches them the same way.

package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// lanTLSPin is the SHA-256 of this computer's public key, base64: what a phone pins. Empty until lanCert has run.
var lanTLSPin string

// lanPortNum is the port the phones reach this computer on: the gateway's, else Navidrome's own (both 4533 as
// shipped, so the address the phones already have still works).
func lanPortNum() int {
	if n, err := strconv.Atoi(lanPort); err == nil && n > 0 {
		return n
	}
	if n, err := strconv.Atoi(envOr("ND_PORT", "4533")); err == nil && n > 0 {
		return n
	}
	return 4533
}

func lanTLSDir() string { return filepath.Join(sidecarDataDir, "lan-tls") }

// lanCert loads this computer's certificate, making it the first time. Its own folder, never <data>/certs, which
// the hub's loopback server would pick up as its own.
func lanCert() (tls.Certificate, error) {
	dir := lanTLSDir()
	certPath, keyPath := filepath.Join(dir, "cert.pem"), filepath.Join(dir, "key.pem")
	pair, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			log.Printf("lan-tls: the saved certificate won't load (%v); making a new one", err)
		}
		if pair, err = makeLANCert(dir, certPath, keyPath); err != nil {
			return tls.Certificate{}, err
		}
	}
	leaf, err := x509.ParseCertificate(pair.Certificate[0])
	if err != nil {
		return tls.Certificate{}, err
	}
	pair.Leaf = leaf
	sum := sha256.Sum256(leaf.RawSubjectPublicKeyInfo)
	lanTLSPin = base64.StdEncoding.EncodeToString(sum[:])
	return pair, nil
}

func makeLANCert(dir, certPath, keyPath string) (tls.Certificate, error) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 127))
	if err != nil {
		return tls.Certificate{}, err
	}
	tmpl := &x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: "Cassette on this computer"},
		NotBefore:    time.Now().Add(-time.Hour),
		// "No well-defined expiration" (RFC 5280 4.1.2.5): kept for good, never renewed.
		NotAfter:              time.Date(9999, 12, 31, 23, 59, 59, 0, time.UTC),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		return tls.Certificate{}, err
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return tls.Certificate{}, err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return tls.Certificate{}, err
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER})
	if err := atomicWriteFile(keyPath, keyPEM, 0o600); err != nil {
		return tls.Certificate{}, err
	}
	if err := atomicWriteFile(certPath, certPEM, 0o644); err != nil {
		return tls.Certificate{}, err
	}
	log.Printf("lan-tls: made this computer's certificate for the phones (%s)", dir)
	return tls.X509KeyPair(certPEM, keyPEM)
}

// lanPassesThrough is the part of Navidrome the phones use: the Subsonic API (music, covers, streams, downloads)
// and its health check. Navidrome's own web pages and native API stay on this computer.
func lanPassesThrough(path string) bool {
	return path == "/ping" || strings.HasPrefix(path, "/rest/")
}

// lanHandler passes the phones' requests through to Navidrome on loopback. Whatever a client says about where it
// is (X-Forwarded-For and friends) is dropped first, so Navidrome sees the phone's real address and nothing on the
// Wi-Fi can pass itself off as this computer.
func lanHandler(navidrome *url.URL) http.Handler {
	proxy := httputil.NewSingleHostReverseProxy(navidrome)
	direct := proxy.Director
	proxy.Director = func(r *http.Request) {
		for _, h := range []string{"X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto", "X-Real-Ip", "Forwarded"} {
			r.Header.Del(h)
		}
		direct(r)
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// The iPhone app checks the server is there with a plain request for the root before it signs in, and
		// takes any answer at or above 400 (401 aside) as "can't reach your computer" (Amperfy BackendProxy
		// checkServerReachablity). Answer it here, empty; Navidrome's own root would send it to its web pages,
		// which stay on this computer.
		if r.URL.Path == "/" && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
			w.WriteHeader(http.StatusOK)
			return
		}
		if r.URL.Path == lanConvergePath {
			lanConvergeDoor(navidrome, w, r)
			return
		}
		if !lanPassesThrough(r.URL.Path) {
			http.NotFound(w, r)
			return
		}
		proxy.ServeHTTP(w, r)
	})
}

// lanConvergePath is the one request to the hub itself a phone may make over the Wi-Fi: "read your music folder
// again and tell the cloud", which the iPhone's Resync Library and Home's pull-to-refresh ask before the phone
// re-reports what it holds. The hub's own server listens on this computer only, so until this door the phones'
// ask (made to the hub's own port) was refused every time and the button quietly did only the phone's half
// (BUG-078).
const lanConvergePath = "/api/library/converge"

// lanConverge is the hub's own rescan (handleLibraryConverge), a variable so a test can stand in for it.
var lanConverge http.HandlerFunc = handleLibraryConverge

// lanConvergeDoor lets a phone's rescan through when it comes encrypted, as a POST, from someone who can sign in to
// this computer's music server: the same Subsonic sign-in the phone already sends with every song (u with t and s,
// or p), checked by asking Navidrome itself. Plain http is refused: only phones that pin this computer's key use
// this door. The rescan coalesces with any already running, so asking twice costs one pass.
func lanConvergeDoor(navidrome *url.URL, w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	refuse := func(code int, why string) {
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "error": why})
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		refuse(http.StatusMethodNotAllowed, "POST only")
		return
	}
	if r.TLS == nil {
		refuse(http.StatusForbidden, "encrypted only")
		return
	}
	if !lanSignedIn(r.Context(), navidrome, r.URL.Query()) {
		refuse(http.StatusUnauthorized, "sign in to this computer's music first")
		return
	}
	log.Printf("lan-tls: a phone asked this computer to read its music folder again")
	lanConverge(w, r)
}

// lanSignedIn asks Navidrome whether the Subsonic sign-in in q is good: a ping with only those fields carried over.
func lanSignedIn(ctx context.Context, navidrome *url.URL, q url.Values) bool {
	user := q.Get("u")
	if user == "" || len(user) > 256 {
		return false
	}
	auth := url.Values{"u": {user}, "v": {"1.16.1"}, "c": {"cassette-lan"}, "f": {"json"}}
	switch {
	case q.Get("t") != "" && q.Get("s") != "":
		auth.Set("t", q.Get("t"))
		auth.Set("s", q.Get("s"))
	case q.Get("p") != "":
		auth.Set("p", q.Get("p"))
	default:
		return false
	}
	if len(auth.Encode()) > 2048 {
		return false
	}
	ping := *navidrome
	ping.Path = strings.TrimSuffix(ping.Path, "/") + "/rest/ping.view"
	ping.RawQuery = auth.Encode()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ping.String(), nil)
	if err != nil {
		return false
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	var body struct {
		Response struct {
			Status string `json:"status"`
		} `json:"subsonic-response"`
	}
	if resp.StatusCode != http.StatusOK || json.NewDecoder(io.LimitReader(resp.Body, 1<<16)).Decode(&body) != nil {
		return false
	}
	return body.Response.Status == "ok"
}

// lanListener tells TLS from plain http by the first byte, like splitListener, but on each connection's own
// goroutine: one silent device on the Wi-Fi never holds up the next.
type lanListener struct {
	net.Listener
	tlsConfig *tls.Config
	ready     chan net.Conn
	errs      chan error
}

func newLANListener(ln net.Listener, cfg *tls.Config) *lanListener {
	l := &lanListener{Listener: ln, tlsConfig: cfg, ready: make(chan net.Conn), errs: make(chan error, 1)}
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				l.errs <- err
				return
			}
			go func() {
				_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
				b := make([]byte, 1)
				if _, err := io.ReadFull(conn, b); err != nil {
					conn.Close()
					return
				}
				_ = conn.SetReadDeadline(time.Time{})
				var c net.Conn = &prefixConn{Conn: conn, prefix: b}
				if b[0] == 0x16 {
					c = tls.Server(c, l.tlsConfig)
				}
				l.ready <- c
			}()
		}
	}()
	return l
}

func (l *lanListener) Accept() (net.Conn, error) {
	select {
	case c := <-l.ready:
		return c, nil
	case err := <-l.errs:
		return nil, err
	}
}

// startLANGateway listens for the phones on every network at port, passing them through to Navidrome at
// navidromeBase. Runs for the life of the hub.
func startLANGateway(port, navidromeBaseURL string) error {
	target, err := url.Parse(navidromeBaseURL)
	if err != nil {
		return fmt.Errorf("navidrome address %q: %w", navidromeBaseURL, err)
	}
	cert, err := lanCert()
	if err != nil {
		return fmt.Errorf("certificate: %w", err)
	}
	ln, err := net.Listen("tcp", ":"+port)
	if err != nil {
		return err
	}
	log.Printf("lan-tls: answering phones on :%s (encrypted, and plain for phones from before), passing through to %s", port, target)
	serveLAN(ln, target, cert)
	return nil
}

// serveLAN serves the gateway on ln in the background.
func serveLAN(ln net.Listener, target *url.URL, cert tls.Certificate) *http.Server {
	srv := &http.Server{
		Handler:           lanHandler(target),
		ReadHeaderTimeout: 15 * time.Second,
		IdleTimeout:       2 * time.Minute,
	}
	cfg := &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12}
	go func() {
		if err := srv.Serve(newLANListener(ln, cfg)); err != nil && err != http.ErrServerClosed {
			log.Printf("lan-tls: stopped: %v", err)
		}
	}()
	return srv
}
