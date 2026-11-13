package main

import (
	"os"
	"strings"
	"testing"
)

// TestRedactLogTail (BUG-781): a crash report's log keeps what helps debugging
// and loses the home folder and every secret.
func TestRedactLogTail(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("no home folder")
	}
	in := strings.Join([]string{
		"scan " + home + "/Music/Cassette/Bon Iver/SABLE/01.flac",
		"GET /rest/getSong?u=cassette&t=5f4dcc3b5aa765d61d8327deb882cf99&s=abc123&id=42",
		"Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig",
		`{"token":"tok_live_abcdefgh12345678","local_key":"0123456789abcdef"}`,
	}, "\n")
	out := string(redactLogTail([]byte(in)))

	for _, secret := range []string{home, "5f4dcc3b5aa765d61d8327deb882cf99", "abc123", "eyJhbGciOiJIUzI1NiJ9", "tok_live_abcdefgh12345678", "0123456789abcdef", "u=cassette"} {
		if strings.Contains(out, secret) {
			t.Errorf("redacted log still holds %q:\n%s", secret, out)
		}
	}
	for _, kept := range []string{"~/Music/Cassette/Bon Iver/SABLE/01.flac", "id=42", "getSong"} {
		if !strings.Contains(out, kept) {
			t.Errorf("redaction removed %q, which helps debugging:\n%s", kept, out)
		}
	}
}

// TestNavidromeExternalServicesForcedOff (BUG-781): whatever the launcher's
// environment says, Navidrome starts with its outside services off.
func TestNavidromeExternalServicesForcedOff(t *testing.T) {
	env := withoutExternalServices([]string{"ND_PORT=4533", "ND_ENABLEEXTERNALSERVICES=true", "nd_enableinsightscollector=true"})
	got := strings.Join(env, " ")
	if strings.Contains(got, "=true") {
		t.Errorf("a turned-on outside service survived: %v", env)
	}
	for _, want := range []string{"ND_PORT=4533", "ND_ENABLEEXTERNALSERVICES=false", "ND_ENABLEINSIGHTSCOLLECTOR=false"} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %s in %v", want, env)
		}
	}
}
