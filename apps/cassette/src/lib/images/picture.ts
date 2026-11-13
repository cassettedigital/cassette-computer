/**
 * A stored picture, ready for the kit's <Picture> (contract: docs/reference/CASSETTE_IMAGES.md).
 *
 * Pages are handed the address the database stores; this turns it into the two things <Picture> draws
 * from: the ladder reference (`imageRef`, the one function that makes one) and the original, which is
 * shown when the ladder cannot serve the picture at all (a drawn cover, a preview, another host) or
 * cannot answer right now. Spread it: `<Picture {...picture(album.cover, "cover")} frame={48} alt="" />`.
 *
 * The covers we draw ourselves (playlists, mixtapes, mixes, on /api/covers) are drawn at the ladder's
 * sizes too, by the site rather than the edge: their reference is the drawn address with `{rung}` for its
 * size.
 *
 * `ladderSrc` is the one size, for the few places that take an address rather than an <img>: a CSS
 * backdrop, a canvas that reads a cover's colour.
 *
 * No database imports: pages, client components and tests all use it.
 */

import { IMAGE_EXTERNAL_HOSTS, imageUrl, type ImageKind, type ImageRef, type ImageRung } from "@discovery/cassette-kit/images";
import { mediaUrl } from "../image-url";
import { imageRef } from "./image-ref";

export type StoredPicture = { image: ImageRef | null; original: string | null };

// A drawn cover's address at one size: /api/covers/<kind>/<id>?...&s=<size>, on this site or absolute.
// This computer's own address, which mediaUrl would wrongly move to https.
const LOCAL = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//;

const DRAWN = /^(?:https:\/\/[^/]+)?\/api\/covers\/(?:playlist|mixtape|mix)\/[^?#]+\?(?:[^#]*&)?s=\d+/;

export function picture(stored: string | null | undefined, kind: ImageKind, size?: { w?: number | null; h?: number | null }): StoredPicture {
  if (!stored || !stored.trim()) return { image: null, original: null };
  const address = stored.trim();
  if (DRAWN.test(address)) return { image: { src: address.replace(/([?&]s=)\d+/, "$1{rung}"), kind }, original: address };
  // the Mac app's own server and its hub answer on plain http at this computer's own address
  if (LOCAL.test(address)) return { image: null, original: address };
  return { image: imageRef(address, { kind, w: size?.w, h: size?.h }), original: fallbackOriginal(address) };
}

// Hosts a browser must never be sent to for a picture (CLAUDE.md: no Deezer, no Last.fm, ever).
const BANNED_HOST = /(?:^|\.)(?:dzcdn|deezer|lastfm|audioscrobbler)(?:\.|$)|(?:^|\.)last\.fm$/i;
// Cover Art Archive and the archive.org storage it hands out: through our picture server only.
const ARCHIVE_HOST = /(?:^|\.)archive\.org$/i;

/**
 * The address to fall back to when the ladder can't answer: ours only. A picture whose original lives at
 * Cover Art Archive is served through our picture server or not at all (2026-11-08, the image lock-in: the
 * fallback sent browsers straight to archive.org for about half the catalog whenever a size was slow), and
 * a banned host is never asked. Other outside hosts are left as they were (artist photos not yet stored).
 */
function fallbackOriginal(address: string): string | null {
  const url = mediaUrl(address);
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return url;
  }
  if (BANNED_HOST.test(host) || ARCHIVE_HOST.test(host) || IMAGE_EXTERNAL_HOSTS.includes(host)) return null;
  return url;
}

/** One rung of a stored picture as an address, or the original when the ladder cannot serve it. */
export function ladderSrc(stored: string | null | undefined, rung: ImageRung, kind: ImageKind = "cover"): string | null {
  const { image, original } = picture(stored, kind);
  return image ? imageUrl(image, rung) : original;
}
