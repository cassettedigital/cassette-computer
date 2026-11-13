/**
 * Keep playing's one contract (founder, 2026-11-02: every surface uses the exact same algorithm).
 *
 * The cloud owns every decision: album or songs, which record or which songs, and the words under
 * THEN (lib/taste/keep-playing.ts behind POST /api/sync/keep-playing). A surface only:
 *
 *   1. keeps a switch (on by default) that steps aside while repeat is on,
 *   2. sends its queue as cassette_local_ids, as soon as it knows what it will play,
 *   3. shows the answer under THEN in the words it came with, and plays it when the queue runs out.
 *
 * So a change to how keep playing picks ships with the web and reaches the iPhone, the Mac app and
 * any surface after them at once. Surfaces today: the iPhone (AmperfyKit/Player/KeepPlaying.swift)
 * and the Mac app and web player (app/desk/keep-playing.tsx). Client-safe: types and pure helpers
 * only.
 */

/** What a surface sends. Every id is a cassette_local_id. */
export type KeepPlayingRequest = {
  /**
   * What started the queue: the list played from an album, a playlist or a search, or the last pick
   * keep playing added. The cloud reads album or songs from it.
   */
  started: string[];
  /** The queue as it will have played when it runs out, oldest first: its last song comes last. */
  seed: string[];
  /** Everything in the queue, played or to come: none of it comes back. */
  exclude: string[];
  /** The listener's IANA zone: the day seeds the draw. */
  tz: string;
};

export type KeepPlayingHeading = { shout: "Then"; answer: string };

/** A record to play whole: its songs in the library (any order: play the record as you hold it). */
export type KeepPlayingRecordAnswer = {
  songs: string[];
  /** The record's library key when it is matched to the catalog (`catalog-album:<id>`), else null. */
  groupKey: string | null;
  artist: string;
};

/** What comes back. `records` are ranked: Swap walks down them. */
export type KeepPlayingAnswer =
  | { version: number; kind: "album"; heading: KeepPlayingHeading; records: KeepPlayingRecordAnswer[]; answer?: "like" | "more-by" }
  | { version: number; kind: "songs"; heading: KeepPlayingHeading; songs: string[] }
  | { version: number; kind: "none" };

export const KEEP_PLAYING_PATH = "/api/sync/keep-playing";

/** The library key a cloud record id stands for (`c123` is `catalog-album:123`), else null. */
export function groupKeyOf(albumId: string): string | null {
  return /^c\d+$/.test(albumId) ? `catalog-album:${albumId.slice(1)}` : null;
}

/** Ids the cloud should read, newest last, de-duplicated with the last sighting kept. */
export function lastUnique(ids: readonly (string | null | undefined)[], max = Infinity): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = ids.length - 1; i >= 0 && out.length < max; i--) {
    const id = ids[i];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.reverse();
}
