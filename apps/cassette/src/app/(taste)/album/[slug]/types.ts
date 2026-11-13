/**
 * The album page's payload: one serializable shape, built on the server (data.ts, shape.ts) and handed
 * to the client sections. Nothing in it is machine prose: the record's facts, the writers' own words,
 * the grades they printed, and numbers.
 */

import type { Playable } from "@/app/_taste/play";
import type { FurtherItem, LaidTrack, MeterRow, PressEntry, RecordKind, StripItem, TrackIn } from "@/app/(taste)/_kit/types";

export type FactBox = { k: "Released" | "Label" | "Songs" | "Length"; v: string };

/** A laid-out song with the guests credited on it and, when a claimed artist uploaded one, their own music
 *  video for it (it plays ahead of the YouTube preview, BUG-539). */
export type AlbumTrack = LaidTrack<TrackIn & { featured: string[]; videoUrl: string | null }>;

/** A song the page's list leaves off with an edition's bonus disc, kept for a ?song= link to it (BUG-715):
 *  its guests, and its preview when it has one. Server-side only; the arrival carries what it needs. */
export type LeftOffSong = { id: number; title: string; featured: string[]; playable: Playable | null };

export type MoreByItem = { slug: string; title: string; year: string | null; cover: string | null; current: boolean };

export type SourceItem = { outlet: string; url: string | null; icon: string | null };

/** A listener's public review (lib/writing/reviews.ts listenerEntry): their name to their page, stars, words. */
export type ListenerReview = {
  name: string;
  href: string;
  piece: string;
  /** 1..10, half stars (lib/writing/format.ts). */
  score: number;
  words: string[];
  more: boolean;
  date: string;
};

/** One row of the Buy menu (buy.ts): a store, what you get there, and its price when we can read one. */
export type BuyOption = {
  key: "direct" | "bandcamp" | "apple" | "bn" | "amazon" | "ebay";
  group: "Physical" | "Digital";
  store: string;
  what: string;
  price: string | null;
  href: string;
  external: boolean;
  /** A store link that can earn us a commission (rel="sponsored"). */
  sponsored: boolean;
  /** Cassette Direct only: the product its checkout sells. */
  productId?: string;
};

/** The press, already laid out on the server so nothing jumps after hydration. */
export type PressLayout = {
  lead: PressEntry | null;
  /** The rest of the top set in two balanced columns, each in editor order. */
  rest: [PressEntry[], PressEntry[]];
  /** Exactly one card after the lead: it takes the full width. */
  restSolo: boolean;
  /** Grade-only entries: one row of grades, under the top cards while Read all is closed, after the last revealed card once it is open. */
  grades: PressEntry[];
  /** The entries behind Read all that carry a quote, in two balanced columns. */
  moreQuotes: [PressEntry[], PressEntry[]];
  moreQuotesSolo: boolean;
  /** String(entry.order) to its place in the top set (lead 0) or in the revealed cards: the phone's one-column order. */
  phoneOrder: Record<string, number>;
};

export type AlbumPage = {
  slug: string;
  title: string;
  artist: string;
  artistSlug: string;
  kind: RecordKind;
  cover: string | null;
  coverSmall: string | null;
  accentSrc: string | null;
  titleWord: number;
  titleMax: number;
  facts: FactBox[];
  strip: StripItem[];
  /** A strip grade sits on a card behind Read all: the strip opens it before jumping. */
  stripOpens: boolean;
  /** The Buy menu's rows, the store it leads with before a person has picked one, and whether to ask
   *  Apple for its download once a person points at Buy (buy.ts). */
  buy: { options: BuyOption[]; pick: string | null; apple: boolean };
  /** Signed in: Want it can save, and Cassette Direct goes straight to checkout. */
  signedIn: boolean;
  /** For Want it: the record's id and whether it is on this person's list already. */
  albumId: number;
  wishlisted: boolean;
  /** A verified artist looking at their own unpublished draft (?preview=1). */
  previewing: boolean;
  tracks: AlbumTrack[];
  multiDisc: boolean;
  startTrackId: number | null;
  playables: Playable[];
  press: {
    /** countReviews(set): the one number, the same on the artist page. */
    total: number;
    noun: "review" | "piece";
    /** Read all's label, counting the cards it opens; null when there are none. */
    readAll: string | null;
    layout: PressLayout;
    /** No press, and the research found nothing to document: no write-up is coming, so the page says nothing
     *  rather than "still writing" (BUG-62). Only ever true when `total` is 0. */
    undocumented: boolean;
  };
  meter: MeterRow[];
  /** The new record words (lib/profile-words.ts, PROFILE_WORDS=on): what sets it apart, and the artist's words
   *  that hold on it. Null when off, when this record has no row, or when the model said it did not know it. */
  words: { own: string[]; kept: string[]; usual: boolean } | null;
  /** A song's own words, by track id, only where it has any; never its record's words. */
  songWords: Record<string, string[]>;
  moreBy: MoreByItem[];
  further: FurtherItem[];
  sources: SourceItem[];
  /** Listeners' public reviews, newest first: kept apart from the press and from writers' reviews, with no
   *  average. Absent or empty: the section isn't drawn. */
  listeners?: ListenerReview[];
};

/** The page's payload and, for the server only, its structured data (never handed to the client). `leftOff` is
 *  the songs its list leaves off with an edition's bonus disc, for a ?song= link that names one (BUG-715): kept
 *  on the object but not enumerable, so a copy or a spread of the page (the desk's, a client body's, a JSON
 *  answer) never carries it. */
export type AlbumLoad = AlbumPage & { jsonLd: Record<string, unknown>; readonly leftOff?: LeftOffSong[] };
