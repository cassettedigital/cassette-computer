// Cross-language fixture test for CassetteLocalID.
//
// Reads the locked fixture at
// apps/cassette/test/fixtures/local-id-vectors.json (the same one the TS
// implementation tests against) and asserts every vector matches.
//
// Run from this directory with:  go test -run LocalID
package main

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"
)

type localIDVector struct {
	Name             string   `json:"name"`
	Artist           string   `json:"artist"`
	Title            string   `json:"title"`
	DurationSeconds  *float64 `json:"duration_seconds"`
	ExpectedLocalID  string   `json:"expected_local_id"`
}

func loadLocalIDVectors(t *testing.T) []localIDVector {
	t.Helper()
	fixturePath := filepath.Join(
		"..", "..",
		"cassette", "test", "fixtures", "local-id-vectors.json",
	)
	data, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read fixture %s: %v", fixturePath, err)
	}
	var vectors []localIDVector
	if err := json.Unmarshal(data, &vectors); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	if len(vectors) == 0 {
		t.Fatal("fixture has no vectors")
	}
	return vectors
}

func TestLocalIDFixtureVectors(t *testing.T) {
	for _, v := range loadLocalIDVectors(t) {
		v := v
		t.Run(v.Name, func(t *testing.T) {
			d := math.NaN()
			if v.DurationSeconds != nil {
				d = *v.DurationSeconds
			}
			got := CassetteLocalID(v.Artist, v.Title, d)
			if got != v.ExpectedLocalID {
				t.Errorf("CassetteLocalID(%q, %q, %v) = %s; want %s",
					v.Artist, v.Title, v.DurationSeconds, got, v.ExpectedLocalID)
			}
		})
	}
}

func TestLocalIDFromSecondsMatches(t *testing.T) {
	a := CassetteLocalID("Bon Iver", "Day One", 184.0)
	b := CassetteLocalIDFromSeconds("Bon Iver", "Day One", 184)
	if a != b {
		t.Errorf("float and int helpers disagree: %s vs %s", a, b)
	}
}

func TestLocalIDOutputShape(t *testing.T) {
	id := CassetteLocalID("X", "Y", 1)
	if len(id) != 32 {
		t.Errorf("expected 32-char output, got %d (%q)", len(id), id)
	}
	for _, r := range id {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f')) {
			t.Errorf("non-hex char %q in output %q", r, id)
		}
	}
}
