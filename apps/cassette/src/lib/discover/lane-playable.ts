/**
 * A lane's song as the page and the API hand it around: the player's Playable plus the record it
 * stands for, so the page can light that record's tile while it plays. Plain data, safe on both sides.
 */

import type { Playable } from "@/app/_taste/play";

export type LanePlayable = Playable & { albumId: number };

/** One record as a lane or a Discover shelf draws it, with the song it plays when it has one. Plain data, here
 *  beside its song so the shelves' drawing (also the desktop app's Discover) needs nothing from the feed's reads. */
export type LaneRecord = {
  id: number;
  slug: string;
  title: string;
  artist: string;
  /** Why this record is on the row, for a row about its artists (New names): "On Lantis". */
  why?: string | null;
  cover: string | null;
  song: LanePlayable | null;
};
