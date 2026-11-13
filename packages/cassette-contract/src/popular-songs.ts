/**
 * Shared Popular ranking for an artist's owned songs.
 *
 * Surfaces that must agree on ORDERING:
 *   - web/desktop library artist rail ("Songs")
 *   - iOS ArtistDetail "Popular"
 *   - Android ArtistPage "Popular"
 * Marketing / discovery may reuse later.
 *
 * ORDERING (this file is the authority):
 *   1. playCount descending
 *   2. title ascending (base sensitivity — case/diacritic insensitive)
 *
 * COUNT SOURCE (authoritative for cross-surface Popular):
 *   COUNT of user_play_history rows per cassette_local_id.
 *   - web/desktop: ranks inside the artist-source loader
 *   - iOS / Android: POST /api/sync/popular-rank with local titles, then
 *     paint from the returned order (offline fallback: on-device / hub counts
 *     with this same comparator)
 *
 * Reimplementing a different sort on one client is a product bug.
 */

/** Collapsed Popular list before "Show more" (iOS/Android/web). */
export const POPULAR_SONGS_COLLAPSED_LIMIT = 5;

/** Teaser ceiling after expand — full album tracklists live one tap down. */
export const POPULAR_SONGS_TEASER_LIMIT = 20;

export type PopularSongRankKey = {
  playCount: number;
  title: string;
};

/** Comparator: higher play count first, then title A→Z. */
export function comparePopularSongs(
  a: PopularSongRankKey,
  b: PopularSongRankKey
): number {
  if (a.playCount !== b.playCount) return b.playCount - a.playCount;
  return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
}

/** Stable rank of owned songs for an artist Popular list. */
export function rankPopularSongs<T>(
  items: T[],
  keyOf: (item: T) => PopularSongRankKey
): T[] {
  return [...items].sort((a, b) => comparePopularSongs(keyOf(a), keyOf(b)));
}
