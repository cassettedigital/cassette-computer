/**
 * A record's songs as both pages print and play them: unknown rows dropped, false disc splits merged,
 * an edition's bonus disc left off, numbers per displayed disc, the start song, and the one length.
 * Pure. Rules T1 to T5 of the shell spec, with the review change to T2 (a disc of other versions is an
 * edition's bonus disc, not a second disc of the record).
 */

import { songKey } from "./records";
import type { LaidTrack, TrackIn, TrackLayout } from "./types";

/** T1: a blank row or a literal "[unknown]" is not a song. "[untitled]" is a real title. */
export function isUnknownTrack(title: string | null | undefined): boolean {
  const t = (title ?? "").trim();
  return !t || /^\[?\s*unknown\s*\]?$/i.test(t);
}

const LONG_RECORD_SECONDS = 80 * 60;

/**
 * T2 to T4. With more than one disc number left after T1:
 *   - a song that appears on two discs means the later discs are other versions (a collector's edition's
 *     bonus disc): only disc 1 is the record (`bonusDropped`), one list, no disc heads;
 *   - otherwise the split is real only when the record runs over 80 minutes (runtimeSeconds, else the
 *     sum of known lengths);
 *   - otherwise every song moves to disc 1, order kept (Kid A's 5 + 5).
 */
export function layoutTracks<T extends TrackIn>(
  list: T[],
  runtimeSeconds: number | null,
  opts?: { keepOrder?: boolean; namedRank?: Record<number, number> },
): TrackLayout<T> {
  const kept = list.filter((t) => !isUnknownTrack(t.title));
  const ordered = opts?.keepOrder
    ? kept
    : kept
        .map((t, i) => ({ t, i }))
        .sort((a, b) => (a.t.disc ?? 1) - (b.t.disc ?? 1) || a.t.position - b.t.position || a.i - b.i)
        .map((x) => x.t);

  const discs = [...new Set(ordered.map((t) => t.disc ?? 1))];
  let rows: Array<{ t: T; disc: number }> = ordered.map((t) => ({ t, disc: t.disc ?? 1 }));
  let multiDisc = false;
  let bonusDropped = false;
  if (discs.length > 1) {
    const discOfKey = new Map<string, number>();
    let repeats = false;
    for (const r of rows) {
      const key = songKey(r.t.title);
      if (!key) continue;
      const seen = discOfKey.get(key);
      if (seen != null && seen !== r.disc) repeats = true;
      else if (seen == null) discOfKey.set(key, r.disc);
    }
    const knownSum = rows.reduce((s, r) => s + (r.t.seconds && r.t.seconds > 0 ? r.t.seconds : 0), 0);
    const length = runtimeSeconds && runtimeSeconds > 0 ? runtimeSeconds : knownSum;
    if (repeats) {
      const first = Math.min(...discs);
      rows = rows.filter((r) => r.disc === first).map((r) => ({ t: r.t, disc: 1 }));
      bonusDropped = true;
    } else if (length > LONG_RECORD_SECONDS) {
      multiDisc = true;
    } else {
      rows = rows.map((r) => ({ t: r.t, disc: 1 }));
    }
  }

  // T3: numbered within the displayed disc, from 01
  const count = new Map<number, number>();
  const tracks: Array<LaidTrack<T>> = rows.map(({ t, disc }) => {
    const n = (count.get(disc) ?? 0) + 1;
    count.set(disc, n);
    return { ...t, disc, n: String(n).padStart(2, "0") };
  });

  // T4: the best-known song that can play, ties to running order. The artist's stored list (readNamedRank) ranks
  // first, so a record starts on the song the artist page lists highest; then the songs pass's score.
  const named = opts?.namedRank ?? {};
  const rankOf = (t: T) => named[t.id] ?? Number.MAX_SAFE_INTEGER;
  let startIndex: number | null = null;
  tracks.forEach((t, i) => {
    if (!t.videoId) return;
    if (startIndex == null) { startIndex = i; return; }
    const held = tracks[startIndex];
    if (rankOf(t) < rankOf(held) || (rankOf(t) === rankOf(held) && (t.recognition ?? -1) > (held.recognition ?? -1))) startIndex = i;
  });

  const allKnown = tracks.length > 0 && tracks.every((t) => t.seconds != null && t.seconds > 0);
  const summedSeconds = allKnown ? tracks.reduce((s, t) => s + (t.seconds ?? 0), 0) : null;

  return { tracks, multiDisc, startIndex, summedSeconds, bonusDropped };
}

/** A stored runtime under this many seconds a song can't be the whole record (BUG-752). */
const SHORTEST_PLAUSIBLE_SONG_SECONDS = 45;

/**
 * T5: the record's length in minutes, the one number both pages print, and only when every song has a
 * length (BUG-832). The stored runtime is the sum of the songs that have one, so with any song missing a
 * length it is the length of part of the record: a record of 12 songs, 8 of them with no length, said
 * "14 min". Given every song's length: the stored runtime when there is one (unless a bonus disc was left
 * off, when it counts the wrong songs, or it is too short to hold the record's songs, BUG-752), else the
 * sum of the songs. A caller that does not pass the songs (no `tracks`) keeps the stored runtime as before.
 */
export function recordMinutes(
  runtimeSeconds: number | null,
  layout: Pick<TrackLayout, "summedSeconds" | "bonusDropped"> & { tracks?: readonly unknown[] },
): number | null {
  const songs = layout.tracks?.length ?? 0;
  // some song has no length (summedSeconds is only set when every one has): say nothing rather than part of it
  if (songs > 0 && layout.summedSeconds == null) return null;
  const plausible = runtimeSeconds != null && runtimeSeconds >= songs * SHORTEST_PLAUSIBLE_SONG_SECONDS;
  if (!layout.bonusDropped && runtimeSeconds && runtimeSeconds > 0 && plausible) return Math.round(runtimeSeconds / 60);
  if (layout.summedSeconds && layout.summedSeconds > 0) return Math.round(layout.summedSeconds / 60);
  return null;
}
