/**
 * The one picture a "what's on" wears, in one order everywhere (the web dock,
 * the station page, the On air cards; the phone's RadioLiveFeed mirrors it):
 *
 *   1. the record we carry, when the song matched our catalog (our own cover,
 *      and the record a listener can go and buy),
 *   2. else the station's own cover for the song,
 *   3. else the show's picture (the DJ, while they talk).
 *
 * Empty strings count as none: some feeds send "" for "no picture".
 */

import type { RadioNowPlaying } from "./types";

export function liveArt(now: Pick<RadioNowPlaying, "match" | "track" | "show"> | null | undefined): string | null {
  return now?.match?.coverUrl || now?.track?.coverUrl || now?.show?.image || null;
}
