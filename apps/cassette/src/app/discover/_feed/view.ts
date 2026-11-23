/**
 * The Discover page as plain data: what DiscoverBody draws, made once on the server (feed-view.ts discoverView) from
 * the day's kept page. The website's /discover draws it straight away; the desktop app asks the cloud for it
 * (/api/player/desk/discover) and draws the same thing in its window, so both show the same shelves.
 *
 * Types only, from files that read nothing: the desktop app's open-source copy carries this and the drawing, never
 * the feed's reads.
 */

import type { Playable } from "@/app/_taste/play";
import type { BuyOption } from "@/app/(taste)/album/[slug]/types";
import type { ReviewLine } from "@/lib/discovery/review-line-pick";
import type { ShelfModel } from "./Shelf";

/** A top pick (Today's record, This month's find), with the album page's own buttons' data. */
export type DiscoverHero = {
  /** the title's id, for the section's label */
  id: string;
  kicker: string;
  slug: string;
  title: string;
  artist: { name: string; slug: string };
  /** the cover as the pick draws it, and the small one its colour is read from */
  cover: string | null;
  tint: string | null;
  /** the year and the genre */
  meta: string | null;
  line: ReviewLine | null;
  playables: Playable[];
  buy: { options: BuyOption[]; pick: string | null; apple: boolean };
};

/** A station in the Radio band (lib/discover/radio-band.ts BandStation). */
export type DiscoverStation = { slug: string; name: string; image: string; kicker: string };

export type DiscoverView = {
  /** Today's record, or This month's find while the record's rule is still being read */
  top: DiscoverHero | null;
  /** the shelves before This month's find (the listener's own, then genres) */
  upper: ShelfModel[];
  /** This month's find when Today's record is on top, between the two runs of shelves */
  find: DiscoverHero | null;
  /** the shelves after it (New & notable, then New from artists you love or the new records' shelf) */
  lower: ShelfModel[];
  /** the Radio band at the foot, picked for the genres on the page */
  radio: DiscoverStation[];
};
