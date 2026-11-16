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

/**
 * KEXP's song art is Cover Art Archive's, but handed out as the archive.org storage copy of a thumbnail
 * (".../items/mbid-<release>/mbid-<release>-<image>_thumb250.jpg" on ia8…/dn7… hosts), an address our picture
 * server does not take and a browser may not be sent to (lib/images/picture.ts), so it drew as nothing on the
 * station page and in the Mac app's log. The same picture at Cover Art Archive's own address goes through.
 */
export function caaCover(url: string): string | null {
  const m = url.match(/archive\.org\/.*\/items\/mbid-([0-9a-f-]{36})\/mbid-\1-(\d+)(?:_thumb(?:250|500|1200)?)?\.(?:jpe?g|png|gif)$/i);
  return m ? `https://coverartarchive.org/release/${m[1]}/${m[2]}-500.jpg` : null;
}
