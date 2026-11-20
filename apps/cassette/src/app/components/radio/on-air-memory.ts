/**
 * What each station was last seen playing on this visit: the dial's On now cards and a station page's reads
 * write it, and the next screen that shows the station starts from it instead of from nothing. Open a
 * station from the dial and its page leads with the song the card just showed, with the same cover; come
 * back to the dial and its cards are already there (the founder, 2026-11-17: "Now playing showed, bring that
 * image forward"). A minute or two old at most; whatever the page then reads replaces it.
 *
 * Client only, written after a read lands, never while rendering on the server: the server's copy of this
 * module stays empty, so a page drawn there and the same page hydrated here agree.
 */

import type { RadioNowPlaying } from "@/lib/radio/types";

/** The frame the dial's On now card draws a station's cover at. A station page leading with the same song draws
 *  this size of its cover underneath at once (AlbumCover's `under`): the copy the browser already has. */
export const ON_NOW_FRAME = "112px";

/** Older than this, a song may well have ended: better to wait for the read than lead with the wrong one. */
const KEPT_MS = 3 * 60_000;

const seen = new Map<string, { np: RadioNowPlaying; at: number }>();

export function rememberOnAir(slug: string, np: RadioNowPlaying | null | undefined): void {
  if (np && (np.track || np.show)) seen.set(slug, { np, at: Date.now() });
}

export function recallOnAir(slug: string): RadioNowPlaying | null {
  const kept = seen.get(slug);
  return kept && Date.now() - kept.at < KEPT_MS ? kept.np : null;
}
