package main

import (
	"os"
	"testing"
)

// Real cd-paranoia -Q capture from physical drive (2026-06-20). Reproduces the
// user's reported failing disc ID ZX.9zNjYGUmYffOaA6vFyu5FvNM-.
const realDiscID = "ZX.9zNjYGUmYffOaA6vFyu5FvNM-"

func TestRealDiscParanoiaCapture(t *testing.T) {
	raw, err := os.ReadFile("testdata/cdparanoia_real.txt")
	if err != nil {
		t.Skip("testdata/cdparanoia_real.txt not present")
	}
	toc, rawBegins, err := parseParanoiaTOC(string(raw))
	if err != nil {
		t.Fatal(err)
	}
	id, err := toc.DiscID()
	if err != nil {
		t.Fatal(err)
	}
	if id != realDiscID {
		t.Fatalf("disc ID = %q, want %q", id, realDiscID)
	}
	t.Logf("raw begins: %v", rawBegins)
	t.Logf("leadout=%d offsets=%v", toc.LeadoutOffset, toc.TrackOffsets)
	t.Logf("MB TOC URL: %s", mbTOCLookupURL(toc))
}
