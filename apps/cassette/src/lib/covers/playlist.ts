/**
 * The playlist half of the cover spine.
 *
 * A playlist has no folder/catalog source of truth, so its cover is either the
 * user's own pick or a cover drawn for it: a procedural cover from the cover-art
 * families (src/lib/cover-art), served by /api/covers/playlist/:id and seeded by the
 * playlist id, so it never changes on its own. Setting COVER_ART=off puts back the
 * old deterministic preset (src/data/playlist-cover-presets.ts), explicitly NOT
 * album art. This module is the single home for that logic: the URL normalizer,
 * the derived-cover picker, and the one resolver every render surface should call.
 * It lives under covers/ (not sync-shapes / dashboard) so both the sync layer and
 * the web renderers depend on it one-directionally, with no import cycle.
 *
 * Callers render `resolvePlaylistCover(...).url`. The sync WIRE keeps the pick and
 * the derived cover in separate fields (cover_image_url + derived_cover_url) so
 * clients can still tell a real pick apart.
 *
 * A pick can also be one of the drawn families, chosen in the cover picker. It is
 * stored as the playlist's drawn-cover address with that family and no key
 * (`drawnPickUrl`), since a rename redraws it; every reader turns it into the
 * cover's current address rather than handing on the stored one.
 */

import { siteUrl } from "@/lib/urls";
import { IMAGE_RUNGS } from "@discovery/cassette-kit/images";
import { PLAYLIST_COVER_PRESETS } from "@/data/playlist-cover-presets";
import { coverSpec, DEFAULT_COVER_SETTINGS, isFamilyId, type FamilyId } from "@/lib/cover-art/spec";

/** The drawn covers stand in for the presets unless COVER_ART=off, the switch to put the presets back. */
const ART_COVERS = process.env.COVER_ART !== "off";
/**
 * The sizes the cover routes draw at: the image ladder's (docs/reference/CASSETTE_IMAGES.md), which the
 * web's <Picture> picks from for its frame, and the three that older addresses still carry (a phone's
 * saved copy, a shared page). Anything else is drawn at 600.
 */
export const COVER_ART_SIZES = [...IMAGE_RUNGS, 300, 600, 900] as const;

type ArtUrlOpts = { absolute?: boolean; size?: number; family?: FamilyId | null };

/**
 * The address of a drawn cover. Its `v` is the cover's key, which changes exactly when the
 * picture does (a rename, a new family version), so the address can be cached forever. A
 * family the owner chose rides along as `family`, since the route draws whatever it names.
 * `absolute` defaults true for the sync wire and share images; web render passes false.
 */
function artCoverUrl(kind: "playlist" | "mixtape", id: string, name: string, opts: ArtUrlOpts): string {
  const { key, family } = coverSpec(id, name, DEFAULT_COVER_SETTINGS, opts.family);
  const chosen = opts.family && family === opts.family ? `family=${family}&` : "";
  const path = `/api/covers/${kind}/${id}?${chosen}v=${key}&s=${opts.size ?? 600}`;
  return (opts.absolute ?? true) ? siteUrl(path) : path;
}

export function playlistArtCoverUrl(p: { id: string; name: string }, opts: ArtUrlOpts = {}): string {
  return artCoverUrl("playlist", p.id, p.name, opts);
}

/** True for a drawn playlist cover's address, the kind the web can also draw live (LiveCover). */
export function isDrawnPlaylistCover(url: string | null | undefined): boolean {
  return !!url && url.includes("/api/covers/playlist/");
}

/** A drawn family chosen in the cover picker, as the playlist stores it. */
export function drawnPickUrl(playlistId: string, family: FamilyId): string {
  return `/api/covers/playlist/${playlistId}?family=${family}`;
}

/** The family a drawn cover's address names (a stored pick or a current address), else null. */
export function drawnPickFamily(url: string | null | undefined): FamilyId | null {
  if (!isDrawnPlaylistCover(url)) return null;
  const family = /[?&]family=([a-z]+)/.exec(url!)?.[1];
  return isFamilyId(family) ? family : null;
}

/** A shared mixtape's drawn cover, from its title. */
export function mixtapeArtCoverUrl(m: { id: string; title: string }, opts: { absolute?: boolean; size?: number } = {}): string {
  return artCoverUrl("mixtape", m.id, m.title, opts);
}

/**
 * Normalize a stored playlist cover URL: curated preset SVGs become their PNG twin
 * (native loaders can't paint SVG), and - when a cache-bust is given - the URL is
 * stamped with the playlist's updated_at so a cover CHANGE (which bumps updated_at)
 * changes the URL and busts the image cache even when a re-crop reuses the same path.
 *
 * `absolute` (default true) turns a relative site path into an absolute URL. The SYNC
 * WIRE and OG share images NEED absolute (a phone or a social scraper can't resolve a
 * site-relative path). WEB RENDER wants it OFF: next/image's remotePatterns whitelists
 * only CAA + R2, so an absolute same-origin preset URL (cassette.digital/...) is
 * REJECTED with a 400 and the card falls to a blank box - while the same path served
 * relative is optimized locally and renders. So render callers pass absolute:false.
 */
export function playlistCoverUrlForSync(
  url: string | null,
  cacheBustMs?: number,
  opts: { absolute?: boolean } = {}
): string | null {
  if (!url) return null;
  const absolute = opts.absolute ?? true;
  let out = absolute && url.startsWith("/") ? siteUrl(url) : url;
  if (/\/playlist-covers\/preset-\d+\.svg(\?|$)/i.test(out)) {
    out = out.replace(/\.svg(\?|$)/i, ".png$1");
  }
  if (cacheBustMs != null) {
    out += (out.includes("?") ? "&" : "?") + "v=" + cacheBustMs;
  }
  return out;
}

/** Stable FNV-1a hash → index, so a given playlist id always maps to the same preset. */
function stableIndex(id: string, n: number): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (((h >>> 0) % n) + n) % n;
}

/** The deterministic preset cover for a coverless playlist (.svg→.png), used when
 *  COVER_ART=off. `absolute` defaults true for the sync wire; web render passes false
 *  (see the note above). */
export function derivedPresetCoverForPlaylist(
  playlistId: string,
  opts: { absolute?: boolean } = {}
): string | null {
  const n = PLAYLIST_COVER_PRESETS.length;
  if (n === 0) return null;
  const preset = PLAYLIST_COVER_PRESETS[stableIndex(playlistId, n)];
  return preset ? playlistCoverUrlForSync(preset.url, undefined, opts) : null;
}

/** The cover a playlist shows when its owner hasn't picked one: the drawn cover, or the preset with COVER_ART=off. */
export function derivedCoverForPlaylist(
  p: { id: string; name: string },
  opts: { absolute?: boolean; size?: number } = {}
): string | null {
  return ART_COVERS ? playlistArtCoverUrl(p, opts) : derivedPresetCoverForPlaylist(p.id, opts);
}

/** Derived fallback cover per playlist, for the sync wire's derived_cover_url. */
export function resolvePlaylistDerivedCovers(
  playlists: { id: string; name: string }[]
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  for (const p of playlists) out.set(p.id, derivedCoverForPlaylist(p));
  return out;
}

export type ResolvedPlaylistCover = {
  /** The single cover to render: the user's pick, else the derived cover. */
  url: string | null;
  /** True when `url` is the derived cover rather than a pick the user made. */
  isDerived: boolean;
};

/**
 * The one playlist cover resolver every render surface should call: the user's own
 * pick (cache-busted by updated_at) wins; otherwise the derived cover. This
 * replaces the `playlistCoverUrlForSync(pick, ts) ?? derivedPresetCoverForPlaylist(id)`
 * pattern that was hand-repeated across the web render sites.
 *
 * Defaults to RELATIVE urls (`absolute:false`) because its callers render through
 * next/image, which 400s an absolute same-origin url (see playlistCoverUrlForSync).
 * A pick that is already an absolute R2 url is unaffected either way.
 */
export function resolvePlaylistCover(
  p: {
    coverImageUrl: string | null;
    updatedAt: Date;
    id: string;
    name: string;
  },
  opts: { absolute?: boolean } = {}
): ResolvedPlaylistCover {
  const absolute = opts.absolute ?? false;
  const family = drawnPickFamily(p.coverImageUrl);
  if (family) return { url: playlistArtCoverUrl(p, { absolute, family }), isDerived: false };
  const pick = playlistCoverUrlForSync(p.coverImageUrl, p.updatedAt.getTime(), { absolute });
  if (pick) return { url: pick, isDerived: false };
  return { url: derivedCoverForPlaylist(p, { absolute }), isDerived: true };
}

/**
 * The pick as the sync wire sends it: a drawn family at the cover's current address (so a
 * rename sends a new one and the phones fetch the new picture), anything else as
 * playlistCoverUrlForSync makes it.
 */
export function playlistPickForSync(p: { id: string; name: string; coverImageUrl: string | null; updatedAt: Date }): string | null {
  const family = drawnPickFamily(p.coverImageUrl);
  return family ? playlistArtCoverUrl(p, { family }) : playlistCoverUrlForSync(p.coverImageUrl, p.updatedAt.getTime());
}

/**
 * A shared mixtape's cover, for its share image: the pick, else the drawn cover at share size,
 * else (COVER_ART=off) the preset. Always absolute, since a social scraper can't resolve a site path.
 */
export function resolveMixtapeCover(m: { coverImageUrl: string | null; createdAt: Date; id: string; title: string }): string | null {
  const pick = playlistCoverUrlForSync(m.coverImageUrl, m.createdAt.getTime());
  if (pick) return pick;
  return ART_COVERS ? mixtapeArtCoverUrl(m, { size: 1200 }) : derivedPresetCoverForPlaylist(m.id);
}
