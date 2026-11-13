// Cassette local-ID — the cross-device track identity fallback.
//
// This file MUST stay byte-for-byte compatible with the TypeScript
// implementation at apps/cassette/src/lib/cassette-local-id.ts. The
// shared fixture at apps/cassette/test/fixtures/local-id-vectors.json
// is the locked source of truth — local_id_test.go reads it and asserts
// every vector matches.
//
// Pipeline (locked; mirrors the TS comments):
//   1. NFKD-normalize each string (decompose + compatibility).
//   2. Strip Unicode combining marks (category Mn).
//   3. NFKC-normalize (recompose to canonical form).
//   4. Lowercase.
//   5. Trim leading/trailing whitespace.
//   6. Collapse runs of whitespace to a single ASCII space.
//   7. Concatenate normalized artist, normalized title, and the
//      half-away-from-zero rounded integer duration, joined by U+001F
//      (unit separator) — a character no plausible artist/title contains.
//   8. SHA-256 the UTF-8 bytes.
//   9. Take the first 16 bytes (128 bits) and lowercase-hex-encode them.
//
// Output is always exactly 32 lowercase hexadecimal characters.

package main

import (
	"crypto/sha256"
	"encoding/hex"
	"math"
	"strconv"
	"strings"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

const localIDUnitSeparator = "\u001f"

// stripMarks decomposes the string with NFKD, removes combining marks,
// then recomposes with NFKC. transform.String returns the transformed
// string and never errors for the transformers we chain here.
func stripDiacritics(s string) string {
	t := transform.Chain(
		norm.NFKD,
		runes.Remove(runes.In(unicode.Mn)),
		norm.NFKC,
	)
	result, _, _ := transform.String(t, s)
	return result
}

// collapseWhitespace replaces runs of Unicode whitespace with a single
// ASCII space, after trimming leading and trailing whitespace. Mirrors
// JavaScript's .trim().replace(/\s+/g, ' ').
func collapseWhitespace(s string) string {
	fields := strings.FieldsFunc(s, unicode.IsSpace)
	return strings.Join(fields, " ")
}

func normalizeForLocalID(s string) string {
	if s == "" {
		return ""
	}
	s = stripDiacritics(s)
	s = strings.ToLower(s)
	s = collapseWhitespace(s)
	return s
}

// durationKeyFromFloat applies the same rule as Math.round in JS for
// non-negative finite inputs: half-away-from-zero rounding. NaN, ±Inf,
// and negative values collapse to "0" — matching the TS guard.
func durationKeyFromFloat(d float64) string {
	if math.IsNaN(d) || math.IsInf(d, 0) || d < 0 {
		return "0"
	}
	return strconv.FormatInt(int64(math.Round(d)), 10)
}

// CassetteLocalID computes the 32-character lowercase hex track identity
// from the (artist, title, durationSeconds) triple. Never errors; garbage
// in produces a deterministic 32-char string out.
func CassetteLocalID(artist, title string, durationSeconds float64) string {
	a := normalizeForLocalID(artist)
	t := normalizeForLocalID(title)
	d := durationKeyFromFloat(durationSeconds)

	payload := a + localIDUnitSeparator + t + localIDUnitSeparator + d
	sum := sha256.Sum256([]byte(payload))
	return hex.EncodeToString(sum[:16])
}

// CassetteLocalIDFromSeconds is a small ergonomic helper for callers
// that already have an int duration (e.g. Subsonic responses).
func CassetteLocalIDFromSeconds(artist, title string, durationSeconds int) string {
	return CassetteLocalID(artist, title, float64(durationSeconds))
}
