/**
 * Saved for later's shapes (lib/saves.ts reads them; Discover's shelf and /api/saves hand them on). Types only,
 * so the browser's shelf never reaches the database code. Each picture comes twice, as the house does it: the stored
 * address the website's covers draw from (`cover`, `photo`), and beside it the image ladder's reference the phones
 * draw from (`coverRef`, `photoRef`; null when the ladder can't serve it).
 */

import type { ImageRef } from "@discovery/cassette-kit/images";

/** A record as a shelf draws it: its page, its name, its artist and its cover. */
export type SavedRecord = { id: number; slug: string; title: string; artist: string; artistSlug: string | null; cover: string | null; coverRef: ImageRef | null };
/** A new record, with when it came out ("2026-11-07", or as much of it as is known). */
export type NewRecord = SavedRecord & { released: string };
export type SavedArtist = {
  slug: string;
  name: string;
  photo: string | null;
  photoRef: ImageRef | null;
  cover: string | null;
  coverRef: ImageRef | null;
  latest: NewRecord | null;
};
export type SavedSong = { trackId: number; title: string; artist: string; albumSlug: string; albumTitle: string; cover: string | null; coverRef: ImageRef | null };
export type SavedForLater = { artists: SavedArtist[]; records: SavedRecord[]; songs: SavedSong[] };

export const NOTHING_SAVED: SavedForLater = { artists: [], records: [], songs: [] };
