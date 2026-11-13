/**
 * What the dock plays, and how a list becomes "this song, then the rest". Pure.
 */

/** One song the dock can play. Built by the pages from their own data. */
export type Playable = {
  trackId: number;
  title: string;
  artist: string;
  artistSlug: string;
  album: string | null;
  albumSlug: string | null; // the dock links it with albumHref when present
  cover: string | null; // https small cover; the frame's backdrop while YouTube loads
  videoId: string;
  fallbackVideoIds: string[]; // tried in order when YouTube refuses one
  seconds: number | null; // stored length; the progress line's fallback duration
  /** Begin here, in whole seconds: only a shared song carries one (the sender's chosen moment). */
  startSeconds?: number | null;
};

/** The song at `index`, and everything after it: "this one, then onward" (a row, a preview tile). */
export function fromIndex(list: Playable[], index: number): { track: Playable; queue: Playable[] } | null {
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return null;
  return { track: list[index], queue: list.slice(index + 1) };
}

/**
 * The song at `index`, then the rest of the record in running order, wrapping round to the first
 * song (Hear it): starting on the last track still plays the whole record.
 */
export function wrapFrom(list: Playable[], index: number): { track: Playable; queue: Playable[] } | null {
  if (!Number.isInteger(index) || index < 0 || index >= list.length) return null;
  return { track: list[index], queue: [...list.slice(index + 1), ...list.slice(0, index)] };
}

/** A laid-out track as a Playable, or null when it has no preview. */
export function toPlayable(
  t: { id: number; title: string; videoId: string | null; fallbackVideoIds: string[]; seconds: number | null },
  ctx: { artist: string; artistSlug: string; album: string | null; albumSlug: string | null; cover: string | null },
): Playable | null {
  if (!t.videoId) return null;
  return {
    trackId: t.id,
    title: t.title,
    artist: ctx.artist,
    artistSlug: ctx.artistSlug,
    album: ctx.album,
    albumSlug: ctx.albumSlug,
    cover: ctx.cover,
    videoId: t.videoId,
    fallbackVideoIds: t.fallbackVideoIds,
    seconds: t.seconds,
  };
}

/** Narrowing filter for `list.map(toPlayable).filter(isPlayable)`. */
export const isPlayable = (x: Playable | null | undefined): x is Playable => x != null;
