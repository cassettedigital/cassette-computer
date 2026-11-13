/**
 * `imageRef`: the one way a route, page or job hands out a picture to be SHOWN.
 *
 * Contract: docs/reference/CASSETTE_IMAGES.md (plan and history: docs/CASSETTE_IMAGE_LADDER_PLAN.md).
 * Every picture is shown at one of five sizes, made once by the edge resizer (services/media-edge) and
 * addressed `https://media.cassette.digital/i/<rung>/<bucket>/<key>?v=<version>`. This turns a STORED
 * address (any of the forms the database holds: the media bucket's r2.dev address or our domain, the
 * uploads bucket's r2.dev address, http or https Cover Art Archive links, archive.org copies) into an
 * `ImageRef` whose `src` carries `{rung}`; the client picks the rung for its frame.
 *
 * It returns null for anything the edge cannot serve (another outside host, a relative /api/covers path,
 * an empty value), so the caller keeps its existing fallback.
 *
 * NOT for the saving path: the routes in SAVING_PATH hand the hub ORIGINALS to write into a person's
 * own folders, and must never send a ladder size (it would land in their album folder as a small WebP).
 *
 * No database imports, so scripts and tests can use it.
 */

import { IMAGE_EXTERNAL_HOSTS, ladderTemplate, type ImageBucket, type ImageKind, type ImageRef } from "@discovery/cassette-kit/images";
import { mediaUrl } from "../image-url";
import { R2_DEV_UPLOADS } from "../media-bucket";

const MEDIA_HOST = "https://media.cassette.digital/";

/**
 * The routes whose pictures end up in a person's own files. They keep handing out originals, exactly as
 * before the ladder; image-ref.test.ts ("never reaches the saving path") fails if one of them starts using this module.
 */
export const SAVING_PATH = [
  "src/app/api/player/album-cover/route.ts", // the hub's folder cover for a new album
  "src/app/api/player/artist-photo/route.ts", // the hub's artist photo for a new artist folder
  "src/app/api/sync/library/cover-bytes/route.ts", // a picked cover written into the person's album folder
] as const;

/** FNV-1a over the address, as 8 hex digits: changes whenever the stored address does. */
function version(address: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < address.length; i++) {
    h ^= address.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function base64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Path segments with their escapes read, or null for a malformed escape (a stored address is never trusted to be well formed, and this runs while a page draws). */
function decoded(segments: string[]): string | null {
  try {
    return segments.map(decodeURIComponent).join("/");
  } catch {
    return null;
  }
}

const LADDER = /^https:\/\/media\.cassette\.digital\/i\/\d+\/([mux])\/([^?#]+)/;

/** Where a stored picture lives, in the edge's terms; null when the edge cannot serve it. */
export function imageSource(stored: string | null | undefined): { bucket: ImageBucket; key: string; version?: string } | null {
  if (!stored || !stored.trim()) return null;
  const address = mediaUrl(stored.trim());
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null; // relative paths (drawn covers on /api/covers) are not on the ladder
  }
  if (url.protocol !== "https:") return null;
  // Already one of the ladder's sizes (a page passing on the address a picture is showing): the same
  // picture, never a size of a size.
  const sized = LADDER.exec(address);
  if (sized) {
    const key = decoded(sized[2]!.split("/"));
    if (key === null) return null;
    const version = url.searchParams.get("v");
    return version ? { bucket: sized[1] as ImageBucket, key, version } : { bucket: sized[1] as ImageBucket, key };
  }
  const key = decoded([url.pathname.replace(/^\/+/, "")]);
  if (!key) return null;
  if (address.startsWith(MEDIA_HOST)) return { bucket: "m", key, version: version(address) };
  if (address.startsWith(R2_DEV_UPLOADS)) return { bucket: "u", key, version: version(address) };
  if (IMAGE_EXTERNAL_HOSTS.includes(url.hostname)) return { bucket: "x", key: base64url(address) };
  return null;
}

/**
 * The picture at `stored`, as every route sends it for display; null when the edge cannot serve it.
 * `w` and `h` are the natural size when the caller has it stored (artist photos do; album covers do not).
 */
export function imageRef(stored: string | null | undefined, opts: { kind: ImageKind; w?: number | null; h?: number | null }): ImageRef | null {
  const source = imageSource(stored);
  if (!source) return null;
  const ref: ImageRef = { src: ladderTemplate(source.bucket, source.key, source.version), kind: opts.kind };
  if (opts.w && opts.h && opts.w > 0 && opts.h > 0) {
    ref.w = Math.round(opts.w);
    ref.h = Math.round(opts.h);
  }
  return ref;
}
