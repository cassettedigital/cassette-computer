/**
 * The click-through's shared, serializable types. Pure: no React, no server-only, no @/ imports, so
 * client components and the tests can import them without touching the database reader.
 */

export type RecordKind = "studio" | "live" | "ep" | "compilation" | "other";

/** One of the artist's visible releases (readCatalog): the ONE list both pages build from. */
export type CatalogRow = {
  id: number;
  slug: string;
  title: string;
  releaseDate: string | null;
  releaseType: string | null;
  cover: string | null; // https(coverArtUrl ?? coverArtSmallUrl)
  coverSmall: string | null; // https(coverArtSmallUrl ?? coverArtUrl)
  runtimeSeconds: number | null;
  trackCount: number | null;
  centralityRank: number | null;
  label: string | null; // canonicalLabel(labelCanonical), never Discogs, never albums.label
  enriched: boolean; // ai_enriched_at is set
  /** MusicBrainz's secondary types ("Live", "Mixtape/Street", ...) as the import stored them; left off when there are none (BUG-730). */
  secondaryTypes?: string[];
  /** The second or later copy of a title the artist's catalogue holds many times (markRepeats): not a studio album. */
  repeat?: boolean;
};

/** A catalogue row with its kind attached (splitCatalog). */
export type KindedRow = CatalogRow & { kind: RecordKind };

/** One album_press row, raw (buildPress reads it). */
export type PressRowData = { albumId: number; cards: unknown[]; reveal: unknown[]; hosts: string[] };

/** One stored track with its stored YouTube ids, before layout. */
export type TrackIn = {
  id: number;
  disc: number | null;
  position: number;
  title: string;
  seconds: number | null;
  recognition: number | null;
  videoId: string | null;
  fallbackVideoIds: string[];
};

/** A laid-out track: its displayed disc and its two-digit number within that disc. */
export type LaidTrack<T extends TrackIn = TrackIn> = T & { disc: number; n: string };

export type TrackLayout<T extends TrackIn = TrackIn> = {
  tracks: Array<LaidTrack<T>>;
  /** More than one disc after the false-split rule: only then does a page print disc heads. */
  multiDisc: boolean;
  /** Index into `tracks` of the song Hear it starts on; null when nothing has a preview. */
  startIndex: number | null;
  /** Sum of the kept songs' lengths, only when every kept song has one. */
  summedSeconds: number | null;
  /** A later disc of other versions (an edition's bonus disc) was left off: the record is disc 1. */
  bonusDropped: boolean;
};

/** A best-known song (readBestKnown), ready to map to a Playable. */
export type SongRow = {
  trackId: number;
  title: string;
  album: string;
  albumSlug: string;
  year: string | null;
  cover: string | null; // https(cover_art_small_url ?? cover_art_url)
  seconds: number | null;
  videoId: string;
  fallbackVideoIds: string[];
};

export type WeightedTag = { tag: string; weight: number };

/** The taste columns the meter compares (readTaxonomy). */
export type Taxonomy = {
  id: number;
  moods: WeightedTag[] | null;
  atmospheres: WeightedTag[] | null;
  productionStyles: WeightedTag[] | null;
  vocalStyles: WeightedTag[] | null;
  instrumentation: WeightedTag[] | null;
  lyricalContent: WeightedTag[] | null;
  energyLevel: number | null;
};

export type MeterRow = {
  dim: string;
  tag: string;
  album: number; // 0..1
  artist: number; // 0..1
  word: "MORE" | "LESS" | "IN STEP";
};

/** What readAlbumKinds says about a visible album. */
export type AlbumKind = { slug: string; title: string; releaseType: string | null; releaseDate: string | null; secondaryTypes?: string[] };

/** A Further listening neighbour (furtherListening). */
export type FurtherItem = {
  slug: string;
  title: string;
  artist: string;
  artistSlug: string;
  year: string | null;
  cover: string; // https(cover_art_small_url ?? cover_art_url)
};

/** What the press and grade rules need to know about the record whose press is being read. */
export type RecordFacts = {
  title: string; // the catalogue row's title
  kind: RecordKind; // recordKind(row)
  /** Titles of the artist's OTHER visible releases (readCatalog), for rule P4c. */
  siblings: string[];
  /** Titles of the artist's hidden album rows (readArtistTitles minus the visible ones): reissues, box
   *  sets, sessions. A review naming one of them on a studio record is refused (P4d). */
  editions?: string[];
};

export type PressEntry = {
  order: number; // stored position: cards first (0..), then reveal
  tier: "card" | "reveal";
  quote: string | null; // null = this entry shows its grade only
  headline: string | null; // the outlet's printed title, or the writer's words checked word for word ("article"); never on a voice entry
  headlineSource: "title" | "article" | null;
  treatment: string; // as stored: stroke | accent | voice | voiceQuoteOnly | quoteOnly | plain | gradeOnly
  accent: string | null; // the phrase the "accent" treatment colours; "" as stored reads as null
  voice: boolean; // slot "VOICE", or treatment "voice" | "voiceQuoteOnly"
  speaker: string | null;
  slot: string; // LEAD | SOUND | VOICE | VERDICT | FILL | DISSENT | CLOSER | ""
  stance: string; // rave | warm | mixed | cool | pan | none
  rowLabel: string; // as stored: "Review · 1997", "Looking back · 2012", "Reader review", ...
  /** The byline's small label: rowLabel without a bare "Review" or "Interview" word ("1997",
   *  "Looking back · 2012", "Reader review"); the year alone when that is all that is left; null when nothing. */
  meta: string | null;
  pieceType: string;
  clarity: "anywhere" | "artist" | "album" | null;
  outlet: string; // the display name (outletName, or the paper a carrier reprinted)
  outletKey: string;
  known: boolean; // isKnownOutlet()
  url: string | null;
  host: string | null;
  /** Set when the link is a reprint on a fan archive (the words ran in `outlet`, not on this site). */
  carrier: string | null;
  icon: string | null;
  year: string | null; // source.date's year, else a carrier's date stamp, else the year in rowLabel
  grade: string | null; // as printed, only when trusted (rule P6)
  glyph: string | null; // scoreGlyph(grade) on a review, else null
  pct: number | null;
  kind: string; // review | interview | press
  member: boolean; // source.member: a reader review
};

export type PressSet = {
  top: PressEntry[]; // the album page's cards, lead first, 0 to 6, every one with a quote
  more: PressEntry[]; // the rest, in stored order, behind "Read all N more reviews"
  total: number; // top.length + more.length (countReviews)
  noun: "review" | "piece";
  /** `more` split for the album page: the entries with a quote, and the grade-only ones. */
  moreQuoted: PressEntry[];
  moreGraded: PressEntry[];
  refused: Array<{ order: number; outlet: string; url: string | null; rule: string }>; // never rendered
};

export type StripItem = {
  outlet: string;
  glyph: string;
  icon: string | null;
  url: string | null;
  /** True when this grade's entry sits in `more` (behind Read all), so a click must open the reveal. */
  inMore: boolean;
};
