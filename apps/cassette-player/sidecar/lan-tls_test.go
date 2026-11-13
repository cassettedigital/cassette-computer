package main

import (
	"bytes"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

// BUG-870: the computer's certificate is made once and kept; its key is the owner's alone.
func TestLANCertIsMadeOnceAndKept(t *testing.T) {
	prev := sidecarDataDir
	sidecarDataDir = t.TempDir()
	t.Cleanup(func() { sidecarDataDir = prev })

	first, err := lanCert()
	if err != nil {
		t.Fatal(err)
	}
	pin := lanTLSPin
	second, err := lanCert()
	if err != nil {
		t.Fatal(err)
	}
	if lanTLSPin != pin || !bytes.Equal(first.Certificate[0], second.Certificate[0]) {
		t.Fatal("a second start made a new certificate; the phones' pin would break")
	}
	info, err := os.Stat(filepath.Join(lanTLSDir(), "key.pem"))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("key.pem mode = %v (%v), want 0600", info.Mode().Perm(), err)
	}
	if first.Leaf.NotAfter.Year() != 9999 {
		t.Fatalf("NotAfter = %v, want no end", first.Leaf.NotAfter)
	}
}

// BUG-870: the phones get the Subsonic API, in TLS or (phones from before) plain, and nothing else; whatever a
// client claims about its address never reaches Navidrome.
func TestLANGatewayPassesOnlyTheSubsonicAPI(t *testing.T) {
	prev := sidecarDataDir
	sidecarDataDir = t.TempDir()
	t.Cleanup(func() { sidecarDataDir = prev })

	var sawForwarded string
	navidrome := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawForwarded = r.Header.Get("X-Forwarded-For")
		io.WriteString(w, "navidrome:"+r.URL.Path)
	}))
	t.Cleanup(navidrome.Close)
	target, _ := url.Parse(navidrome.URL)
	cert, err := lanCert()
	if err != nil {
		t.Fatal(err)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := serveLAN(ln, target, cert)
	t.Cleanup(func() { srv.Close() })
	addr := ln.Addr().String()

	// A phone that pins this computer's key, as the cloud told it.
	pinned := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{
		InsecureSkipVerify: true, // the pin below is the check, not a name
		VerifyPeerCertificate: func(raw [][]byte, _ [][]*x509.Certificate) error {
			leaf, err := x509.ParseCertificate(raw[0])
			if err != nil {
				return err
			}
			sum := sha256.Sum256(leaf.RawSubjectPublicKeyInfo)
			if base64.StdEncoding.EncodeToString(sum[:]) != lanTLSPin {
				return errors.New("not this computer")
			}
			return nil
		},
	}}}
	get := func(c *http.Client, u string, forwarded string) (int, string) {
		req, _ := http.NewRequest(http.MethodGet, u, nil)
		if forwarded != "" {
			req.Header.Set("X-Forwarded-For", forwarded)
		}
		resp, err := c.Do(req)
		if err != nil {
			t.Fatalf("GET %s: %v", u, err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(b)
	}

	if code, body := get(pinned, "https://"+addr+"/rest/ping.view", "127.0.0.1"); code != 200 || body != "navidrome:/rest/ping.view" {
		t.Fatalf("encrypted /rest = %d %q", code, body)
	}
	if code, body := get(http.DefaultClient, "http://"+addr+"/rest/stream.view", "10.9.9.9"); code != 200 || body != "navidrome:/rest/stream.view" {
		t.Fatalf("plain /rest (a phone from before) = %d %q", code, body)
	}
	if sawForwarded == "10.9.9.9" || bytes.Contains([]byte(sawForwarded), []byte("10.9.9.9")) {
		t.Fatalf("a client's claimed address reached Navidrome: %q", sawForwarded)
	}
	// The iPhone app's reachability check: the root answers 200, empty, from the gateway itself.
	if code, body := get(http.DefaultClient, "http://"+addr+"/", ""); code != http.StatusOK || body != "" {
		t.Fatalf("GET / on the Wi-Fi = %d %q, want 200 and nothing (today's phones refuse to sign in otherwise)", code, body)
	}
	for _, p := range []string{"/app/", "/auth/createAdmin", "/api/user"} {
		if code, _ := get(http.DefaultClient, "http://"+addr+p, ""); code != http.StatusNotFound {
			t.Fatalf("GET %s on the Wi-Fi = %d, want 404 (Navidrome's own pages stay on this computer)", p, code)
		}
	}
}

func TestWithEnvReplacesTheLaunchersValue(t *testing.T) {
	got := withEnv([]string{"ND_ADDRESS=0.0.0.0", "ND_PORT=4534"}, "ND_ADDRESS", "127.0.0.1")
	if len(got) != 2 || got[0] != "ND_PORT=4534" || got[1] != "ND_ADDRESS=127.0.0.1" {
		t.Fatalf("withEnv = %v", got)
	}
}

// BUG-078: a phone's "read your music folder again" reaches the hub over the Wi-Fi, but only encrypted, as a POST,
// and with a sign-in this computer's music server accepts; nothing else about the request reaches Navidrome.
func TestLANGatewayLetsASignedInPhoneAskForARescan(t *testing.T) {
	prev := sidecarDataDir
	sidecarDataDir = t.TempDir()
	t.Cleanup(func() { sidecarDataDir = prev })

	var pinged url.Values
	navidrome := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/rest/ping.view" {
			t.Errorf("the rescan door asked Navidrome for %s", r.URL.Path)
		}
		pinged = r.URL.Query()
		status := "failed"
		if q := r.URL.Query(); q.Get("u") == "phone" && q.Get("t") == "goodtoken" && q.Get("s") == "salt" {
			status = "ok"
		}
		io.WriteString(w, `{"subsonic-response":{"status":"`+status+`","version":"1.16.1"}}`)
	}))
	t.Cleanup(navidrome.Close)
	target, _ := url.Parse(navidrome.URL)

	rescans := 0
	prevConverge := lanConverge
	lanConverge = func(w http.ResponseWriter, r *http.Request) {
		rescans++
		io.WriteString(w, `{"ok":true,"converged":true}`)
	}
	t.Cleanup(func() { lanConverge = prevConverge })

	cert, err := lanCert()
	if err != nil {
		t.Fatal(err)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	srv := serveLAN(ln, target, cert)
	t.Cleanup(func() { srv.Close() })
	addr := ln.Addr().String()
	encrypted := &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}

	ask := func(c *http.Client, method, scheme, query string) (int, string) {
		req, _ := http.NewRequest(method, scheme+"://"+addr+"/api/library/converge?"+query, nil)
		resp, err := c.Do(req)
		if err != nil {
			t.Fatalf("%s %s: %v", method, query, err)
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(b)
	}

	if code, body := ask(encrypted, http.MethodPost, "https", "u=phone&t=goodtoken&s=salt&v=1.16.1&c=Cassette&extra=1"); code != 200 || body != `{"ok":true,"converged":true}` || rescans != 1 {
		t.Fatalf("signed-in encrypted POST = %d %q, rescans %d; want 200 and one rescan", code, body, rescans)
	}
	for _, k := range []string{"extra"} {
		if pinged.Has(k) {
			t.Errorf("%q reached Navidrome's ping; only the sign-in should", k)
		}
	}
	if pinged.Get("f") != "json" {
		t.Errorf("the ping asked for %q, want json", pinged.Get("f"))
	}
	for _, c := range []struct {
		name, method, scheme, query string
		want                        int
	}{
		{"a wrong sign-in", http.MethodPost, "https", "u=phone&t=badtoken&s=salt", http.StatusUnauthorized},
		{"no sign-in", http.MethodPost, "https", "", http.StatusUnauthorized},
		{"a user and no proof", http.MethodPost, "https", "u=phone", http.StatusUnauthorized},
		{"a GET", http.MethodGet, "https", "u=phone&t=goodtoken&s=salt", http.StatusMethodNotAllowed},
		{"plain http", http.MethodPost, "http", "u=phone&t=goodtoken&s=salt", http.StatusForbidden},
	} {
		client := encrypted
		if c.scheme == "http" {
			client = http.DefaultClient
		}
		if code, body := ask(client, c.method, c.scheme, c.query); code != c.want {
			t.Errorf("%s: %d %q, want %d", c.name, code, body, c.want)
		}
	}
	if rescans != 1 {
		t.Fatalf("refused asks still ran the rescan: %d rescans, want 1", rescans)
	}
	// The rest of the hub stays off the Wi-Fi.
	for _, p := range []string{"/api/library/ingest", "/api/rip/start", "/api/library/trash", "/status.json"} {
		req, _ := http.NewRequest(http.MethodPost, "https://"+addr+p, nil)
		resp, err := encrypted.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("POST %s on the Wi-Fi = %d, want 404", p, resp.StatusCode)
		}
	}
}
