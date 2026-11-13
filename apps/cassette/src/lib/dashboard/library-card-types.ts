/**
 * A record and an artist in someone's library, as the library's cards draw them (the shapes
 * lib/dashboard/library-cards makes from the database, and the cloud hands the Mac app). Types only.
 */

export type LibraryAlbumCard = {
  artistName: string;
  albumName: string;
  trackCount: number;
  groupKey: string;
  /**
   * A representative owned-track Subsonic id, used to address the sidecar's local
   * cover proxy (offline-beautiful covers, Job 2). Present for UNMATCHED albums
   * too, so the rip's on-disk art shows when catalog art is unavailable. Null
   * only if the bucket somehow carries no subsonic id.
   */
  localCoverTrackId: string | null;
  /** The version of the cover in the record's folder on the Mac (local-cover-version.ts), for the
   *  hub's cover address (cv=), so the desktop window keeps the picture until it changes (BUG-920).
   *  Null when the hub hasn't fingerprinted one. */
  localCoverVersion: string | null;
  /** The user's chosen cover override (userAlbumCoverOverride), already
   *  cache-busted with the override's updatedAt. Top-level (not nested in match)
   *  so an UNMATCHED album can carry a personal cover, and it OUTRANKS
   *  match.coverArt* at render (CoverArt.coverOverrideUrl). Null when unset. */
  coverOverrideUrl: string | null;
  // B4 — from the rip-completeness record (joined by the name group key). Lets the
  // library tell a rip FAILURE (failedTrackCount > 0 → flag + recover) from a user
  // DELETION (no record, or a complete record with owned < expected). Absent when
  // the album wasn't ripped on this device (e.g. imported/bought).
  expectedTrackCount?: number;
  failedTrackCount?: number;
  match: {
    id: number;
    slug: string;
    coverArtUrl: string | null;
    coverArtSmallUrl: string | null;
    frameStyle: string | null;
    dominantColor: string | null;
    /** Catalog genre — toolbar genre filter/group-by (Albums). */
    genre: string | null;
    /** Catalog release date ("YYYY-MM-DD" or partial) — toolbar Decade group-by. */
    releaseDate: string | null;
    /**
     * True when the link is a manual ("Find this album") match. Manual cards
     * keep the inherited groupKey (above) so a click opens the user's inherited
     * tracklist in the rail — only the cover + identity + Album-info link come
     * from the catalog. Auto matches use the catalog group key and open the
     * catalog tracklist (unchanged).
     */
    isManual: boolean;
  } | null;
  /** Most recent play across the album's owned tracks — home-page "recently
   *  played" ordering + the library toolbar's Recently Played sort. Null when
   *  never played. */
  lastPlayedAt?: Date | null;
  /** When this album first landed in the library — the earliest first-seen
   *  across its tracks (preserved across re-syncs). Powers "recently added to
   *  your hub" + the library's Date Added sort. */
  addedAt?: Date | null;
  /** How many of the album's owned tracks were ever played (distinct) — the
   *  home-shelf engine's deep-cut signal ("kept for one or two songs"). */
  playedTrackCount?: number;
  /** Summed play count across the album's tracks — the rekindle signal. */
  totalPlays?: number;
};

export type LibraryArtistCard = {
  artistName: string;
  trackCount: number;
  albumCount: number;
  groupKey: string;
  match: {
    id: number;
    slug: string;
    genre: string | null;
    imageUrl: string | null;
  } | null;
  /** Most recent play across the artist's owned tracks — see
   *  LibraryAlbumCard.lastPlayedAt. */
  lastPlayedAt?: Date | null;
  /** When the earliest of the artist's tracks first landed — the home-shelf
   *  engine's "recently added artist" signal (min first-seen across its albums). */
  addedAt?: Date | null;
  /** Summed play count across the artist's owned tracks — the shelf blend's
   *  rediscovery weight. */
  totalPlays?: number;
  /** The photo to actually render: a personal "just for my library" pick
   *  (userArtistPhotoOverride) if one exists, else match.imageUrl. Top-level
   *  (not nested in match) so an UNMATCHED artist can still carry a personal
   *  photo with no catalog identity backing it. */
  photoUrl: string | null;
  /** True when photoUrl is the user's PERSONAL pick rather than catalog art. The
   *  renderer needs this: on desktop the on-disk artist.<ext> is OUR catalog image
   *  materialized into their folder, so without this flag it outranks — and silently
   *  overrules — a photo the user chose. Mirrors cover_is_override for albums. */
  photoIsOverride: boolean;
  /** A representative owned-track Subsonic id anchoring the artist's on-disk
   *  folder, for the sidecar's local artist-photo proxy (desktop local-first —
   *  the artist parallel of LibraryAlbumCard.localCoverTrackId). Null when the
   *  artist carries no owned track id. */
  localArtistPhotoTrackId: string | null;
};
