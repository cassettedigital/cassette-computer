"use client";

/**
 * Every song on the Mac, for the pages that list songs across records (search, an artist's page) and
 * for starting a record offline: fetched once per window from /api/player/desk/songs (the paired app
 * sends it to the cloud with its token) the first time something asks, kept in the browser, shared.
 */

import { useEffect, useState } from "react";
import { swrRead } from "@/lib/read-cache";
import type { OwnedTrack } from "./types";

let songsOnce: Promise<OwnedTrack[]> | null = null;
/** The last list this window has, by record: what the side view reads a record's songs from at once. */
let byRecord: Map<string, OwnedTrack[]> | null = null;
/** ...and by the id the Mac plays each by, so a song the Mac is playing is known by name here */
let bySong: Map<string, OwnedTrack> | null = null;
/** The last whole list this window has: what a page coming back starts from, so it draws at once. */
let latest: OwnedTrack[] | null = null;
function index(list: OwnedTrack[]) {
  latest = list;
  const m = new Map<string, OwnedTrack[]>();
  const s = new Map<string, OwnedTrack>();
  for (const t of list) {
    if (t.albumKey) (m.get(t.albumKey) ?? m.set(t.albumKey, []).get(t.albumKey)!).push(t);
    if (t.subsonicTrackId) s.set(t.subsonicTrackId, t);
  }
  for (const [k, v] of m) m.set(k, inRecordOrder(v, [k]));
  byRecord = m;
  bySong = s;
}

/** A record's songs from the list this window already holds, in record order; null until it has one. */
export function songsOfRecordNow(key: string): OwnedTrack[] | null {
  return byRecord?.get(key) ?? null;
}

/** One song from that list by the id the Mac plays it by; null until the list is here. */
export function songOfNow(subsonicTrackId: string): OwnedTrack | null {
  return bySong?.get(subsonicTrackId) ?? null;
}

/**
 * Every song on the Mac, read through the browser's kept copy (lib/read-cache): the copy at once when
 * there is one, then the cloud's answer refreshes it. With no internet the copy is the list (BUG-542),
 * so search, artist pages and records never opened here still work.
 */
export function loadSongs(opts?: { fresh?: boolean }): Promise<OwnedTrack[]> {
  // `fresh`: read again even when this window already has a list, so the kept copy follows the Mac
  if (opts?.fresh) songsOnce = null;
  songsOnce ??= new Promise<OwnedTrack[]>((resolve, reject) => {
    let done = false;
    void swrRead<OwnedTrack[]>(
      "desk-songs",
      async () => {
        const r = await fetch("/api/player/desk/songs", { credentials: "include" });
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as OwnedTrack[];
      },
      (v) => {
        index(v);
        if (done) return;
        done = true;
        resolve(v);
      },
    ).then(({ ok }) => {
      if (!ok && !done) reject(new Error("songs unavailable"));
    });
  }).catch((e) => {
    songsOnce = null;
    throw e;
  });
  return songsOnce;
}

/**
 * The window reads the library again: the window's own data (the shelf, home, the rail, all read once
 * by the desk's layout and kept while you move between pages) and the Mac's song list. For a record
 * that arrived without an edit in this window (a rip finishing, coming back to the window, BUG-760).
 */
export function rereadLibrary(router: { refresh(): void }) {
  router.refresh();
  void loadSongs({ fresh: true }).catch(() => {});
}

export function useSongs(want: boolean) {
  // start from the list this window already holds: Home started from nothing on every visit and drew
  // an empty page (every cover blank) until the same list came back (2026-11-08)
  const [list, setList] = useState<OwnedTrack[] | null>(() => (want ? latest : null));
  useEffect(() => {
    if (!want || list) return;
    let gone = false;
    loadSongs()
      .then((l) => !gone && setList(l))
      .catch(() => !gone && setList([]));
    return () => {
      gone = true;
    };
  }, [want, list]);
  return list;
}

/** Songs in record order: by record (as given), then track number, then title. */
export function inRecordOrder(songs: OwnedTrack[], recordKeys: string[]): OwnedTrack[] {
  const rank = new Map(recordKeys.map((k, i) => [k, i]));
  return [...songs].sort(
    (a, b) =>
      (rank.get(a.albumKey ?? "") ?? 1e9) - (rank.get(b.albumKey ?? "") ?? 1e9) ||
      (a.trackNo ?? 1e9) - (b.trackNo ?? 1e9) ||
      a.title.localeCompare(b.title),
  );
}
