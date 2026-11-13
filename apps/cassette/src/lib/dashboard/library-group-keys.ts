/**
 * Shared album grouping for library cards, matcher, and inherited-album API.
 * effectiveAlbumArtist fallbacks are computed at read/group time only — never
 * written to user_library_index.album_artist.
 */

import { normalizeArtist, normalizeTitle } from "./match-normalize";

export const VARIOUS_ARTISTS = "Various Artists";

/**
 * Phase 1 (Gap 1) device-grouping model version. The cloud stamps this on the
 * per-track grouping it ships to a device; the device stores the last version it
 * applied and, when this constant is higher, runs its idempotent regroup
 * (merging legacy PID-keyed AlbumMOs onto the group keys below). Bump ONLY when
 * the grouping algorithm (buildAlbumGroupKey / display selection) changes in a
 * way that should force a device-side regroup. Never decremented.
 */
// v2: group_key is now NUL-free (pgSafeAlbumGroupKey) — the v1 NUL separator
// broke the device's SQLite AlbumMO.id lookup and produced duplicate albums.
// v3: per-track grouping carries album `year` (override ?? catalog release),
// same source as the web rail, so the phone stops reading empty Subsonic tags.
export const GROUPING_MODEL_VERSION = 3;

export type AlbumIndexRow = {
  artistName: string;
  albumName: string;
  albumArtist: string | null;
};

/** Inherited source album-artist values present on rows (non-empty, trimmed). */
function inheritedAlbumArtists(rows: AlbumIndexRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    const v = r.albumArtist?.trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * Album artist for grouping/display. Uses inherited album_artist when
 * consistent; otherwise dominant track artist or "Various Artists".
 */
export function effectiveAlbumArtist(rows: AlbumIndexRow[]): string {
  if (rows.length === 0) return "";

  const fromTags = inheritedAlbumArtists(rows);
  if (fromTags.length === 1) return fromTags[0]!;
  // Inconsistent or absent inherited album_artist → heuristic below.

  const counts = new Map<string, number>();
  for (const r of rows) {
    const name = r.artistName.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return rows[0]!.artistName.trim();
  if (ranked.length === 1) return ranked[0]![0];

  // With no album artist tagged, only a clear majority (more than half the songs) names the album.
  // A plurality does not: a compilation where one performer has two of 21 songs is not theirs. (BUG-579)
  const total = ranked.reduce((sum, [, n]) => sum + n, 0);
  const [top] = ranked;
  if (top![1] * 2 > total) return top![0];
  return VARIOUS_ARTISTS;
}

/** Matcher + internal bucket key (no inherited:/catalog- prefix). */
export function buildAlbumGroupKey(rows: AlbumIndexRow[]): string {
  const albumName = rows[0]!.albumName;
  return `${normalizeArtist(effectiveAlbumArtist(rows))}\u0000${normalizeTitle(albumName)}`;
}

/**
 * Postgres-safe form of the album group key. `buildAlbumGroupKey` joins on a NUL
 * (\u0000), which Postgres `text` columns reject — so any key that is PERSISTED
 * (currently only user_rip_completeness.album_group_key) must use this. The NUL is
 * swapped for a unit separator (\u001f): NUL-free, and collision-free vs real text.
 * The separator is always present, so this always differs from the raw key by
 * exactly that char — which is why it MUST be used symmetrically on both the write
 * and the read of a stored key, or the lookup silently misses.
 */
export function pgSafeAlbumGroupKey(rows: AlbumIndexRow[]): string {
  return toPgSafeGroupKey(buildAlbumGroupKey(rows));
}

/** Same NUL→unit-separator swap as pgSafeAlbumGroupKey, for a key already in
 *  hand (e.g. from resolveAlbumNameKey) rather than a fresh row bucket. */
export function toPgSafeGroupKey(nameKey: string): string {
  return nameKey.replace(/\u0000/g, "\u001f");
}

export function inheritedAlbumGroupKey(
  effectiveArtist: string,
  albumName: string
): string {
  return `inherited:${normalizeArtist(effectiveArtist)}\u0000${normalizeTitle(albumName)}`;
}

export const CATALOG_ALBUM_KEY_PREFIX = "catalog-album:";

export function catalogAlbumGroupKey(albumId: number): string {
  return `${CATALOG_ALBUM_KEY_PREFIX}${albumId}`;
}

/**
 * Parse a `catalog-album:<id>` card group key back to its catalog album id, or
 * null if the key isn't that form. Auto-matched album cards carry this key (it
 * has no NUL separator, so it is NOT a well-formed name key); the tracks
 * route and the owned-row resolver use this to recognize and resolve it.
 */
export function parseCatalogAlbumGroupKey(groupKey: string): number | null {
  if (!groupKey.startsWith(CATALOG_ALBUM_KEY_PREFIX)) return null;
  const raw = groupKey.slice(CATALOG_ALBUM_KEY_PREFIX.length);
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function inheritedArtistGroupKey(effectiveArtist: string): string {
  return `inherited-artist:${normalizeArtist(effectiveArtist)}`;
}

export const CATALOG_ARTIST_KEY_PREFIX = "catalog-artist:";

export function catalogArtistGroupKey(artistId: number): string {
  return `${CATALOG_ARTIST_KEY_PREFIX}${artistId}`;
}

/**
 * Parse a `catalog-artist:<id>` card group key back to its catalog artist id, or
 * null if the key isn't that form. Matched artist cards carry this key; the
 * owned-artist rail resolver uses it to recognize and resolve the card.
 */
export function parseCatalogArtistGroupKey(groupKey: string): number | null {
  if (!groupKey.startsWith(CATALOG_ARTIST_KEY_PREFIX)) return null;
  const raw = groupKey.slice(CATALOG_ARTIST_KEY_PREFIX.length);
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Group rows by album_name, derive effective artist per album, merge buckets
 * that share the same normalized album group key.
 */
export function groupIndexRowsByAlbumKey<T extends AlbumIndexRow>(
  rows: T[]
): Map<string, T[]> {
  const byAlbumName = new Map<string, T[]>();
  for (const r of rows) {
    if (!r.albumName?.trim()) continue;
    const list = byAlbumName.get(r.albumName) ?? [];
    list.push(r);
    byAlbumName.set(r.albumName, list);
  }

  const out = new Map<string, T[]>();
  for (const albumRows of byAlbumName.values()) {
    const key = buildAlbumGroupKey(albumRows);
    const merged = out.get(key) ?? [];
    out.set(key, merged.concat(albumRows));
  }
  return out;
}

/** Plurality catalog_album_id for album-grain card bucketing. */
export function pluralityCatalogAlbumId(
  catalogAlbumIds: Array<number | null | undefined>
): number | null {
  const counts = new Map<number, number>();
  for (const id of catalogAlbumIds) {
    if (id == null) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let best: number | null = null;
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount || (count === bestCount && best != null && id < best)) {
      best = id;
      bestCount = count;
    } else if (best == null) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Album-grain manual preservation. A group is eligible for auto-matching only
 * when NONE of its tracks carry a manual override; any group with a manual row
 * is skipped whole (never written, never cleared). Returns the eligible groups
 * and the flat set of their index ids — the only rows the matcher may clear.
 *
 * This is the guarantee behind the manual-match feature: a manual link is never
 * cleared or overwritten by a matcher run, and a track newly synced onto a
 * manually-matched album is not auto-matched out from under that link.
 */
export function selectAutoEligibleGroups<T extends { id: string }>(
  groups: Map<string, T[]>,
  manualIndexIds: ReadonlySet<string>
): { eligibleGroups: Map<string, T[]>; eligibleIndexIds: Set<string> } {
  const eligibleGroups = new Map<string, T[]>();
  const eligibleIndexIds = new Set<string>();
  for (const [key, rows] of groups) {
    if (rows.some((r) => manualIndexIds.has(r.id))) continue;
    eligibleGroups.set(key, rows);
    for (const r of rows) eligibleIndexIds.add(r.id);
  }
  return { eligibleGroups, eligibleIndexIds };
}

export function isWellFormedAlbumGroupKey(key: string): boolean {
  const sep = key.indexOf("\u0000");
  if (sep <= 0 || sep >= key.length - 1) return false;
  return key.lastIndexOf("\u0000") === sep;
}

/** Decode a card/API group key to the matcher bucket key when needed. */
export function resolveAlbumBucketKey(groupKey: string): string {
  if (groupKey.startsWith("inherited:")) {
    return groupKey.slice("inherited:".length);
  }
  return groupKey;
}

export function toBase64Url(s: string): string {
  const b64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(s, "utf8").toString("base64")
      : btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function fromBase64Url(encoded: string): string {
  let b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4;
  if (pad) b64 += "=".repeat(4 - pad);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(b64, "base64").toString("utf8");
  }
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
