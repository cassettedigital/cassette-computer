/**
 * cassette_local_id — cross-device track-identity hash: fixture + spec.
 *
 * The hash is hand-duplicated in three places (and soon a fourth, Kotlin):
 *   - TS:    apps/cassette/src/lib/cassette-local-id.ts
 *   - Go:    apps/cassette-player/sidecar/local-id.go
 *   - Swift: apps/cassette-player-ios/.../AmperfyKit/Cassette/CassetteLocalID.swift
 *
 * This module is the SINGLE place that records (a) the normalization spec and
 * (b) the canonical agreement fixture every implementation must reproduce.
 *
 * IMPORTANT — the implementations DO NOT fully agree. An empirical cross-run
 * (2026-06-25) found two divergence classes; see `localIdDivergences` and
 * docs/CASSETTE_LOCAL_ID_NORMALIZATION.md. Until the founder picks a single
 * rule, this package intentionally ships NO reference implementation (shipping
 * one would force a choice between the camps). It ships only the AGREED
 * vectors as canonical, plus the disagreeing vectors as a documented record.
 */

import canonicalVectors from "./fixtures/local-id-vectors.json";
import divergenceVectors from "./fixtures/local-id-divergences.json";

/** A vector all three implementations reproduce identically. */
export type LocalIdVector = {
  /** Human label, unique within the fixture. */
  name: string;
  artist: string;
  title: string;
  /** Seconds; `null` is treated as 0 by every implementation. */
  duration_seconds: number | null;
  /** 32 lowercase hex chars. All three implementations agree on this value. */
  expected_local_id: string;
};

/**
 * A vector where the implementations DISAGREE. There is no single
 * `expected_local_id` — the per-implementation outputs are recorded verbatim.
 * These are latent cross-device bugs and a founder decision, not bugs to
 * silently reconcile.
 */
export type LocalIdDivergence = {
  name: string;
  artist: string;
  title: string;
  duration_seconds: number | null;
  /** Codepoint dump of `artist` (ASCII shown literally, else U+XXXX). */
  artist_codepoints: string;
  /** Codepoint dump of `title`. */
  title_codepoints: string;
  ts_result: string;
  go_result: string;
  swift_result: string;
  note: string;
};

/**
 * The locked normalization pipeline, in order. All implementations claim to
 * follow this; steps 2 and 6 are where they actually diverge (see the doc).
 */
export const LOCAL_ID_PIPELINE: readonly string[] = [
  "1. NFKD-normalize each string (decompose + compatibility).",
  "2. Strip Unicode combining marks. *** DIVERGENCE: TS strips only U+0300-U+036F; Go & Swift strip ALL category Mn. ***",
  "3. NFKC-normalize (recompose to canonical form).",
  "4. Lowercase (locale-independent).",
  "5. Trim leading/trailing whitespace.",
  "6. Collapse runs of whitespace to a single ASCII space. *** DIVERGENCE: TS uses JS /\\s/ (incl. U+FEFF, excl. U+0085); Go & Swift use the Unicode White_Space property (incl. U+0085, excl. U+FEFF). ***",
  "7. Join normalized artist, normalized title, and round(durationSeconds) with U+001F.",
  "8. SHA-256 the UTF-8 bytes.",
  "9. Take the first 16 bytes and lowercase-hex-encode -> 32 hex chars.",
] as const;

/** Canonical, cross-language-agreed vectors. Path for Go/Swift tests: this file's JSON. */
export const localIdVectors: LocalIdVector[] = canonicalVectors as LocalIdVector[];

/** Documented disagreements — NOT asserted as passing. */
export const localIdDivergences: LocalIdDivergence[] =
  divergenceVectors as LocalIdDivergence[];
