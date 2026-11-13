"use client";

/**
 * The catalog type-ahead's data: what someone is spelling, matched by name against artists, albums and songs
 * through GET /api/search (Typesense, the fast name-only path; it falls back to Postgres if the engine is
 * down, and only returns albums the site shows). Each letter asks at once and no answer is thrown away:
 * while someone is still typing, the answer to an earlier spelling shows (and its pictures start loading)
 * until a later one lands, so the results move with the typing instead of waiting for a pause. An answer
 * older than the one showing is dropped. Answers are kept for a few minutes, so a backspace or a retyped
 * spelling shows at once without asking again. (It used to wait 220 ms after the last letter and cancel
 * every earlier question, so nothing showed until typing stopped.) When the latest spelling's ask fails
 * (the route says `unavailable`, answers an error, or there is no network) the results go and `failed` is
 * true, so a field can say search is having trouble instead of showing the last word's rows or "no names
 * match" (BUG-678, BUG-73).
 * Shared by every search field that drops results under itself: the taste masthead (src/app/_taste) and the
 * old site nav (src/app/sections/SearchControl). The deep, AI-interpreted results stay on the /search page.
 */

import { useEffect, useRef, useState } from "react";

export const TYPEAHEAD_MIN = 2;

export interface ArtistHit {
  id: string | number;
  name: string;
  slug: string;
  genre?: string | null;
  country?: string | null;
  imageUrl?: string | null;
  /** With no photo, their best-known cover. */
  cover?: string | null;
  hasImage?: boolean;
}
export interface AlbumHit {
  id: string | number;
  title: string;
  slug: string;
  artistName?: string | null;
  artistSlug?: string | null;
  coverArtUrl?: string | null;
  releaseDate?: string | null;
  releaseType?: string | null;
}
export interface SongHit {
  id: string | number;
  title: string;
  artistName?: string | null;
  albumTitle?: string | null;
  albumSlug: string;
  coverArtUrl?: string | null;
  duration?: number | null;
  /** Only on the named artist's own songs, with their preview; other songs look theirs up when played. */
  artistSlug?: string | null;
  videoId?: string | null;
  fallbackVideoIds?: string[];
}

export type TypeaheadGroup = "artists" | "albums" | "songs";

export interface Typeahead {
  artists: ArtistHit[];
  albums: AlbumHit[];
  songs: SongHit[];
  /** The one result the search most likely means (always first in its group), or null. */
  top: { kind: "artist" | "album" | "song"; id: string } | null;
  /** True when the top result is what was typed: only then should Enter open it. */
  confident: boolean;
  /** The order the groups show in, led by the top result's group. */
  order: TypeaheadGroup[];
  /** Obscure artists sharing the leading artist's name, folded away. */
  hiddenNamesakes: number;
  /** The search these results answer: while it differs from what is typed, the results are stale. */
  forQuery: string;
  loading: boolean;
  /** True once there is a query long enough to search. */
  active: boolean;
  /** The ask for what is typed now failed (not "nothing matched"): say search is having trouble. */
  failed: boolean;
}

const DEFAULT_ORDER: TypeaheadGroup[] = ["artists", "albums", "songs"];

/** One answer from the route, cut to the field's group size. */
export type Answer = Pick<Typeahead, "artists" | "albums" | "songs" | "top" | "confident" | "order" | "hiddenNamesakes">;

function readAnswer(data: Record<string, unknown>, perGroup: number): Answer {
  const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]).slice(0, perGroup) : []);
  return {
    artists: list<ArtistHit>(data.artists),
    albums: list<AlbumHit>(data.albums),
    songs: list<SongHit>(data.songs),
    top: (data.top as Typeahead["top"]) ?? null,
    confident: data.confident === true,
    order: Array.isArray(data.order) && data.order.length === 3 ? (data.order as TypeaheadGroup[]) : DEFAULT_ORDER,
    hiddenNamesakes: Number(data.hiddenNamesakes) || 0,
  };
}

/** What a finished ask means: an answer to show, or a failure to say so about. */
export type Outcome = { kind: "answer"; answer: Answer } | { kind: "failed" };

/**
 * An error status, a body that is not an answer, or the route's own `unavailable` (the engine and the
 * database both failed) is a failure. An empty answer is not: "nothing matches" is an answer.
 */
export function readOutcome(ok: boolean, data: unknown, perGroup: number): Outcome {
  if (!ok || !data || typeof data !== "object" || Array.isArray(data)) return { kind: "failed" };
  const body = data as Record<string, unknown>;
  if (body.unavailable === true) return { kind: "failed" };
  return { kind: "answer", answer: readAnswer(body, perGroup) };
}

/** Answers this page has had, by spelling, for every field on it (the route's CDN keeps them a minute too). */
const KEEP_MS = 5 * 60_000;
const KEEP_MAX = 200;
const kept = new Map<string, { at: number; answer: Answer }>();

function keptAnswer(key: string): Answer | null {
  const got = kept.get(key);
  if (!got) return null;
  if (Date.now() - got.at > KEEP_MS) {
    kept.delete(key);
    return null;
  }
  return got.answer;
}

function keepAnswer(key: string, answer: Answer) {
  kept.delete(key);
  kept.set(key, { at: Date.now(), answer });
  if (kept.size > KEEP_MAX) kept.delete(kept.keys().next().value as string);
}

const NONE: never[] = [];

export function useTypeahead(query: string, perGroup: number): Typeahead {
  const q = query.trim();
  const active = q.length >= TYPEAHEAD_MIN;
  const [shown, setShown] = useState<{ q: string; answer: Answer } | null>(null);
  const [loading, setLoading] = useState(false);
  // the spelling whose ask failed, until another is asked
  const [failedFor, setFailedFor] = useState<string | null>(null);
  // each spelling's place in line: the newest asked, and the newest whose answer is showing
  const asked = useRef(0);
  const showing = useRef(0);
  const flying = useRef(new Set<AbortController>());

  useEffect(() => {
    const inFlight = flying.current;
    if (!active) {
      inFlight.forEach((c) => c.abort());
      inFlight.clear();
      showing.current = ++asked.current;
      setShown(null);
      setFailedFor(null);
      setLoading(false);
      return;
    }
    const n = ++asked.current;
    const key = `${perGroup}|${q}`;
    const known = keptAnswer(key);
    if (known) {
      showing.current = n;
      setShown({ q, answer: known });
      setFailedFor(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailedFor(null);
    // A failed ask counts only while it is still the latest spelling: a later one will have its own answer.
    // The rows of an earlier word are cleared, so a failure never looks like that word's matches.
    const failed = () => {
      if (n !== asked.current) return;
      showing.current = n;
      setShown(null);
      setFailedFor(q);
    };
    const controller = new AbortController();
    inFlight.add(controller);
    fetch(`/api/search?q=${encodeURIComponent(q)}&type=all&perPage=${perGroup}`, { signal: controller.signal })
      .then(async (res) => readOutcome(res.ok, await res.json().catch(() => null), perGroup))
      .then((outcome) => {
        if (outcome.kind === "failed") return failed();
        keepAnswer(key, outcome.answer);
        if (n < showing.current) return; // a later spelling's answer is already showing
        showing.current = n;
        setShown({ q, answer: outcome.answer });
      })
      .catch(() => {
        // the field closed (the ask was cancelled): nothing to say. No network: that is a failure too.
        if (!controller.signal.aborted) failed();
      })
      .finally(() => {
        inFlight.delete(controller);
        if (n === asked.current && !controller.signal.aborted) setLoading(false);
      });
  }, [q, active, perGroup]);

  useEffect(() => {
    const inFlight = flying.current;
    return () => inFlight.forEach((c) => c.abort());
  }, []);

  const a = shown?.answer;
  return {
    artists: a?.artists ?? NONE,
    albums: a?.albums ?? NONE,
    songs: a?.songs ?? NONE,
    top: a?.top ?? null,
    confident: a?.confident ?? false,
    order: a?.order ?? DEFAULT_ORDER,
    hiddenNamesakes: a?.hiddenNamesakes ?? 0,
    forQuery: shown?.q ?? "",
    loading,
    active,
    failed: active && !loading && failedFor === q,
  };
}
