/**
 * The artist page's payload: one plain, serializable shape the server loader hands the client body.
 * Type-only imports, so the pure rules (rules.ts) and their tests can share it.
 */

import type { BuyOption } from "@/app/(taste)/album/[slug]/types";
import type { GalleryImage } from "@/app/components/ArtistGallery";
import type { Playable } from "@/app/_taste/play";

/** The artist's photo, a small circle beside the facts. */
export type HeaderPhoto = {
  src: string; // https
  renderable: boolean; // on an allowed image host: ArtistPhoto (next/image); false: a plain <img>
  thumb: string | null; // a raw Commons file's small thumbnail, tried before the original
};

/** A cover in the header's stack, front first. */
export type StackCover = { slug: string; title: string; year: string | null; src: string; small: string | null };

export type PhotoCredit = { author: string | null; license: string | null; licenseUrl: string | null; sourceUrl: string | null };

/** One writer's line on an open record. */
export type RecordLine = {
  quote: string; // curled, without surrounding marks
  size: "s" | "m" | "l";
  outlet: string;
  url: string | null; // null when the only link is a fan archive's reprint
  icon: string | null; // the favicon's address (/api/press-icon/<host>), or null for the monogram
  glyph: string | null; // "9.3/10", "★★★★", "A", or null
};

/** Which view of the records a release belongs to (rules.ts groupOf). */
export type RecordGroup = "album" | "ep" | "live" | "other";
export type RecordSort = "newest" | "oldest";
export type RecordShow = "album" | "ep" | "live" | "all";

export type RecordItem = {
  slug: string;
  title: string;
  year: string | null;
  group: RecordGroup;
  label: string | null; // "EP", "Single", "Live", "Compilation"; null for an album
  kind: string; // the kind column's word: "Album", "EP", "Single", "Live", "Compilation" (rules.ts kindWord)
  cover: string | null; // https, large
  coverSmall: string | null; // https, small
  meta: string | null; // "12 songs · 53 min", "12 songs", or null when we have no tracks
  line: RecordLine | null;
  read: { label: string; href: string };
  hear: { queue: Playable[]; start: number; song: string } | null;
  /** Where to buy it, for the records panel's Buy menu (the album page's own list, buy.ts); null when no
   *  store carries this kind of record (a webcast, a broadcast). */
  buy: { options: BuyOption[]; pick: string | null; apple: boolean } | null;
};

export type SongItem = { play: Playable; year: string | null };
export type KnownRow = {
  id: string;
  label: string;
  category: string;
  weight: number;
  exemplars: { slug: string; title: string; cover: string }[];
};
/** An artist like this one: their photo, else their best-known cover, and what they share. */
export type Neighbour = { slug: string; name: string; photo: string | null; cover: string | null; shares: string[] };

export type ArtistPayload = {
  slug: string;
  name: string;
  /** From and Since, as labelled boxes, then their own website as a way out; only what is known. No genre. */
  facts: Array<{ k: string; v: string; href?: string }>;
  photo: HeaderPhoto | null;
  /** The lightbox's photos, the header's photo first: only allowed hosts, only when 2 or more. */
  gallery: GalleryImage[];
  credit: PhotoCredit | null;
  /** The first sentence or two of their Wikipedia article and the article; or, once a verified artist has
   *  written their own intro, their words, credited to them. */
  lead: { text: string; url: string | null; by: "wikipedia" | "artist" } | null;
  stack: StackCover[]; // at most 3, front first
  leadSlug: string | null;
  albums: string[]; // every studio album's slug, most popular first (rules rankStudio): Preview plays them after the songs
  songs: SongItem[]; // best known, at most SONGS_MAX (10); the header's Preview plays them first, then `albums` (rules previewOf)
  records: RecordItem[]; // every release, oldest first, undated last (a prolific artist's most central CATALOG_MAX)
  /** How many visible releases the artist has in all, only when `records` is a selection of them (BUG-538). */
  recordsOf?: number;
  known: KnownRow[];
  similar: Neighbour[];
  /** "If you like them for their ___": each side of the artist with its own shelf (lib/artist-taste-like.ts). */
  likeBy: { label: string; rows: Neighbour[] }[];
  /** What the Artists like menu chooses between. Absent: the artist's sides ("If you like Hole for their ___", lib/artist-taste-
   *  like.ts). `fans`: the kinds of fan the band has, from the taste mesh (lib/mesh/artist-like.ts), "Artists like The Strokes,
   *  for the ___"; `lead` names the fan type whose list `similar` is, or null when `similar` blends every fan type's. */
  likeFor?: { kind: "fans"; lead: string | null };
  /** What a claimed artist set up: their own links, where their claim stands, whether they are looking at
   *  their unpublished draft (?preview=1). */
  creator: { links: Array<{ key: string; label: string; href: string }>; claim: "unclaimed" | "pending" | "verified"; previewing: boolean };
};

/** The page's payload and, for the server only, its structured data and id (never handed to the client). */
export type ArtistLoad = ArtistPayload & { jsonLd: Record<string, unknown>; artistId: number };
