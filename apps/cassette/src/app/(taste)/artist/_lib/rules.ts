/**
 * The artist page's pure rules: which photo, the facts, the lead record and the covers the header
 * stacks, the Wikipedia lead, what each release is and how the records list is viewed, the line an open
 * record carries, and how the name fits. Relative imports only, no React, no server-only, so
 * `pnpm dlx tsx --test` loads it from anywhere. It sits in _lib (no brackets in the path) so the test
 * runner's glob can find its test.
 */

import { https, yearOf } from "../../_kit/format";
import { kindLabel, songKey } from "../../_kit/records";
import type { PressEntry, PressSet, RecordKind } from "../../_kit/types";
import type { HeaderPhoto, PhotoCredit, RecordGroup, RecordShow, RecordSort, StackCover } from "./types";
import { siteLabel } from "../../../../lib/artist-own-links-rules";

/* ── the photo ── */

type GalleryRowLike = {
  url: string;
  author?: string | null;
  licenseShort?: string | null;
  licenseUrl?: string | null;
  sourceUrl?: string | null;
  attributionRequired?: boolean | null;
};

/**
 * Only an allowed image host or an open-licence Commons file may show. A legacy Deezer primary still
 * sits in some old rows (src/lib/artist-image-sql.ts:7-14); it never reaches the page (no Deezer, ever).
 */
const COMMONS = /^https?:\/\/upload\.wikimedia\.org\//i;
export const photoAllowed = (url: string | null | undefined, renderable: (u: string) => boolean): boolean =>
  !!url && (renderable(url) || COMMONS.test(url));

/** The thumbnail width for the circle: one of Wikimedia's standard steps (160 is refused, 250 is served). */
export const THUMB_PX = 250;

/**
 * A Commons file's thumbnail at `px` wide, so a small circle never downloads a camera original:
 * /wikipedia/commons/a/ab/Name.jpg becomes /wikipedia/commons/thumb/a/ab/Name.jpg/250px-Name.jpg.
 * An existing thumbnail is asked for at this width instead. Null for anything else (another host, a
 * format Commons thumbnails to another type).
 */
export function commonsThumb(url: string, px: number): string | null {
  // already a thumbnail: the same one at this width
  const t = url.match(/^(https?:\/\/upload\.wikimedia\.org\/wikipedia\/[a-z]+\/thumb\/[0-9a-f]\/[0-9a-f]{2}\/[^/]+\/)\d+px-([^/?#]+)$/i);
  if (t) return `${t[1]}${px}px-${t[2]}`;
  const m = url.match(/^(https?:\/\/upload\.wikimedia\.org\/wikipedia\/[a-z]+\/)([0-9a-f])\/([0-9a-f]{2})\/([^/?#]+\.(?:jpe?g|png|webp|gif))$/i);
  if (!m) return null;
  const [, base, a, ab, file] = m;
  return `${base}thumb/${a}/${ab}/${file}/${px}px-${file}`;
}

/**
 * The header's photo: the loader's hero (an allowed primary, else any allowed row, else a creator's own
 * photo), else the first allowed gallery row (N.W.A: every photo is a raw Commons file, so the loader
 * has no hero). Its gallery row, matched by address, gives its credit.
 */
export function pickPhoto(
  imageUrl: string | null,
  gallery: GalleryRowLike[],
  renderable: (url: string) => boolean,
): { photo: HeaderPhoto; credit: PhotoCredit | null } | null {
  const ok = gallery.filter((g) => photoAllowed(g.url, renderable));
  const hero = photoAllowed(imageUrl, renderable) ? imageUrl : null;
  const row = hero ? ok.find((g) => g.url === hero) ?? null : ok[0] ?? null;
  const src = hero ?? row?.url ?? null;
  if (!src) return null;
  const isRenderable = renderable(src);
  return {
    photo: { src: https(src) ?? src, renderable: isRenderable, thumb: isRenderable ? null : commonsThumb(https(src) ?? src, THUMB_PX) },
    credit:
      row && row.attributionRequired === true
        ? { author: row.author ?? null, license: row.licenseShort ?? null, licenseUrl: row.licenseUrl ?? null, sourceUrl: row.sourceUrl ?? null }
        : null,
  };
}

/** The lightbox's photos: allowed rows only, the header's photo first; none unless there are 2 or more. */
export function galleryFor<T extends GalleryRowLike>(photoSrc: string | null, gallery: T[], renderable: (u: string) => boolean): T[] {
  const ok = gallery.filter((g) => photoAllowed(g.url, renderable));
  if (ok.length < 2) return [];
  const at = photoSrc ? ok.findIndex((g) => g.url === photoSrc || https(g.url) === photoSrc) : -1;
  return at > 0 ? [ok[at], ...ok.slice(0, at), ...ok.slice(at + 1)] : ok;
}

/* ── the words beside the photo ── */

/**
 * The facts as small labelled boxes (P11): From and Since, each only when we know it. No genre (founder,
 * 2026-11-12: "nix genre - we don't need that"). The span of
 * studio years is not said: the records list prints every year one screen below, and "1993 to 2016"
 * under a name reads like a career that stopped. "Since" only when we know when they started (it is null
 * for a person, BUG-305), and not when the Wikipedia lead shows: the lead says when they formed in its
 * own words, and our stored year can disagree with it (Radiohead's is 1991, the lead says 1985).
 * Then their own website, last, when we know one that still opens (founder, 2026-11-12: "list the artist's
 * website as part of their info"): named by its address, "mavisstaples.com", and a way out to it.
 */
export function factBoxes(
  country: string | null,
  activeSince: string | null,
  hasLead = false,
  website: string | null = null,
): Array<{ k: string; v: string; href?: string }> {
  const out: Array<{ k: string; v: string; href?: string }> = [];
  if (country?.trim()) out.push({ k: "From", v: countryName(country.trim()) });
  if (activeSince && !hasLead) out.push({ k: "Since", v: activeSince });
  const site = website ? siteLabel(website) : null;
  if (website && site) out.push({ k: "Website", v: site, href: website });
  return out;
}

/** "GB" to "United Kingdom": the stored country is often a two-letter code; a name stays as it is. */
export function countryName(country: string): string {
  if (!/^[A-Z]{2}$/.test(country)) return country;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(country) ?? country;
  } catch {
    return country;
  }
}

/* ── the lead record and the header's covers ── */

type StudioLike = { slug: string; title: string; releaseDate: string | null; centralityRank: number | null; cover: string | null; coverSmall: string | null };

/**
 * The record that lights the page and is open on load: the lowest stored centrality rank; else the
 * record that holds the best-known song; else the newest; else none.
 */
export function pickLead(studio: Pick<StudioLike, "slug" | "releaseDate" | "centralityRank">[], topSongAlbum: string | null): string | null {
  const ranked = studio.filter((r) => r.centralityRank != null).sort((a, b) => (a.centralityRank as number) - (b.centralityRank as number));
  if (ranked[0]) return ranked[0].slug;
  if (topSongAlbum && studio.some((r) => r.slug === topSongAlbum)) return topSongAlbum;
  const newest = [...studio].sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""))[0];
  return newest?.slug ?? null;
}

/** How many covers the header stacks. */
export const STACK = 3;

/**
 * Their studio albums, most popular first: the lead record; then by stored centrality rank; then the records
 * their best-known songs come from, in song order; then the newest. The header stacks the first three that have
 * a cover, and Preview plays them all in this order.
 */
export function rankStudio<R extends Pick<StudioLike, "slug" | "releaseDate" | "centralityRank">>(studio: R[], lead: string | null, songAlbums: string[]): R[] {
  const order: R[] = [];
  const add = (r: R | undefined) => {
    if (r && !order.includes(r)) order.push(r);
  };
  add(studio.find((r) => r.slug === lead));
  studio
    .filter((r) => r.centralityRank != null)
    .sort((a, b) => (a.centralityRank as number) - (b.centralityRank as number))
    .forEach(add);
  for (const slug of songAlbums) add(studio.find((r) => r.slug === slug));
  [...studio].sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "")).forEach(add);
  return order;
}

/** The header's covers, front first: the first `n` of rankStudio that have a cover. */
export function stackOf(studio: StudioLike[], lead: string | null, songAlbums: string[], n = STACK): StackCover[] {
  const withArt = studio.filter((r) => r.cover || r.coverSmall);
  return rankStudio(withArt, lead, songAlbums)
    .slice(0, n)
    .map((r) => ({
      slug: r.slug,
      title: r.title,
      year: yearOf(r.releaseDate),
      src: (r.cover ?? r.coverSmall) as string,
      small: r.coverSmall ?? r.cover,
    }));
}

/* ── what the header's Preview plays ── */

type SongLike = { trackId: number; title: string };
type HearLike<T> = { slug: string; title: string; hear: { queue: T[] } | null };
export type PreviewQueue<T> = { queue: T[]; first: string | null; records: number };

/**
 * What the header's Preview plays, as one queue from the top: their best-known songs, then every studio album
 * that can play, most popular first (`albums`, rankStudio's order), each in running order, leaving out a song
 * already queued (the same song on another record counts: songKey). An artist the songs pass has not reached has
 * no best-known songs (BUG-820: no list beats a wrong one), so theirs starts on the lead album; with no album that
 * can play either, on their first record that can. `first` names the record it starts on (null when it starts on
 * the best-known songs), `records` how many records follow; null when nothing can play.
 */
export function previewOf<T extends SongLike>(songs: T[], records: HearLike<T>[], albums: string[]): PreviewQueue<T> | null {
  const queue: T[] = [];
  const seen = new Set<string>();
  const add = (t: T) => {
    const key = songKey(t.title) || `#${t.trackId}`;
    if (seen.has(key) || seen.has(`#${t.trackId}`)) return false;
    seen.add(key).add(`#${t.trackId}`);
    queue.push(t);
    return true;
  };
  songs.forEach(add);
  const bySlug = new Map(records.map((r) => [r.slug, r]));
  const from = albums.map((slug) => bySlug.get(slug)).filter((r): r is HearLike<T> => !!r?.hear);
  if (!songs.length && !from.length) {
    const other = records.find((r) => r.hear);
    if (other) from.push(other);
  }
  let first: string | null = null;
  let count = 0;
  for (const r of from) {
    const added = r.hear!.queue.map(add).filter(Boolean).length;
    if (!added) continue;
    count++;
    if (!songs.length && first == null) first = r.title;
  }
  return queue.length ? { queue, first, records: count } : null;
}

/* ── the Wikipedia lead ── */

/** At most about this many characters: two sentences when both fit, one when only the first does. */
export const LEAD_MAX = 320;
/** A first sentence alone may run a little over; longer than this and the header says nothing. */
export const LEAD_ONE_MAX = 360;

/** Words whose full stop never ends a sentence. */
const ABBREV = new Set(["mr", "mrs", "ms", "dr", "st", "jr", "sr", "mt", "ft", "vs", "etc", "inc", "ltd", "co", "no", "vol", "approx", "c", "ca"]);

/** Sentences, split only where a full stop, ! or ? is followed by a space and a capital or a digit. */
export function sentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  const re = /[.!?]["'”’)\]]*(?=\s+["'“‘(\[]?[A-Z0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    if (text[m.index] === ".") {
      const word = text.slice(start, m.index).split(/\s+/).pop() ?? "";
      // an initial ("J."), an abbreviation ("St."), or a dotted name ("U.S.", "N.W.A.")
      if (/^[A-Z]$/.test(word) || ABBREV.has(word.toLowerCase()) || /\.[A-Za-z]/.test(word)) continue;
    }
    out.push(text.slice(start, end).trim());
    start = end;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

/** A complete sentence: ends in . ! or ?, a closing quote or bracket may follow. */
const SENTENCE_END = /[.!?]["'”’)\]]?$/;

/**
 * The header's lead: the first two sentences of the stored Wikipedia summary, at most about LEAD_MAX
 * characters and always ending on a full sentence. Pronunciation brackets (and what the extraction
 * leaves of them) and empty brackets are dropped, whitespace is folded, and an em dash is set as a spaced en dash. Null when there is no
 * summary, or when even its first sentence runs past LEAD_ONE_MAX.
 */
export function wikiLead(summary: string | null | undefined): string | null {
  if (!summary) return null;
  const text = summary
    .replace(/\s+/g, " ")
    .replace(/\s*\((?:[^()]*?(?:\/[^/()]+\/|\blisten\b|\bpronounced\b|\bIPA\b|ⓘ)[^()]*?)\)/gi, "")
    // what the summary's extraction leaves of a pronunciation: a bracket opening on a space, "( BONE ee-VAIR)"
    .replace(/\s*\(\s[^()]*\)/g, "")
    .replace(/\s*\(\s*[;,:]?\s*\)/g, "")
    // a bracket the extraction opened on a separator, "(; né Gold; September 25, 1932 ...)": the separator goes
    .replace(/\(\s*[;,:]\s*/g, "(")
    .replace(/\s*[\u2014\u2015]\s*/g, " – ")
    .replace(/\s+([,;:.])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const [first, second] = sentences(text);
  if (!first || !SENTENCE_END.test(first) || first.length > LEAD_ONE_MAX) return null;
  if (second && SENTENCE_END.test(second) && first.length + 1 + second.length <= LEAD_MAX) return `${first} ${second}`;
  return first;
}

/* ── the records ── */

/**
 * What a release is on the list, and its small type label. Studio albums are the default and carry
 * none. EPs and singles share a view, live records have their own, compilations and the rest (remix
 * records, bonus discs, undated albums) show only under Everything. A label the title already says
 * ("College EP", "Live at the Astoria") is not repeated.
 */
export function groupOf(kind: RecordKind, releaseType: string | null, title: string): { group: RecordGroup; label: string | null } {
  if (kind === "studio") return { group: "album", label: null };
  if (kind === "live") return { group: "live", label: kindLabel("live", title) };
  if (kind === "ep") return { group: "ep", label: kindLabel("ep", title) };
  if (kind === "compilation") return { group: "other", label: "Compilation" };
  if ((releaseType ?? "").toLowerCase() === "single") return { group: "ep", label: "Single" };
  return { group: "other", label: null };
}

const TYPE_WORDS: Record<string, string> = {
  album: "Album",
  single: "Single",
  ep: "EP",
  live: "Live",
  compilation: "Compilation",
  soundtrack: "Soundtrack",
  remix: "Remix",
  mixtape: "Mixtape",
  demo: "Demo",
};

/**
 * What a release is, in a word, for the kind column that shows when a view mixes kinds (Everything):
 * Album, EP, Single, Live, Compilation. Unlike the old small label it is said even when the title says
 * it ("College EP" is an EP), so the column reads straight down. A release that is none of the main
 * kinds takes its stored type's word (an undated album is an Album), else "Other".
 */
/** The line under a prolific artist's list, which holds only their most central releases (BUG-538). */
export function selectionLine(shown: number, total: number): string | null {
  return total > shown ? `Showing ${shown} of ${total} records. Search for the rest.` : null;
}

export function kindWord(kind: RecordKind, releaseType: string | null, secondaryTypes?: readonly string[] | null): string {
  if (kind === "studio") return "Album";
  if (kind === "live") return "Live";
  if (kind === "ep") return "EP";
  if (kind === "compilation") return "Compilation";
  // a mixtape or a demo is often filed as an "album": MusicBrainz's secondary types say what it is (BUG-986)
  for (const t of secondaryTypes ?? []) {
    const word = SECONDARY_WORDS[String(t).trim().toLowerCase()];
    if (word) return word;
  }
  const type = (releaseType ?? "album").trim().toLowerCase();
  return TYPE_WORDS[type] ?? "Other";
}

/** MusicBrainz secondary types that name a kind of record the stored release type misses. */
const SECONDARY_WORDS: Record<string, string> = {
  "mixtape/street": "Mixtape",
  demo: "Demo",
  remix: "Remix",
  "dj-mix": "DJ mix",
};

/**
 * The kind column shows when the rows in view are more than one kind: Everything, which is only offered
 * when it adds another kind, and EPs & singles when it holds both. A list of one kind (Albums, Live, or
 * an artist with nothing but albums, whose list has no choices at all) says nothing.
 */
export function showsKinds(rows: { kind: string }[]): boolean {
  return rows.some((r) => r.kind !== rows[0].kind);
}

export const SORT_LABEL: Record<RecordSort, string> = { newest: "Newest first", oldest: "Oldest first" };
export const SHOW_LABEL: Record<RecordShow, string> = { album: "Albums", ep: "EPs & singles", live: "Live", all: "Everything" };
export const DEFAULT_VIEW: { sort: RecordSort; show: RecordShow } = { sort: "newest", show: "album" };

/**
 * The Show options an artist gets: a kind only when they have a release of it, and Everything only
 * when it would show something no single kind does. One option or none: there is nothing to choose.
 */
export function showOptions(rows: { group: RecordGroup }[]): RecordShow[] {
  const has = (g: RecordGroup) => rows.some((r) => r.group === g);
  const kinds = (["album", "ep", "live"] as const).filter(has);
  const all = kinds.length >= 2 || has("other");
  const out: RecordShow[] = [...kinds, ...(all ? (["all"] as const) : [])];
  return out.length >= 2 ? out : [];
}

/** The Show a view lands on: the asked one when this artist has it, else Albums, else the first offered. */
export function landShow(asked: RecordShow | null | undefined, offered: RecordShow[]): RecordShow {
  if (offered.length === 0) return "all";
  if (asked && offered.includes(asked)) return asked;
  return offered.includes("album") ? "album" : offered[0];
}

/**
 * The rows a view shows, in its order. `rows` arrive oldest first with the undated last (the catalogue's
 * order); newest first turns the dated ones round and keeps the undated last.
 */
export function arrange<T extends { group: RecordGroup; year: string | null }>(rows: T[], view: { sort: RecordSort; show: RecordShow }): T[] {
  const kept = view.show === "all" ? rows : rows.filter((r) => r.group === view.show);
  if (view.sort === "oldest") return kept;
  const dated = kept.filter((r) => r.year);
  const undated = kept.filter((r) => !r.year);
  return [...dated.reverse(), ...undated];
}

/** Short lines set big, long ones smaller. */
export const sizeOf = (quote: string): "s" | "m" | "l" => (quote.length <= 90 ? "s" : quote.length <= 160 ? "m" : "l");

export const LINE_MIN = 60;
export const LINE_MAX = 240;
/** Words that mark a review of a reissue or a box set, not the record as it came out. */
const REISSUE =
  /\b(reissues?|reissued|remaster(s|ed)?|anniversary|deluxe|expanded edition|special edition|collector'?s edition|box ?set|oknotok|mnesia|amnesiae|housed together)\b/i;

function pathWords(url: string | null): string {
  if (!url) return "";
  try {
    return decodeURIComponent(new URL(url).pathname).replace(/[-_/.+]+/g, " ");
  } catch {
    return url.replace(/[-_/.+]+/g, " ");
  }
}

/** The card reviews a reissue or a box set (Kid A Mnesia, OKNOTOK), by its words or its address. */
export function aboutReissue(e: Pick<PressEntry, "quote" | "headline" | "url">): boolean {
  return REISSUE.test([e.quote ?? "", e.headline ?? "", pathWords(e.url)].join(" "));
}

/** A line that stops mid-thought: on a comma, colon, semicolon, dash or ellipsis, or on a word that needs more after
 *  it ("and", "the", "with"). */
const TRAILING_MARK = /[,;:\u2013\u2014-]["'\u201d\u2019)\]]?$/;
const ELLIPSIS = /(\.\.\.|\u2026)["'\u201d\u2019)\]]?$/;
const DANGLING_WORD = /\b(and|or|but|nor|so|yet|the|a|an|of|to|with|for|in|on|at|by|from|as|than|that|which|who|whose|whom|its|their|his|her|our|my|your|is|are|was|were|be|been|being|has|have|had|will|would|could|should|not|into|onto|upon|about|over|under|between|while|when|where|because|if|though|although)$/i;

/**
 * Whether a quote stops mid-thought. A line needs no full stop of its own (the press editor clips a quote at a clause
 * boundary when the sentence runs long, and short capsule reviews, NME's among them, often print none), but it may
 * not trail off: "it's a summer essential" is a thought, "an album that sounds like the future and" is not. Short
 * fragments ("Enough bite to make it on their own") are already held back by LINE_MIN. The founder, 2026-11-17:
 * Sylvan Esso's self-titled showed no line because its two best cards ended without a full stop.
 */
export function unfinished(q: string): boolean {
  const t = q.trim();
  if (ELLIPSIS.test(t)) return true;
  if (SENTENCE_END.test(t)) return false;
  return TRAILING_MARK.test(t) || DANGLING_WORD.test(t.replace(/["'\u201d\u2019)\]]+$/, ""));
}

/** Why a card cannot be a record's line on the artist page, one name per condition lineFor holds a card to. */
export type LineBlocker =
  | "no-quote"
  | "too-short"
  | "too-long"
  | "no-sentence-end"
  | "clarity"
  | "voice"
  | "member"
  | "dissent"
  | "unknown-outlet"
  | "reissue";

/** The conditions in the order lineFor reads them, for a report that names each. */
export const LINE_BLOCKERS: readonly LineBlocker[] = [
  "no-quote",
  "too-short",
  "too-long",
  "no-sentence-end",
  "clarity",
  "voice",
  "member",
  "dissent",
  "unknown-outlet",
  "reissue",
];

/**
 * Every condition a card fails as a record's line, empty when it passes: a finished thought of 60 to 240 characters,
 * read by the clarity judge as standing alone or with the artist's name ("anywhere" or "artist"), not the artist's
 * own words, a reader review or a dissent, from an outlet we know, and not about a reissue. lineFor takes the first
 * card with none; the audit (scripts/audit-artist-press-line.ts, BUG-733) counts them to see which condition drops
 * the cards a famous artist's page never shows.
 */
export function lineBlockers(e: PressEntry): LineBlocker[] {
  const q = e.quote?.trim() ?? "";
  const out: LineBlocker[] = [];
  if (!q) out.push("no-quote");
  else {
    if (q.length < LINE_MIN) out.push("too-short");
    if (q.length > LINE_MAX) out.push("too-long");
    if (unfinished(q)) out.push("no-sentence-end");
  }
  if (e.clarity !== "anywhere" && e.clarity !== "artist") out.push("clarity");
  if (e.voice) out.push("voice");
  if (e.member) out.push("member");
  if (e.slot === "DISSENT") out.push("dissent");
  if (!e.known) out.push("unknown-outlet");
  if (aboutReissue(e)) out.push("reissue");
  return out;
}

/**
 * The one writer's line an open record carries (the shell's P12, tightened): from that album's own
 * cards in the editor's stored order (then, when none passes, its quotes behind Read all), the first that reads cleanly on an artist page ("anywhere" or
 * "artist", not contested, which buildPress has already enforced), is not the artist's own words, a
 * reader review or a dissent, comes from a known outlet, is a finished thought of 60 to 240 characters
 * (a fragment like "Enough bite to make it on their own" is not one, nor a line that trails off), and is not about a reissue.
 * Null when none passes: the record shows its cover, its size and its links, and no empty quote space.
 */
export function lineFor(set: Pick<PressSet, "top" | "more">): PressEntry | null {
  const all = [...set.top, ...set.more];
  const tier = (t: "card" | "reveal") => all.filter((e) => e.tier === t).sort((a, b) => a.order - b.order);
  // the page's own cards first; when none passes, one of the quotes behind Read all (the founder, 2026-11-17:
  // Sylvan Esso's self-titled had a clean whole sentence there and no line on the artist page)
  return [...tier("card"), ...tier("reveal")].find((e) => lineBlockers(e).length === 0) ?? null;
}

/** What the blockers add up to over a set of records' presses: the evidence for which condition to look at. */
export type LineTally = {
  records: number;
  /** Records whose press has at least one card. */
  recordsWithCards: number;
  recordsWithLine: number;
  cards: number;
  passing: number;
  /** Cards failing each condition, whatever else they fail. */
  failing: Record<LineBlocker, number>;
  /** Cards failing ONLY that condition: the ones loosening it alone would make a line. */
  onlyFailing: Record<LineBlocker, number>;
  /** Records with cards and no line that would have one if that condition alone were dropped. */
  recordsGained: Record<LineBlocker, number>;
};

const emptyCounts = (): Record<LineBlocker, number> => Object.fromEntries(LINE_BLOCKERS.map((b) => [b, 0])) as Record<LineBlocker, number>;

/** Counts, over the presses of any number of records, which condition fails each card (read-only, pure). */
export function tallyLineBlockers(sets: Array<Pick<PressSet, "top" | "more">>): LineTally {
  const t: LineTally = { records: sets.length, recordsWithCards: 0, recordsWithLine: 0, cards: 0, passing: 0, failing: emptyCounts(), onlyFailing: emptyCounts(), recordsGained: emptyCounts() };
  for (const set of sets) {
    const cards = [...set.top, ...set.more].filter((e) => e.tier === "card");
    if (cards.length === 0) continue;
    t.recordsWithCards++;
    const blockers = cards.map(lineBlockers);
    const hasLine = lineFor(set) !== null;
    if (hasLine) t.recordsWithLine++;
    const gained = new Set<LineBlocker>();
    for (const b of blockers) {
      t.cards++;
      if (b.length === 0) t.passing++;
      for (const x of b) t.failing[x]++;
      if (b.length === 1) {
        t.onlyFailing[b[0]]++;
        gained.add(b[0]);
      }
    }
    if (!hasLine) for (const x of gained) t.recordsGained[x]++;
  }
  return t;
}

/* ── best-known songs and the artists like them ── */

/** The best-known songs list: ten at most, with no "more" (the founder, 2026-10-21: "10 is probably more than enough"). */
export const SONGS_MAX = 10;

/**
 * How many of `n` items a grid of `cols` columns shows so its last row is full: the largest whole
 * number of rows. Fewer items than one row's worth all show (one short row, not nothing).
 */
export { fullRows } from "@/app/_taste/rows";

/* ── known for ── */

const CATEGORY_WORDS: Record<string, string> = {
  Atmos: "Atmosphere",
  Prod: "Production",
  Voc: "Vocals",
  Instr: "Instrumentation",
  stature: "Stature",
  identity: "Identity",
  craft: "Craft",
  cultural_role: "Cultural role",
};

/** The category named plainly: the flat-taxonomy abbreviations and the intangible axis keys in words. */
export function categoryWord(c: string): string {
  if (CATEGORY_WORDS[c]) return CATEGORY_WORDS[c];
  const s = c.replace(/_/g, " ").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/* ── the name ── */

/**
 * The largest size, at most `cap`, at which the name fits `fitW` on one line; when that is under
 * `floor`, two lines split where the longer line is shortest, fitted on that line. Never three lines,
 * never a break inside a word. `width(text)` is the text's width at 100px.
 */
export function fitName(o: { name: string; fitW: number; cap: number; floor: number; width: (text: string) => number }): {
  size: number;
  lines: string[];
} {
  const REF = 100;
  const { name, fitW, cap, floor, width } = o;
  const one = (REF * fitW) / Math.max(1, width(name));
  if (one >= floor) return { size: Math.min(cap, one), lines: [name] };
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return { size: Math.min(cap, one), lines: [name] };
  let best: { lines: string[]; max: number } | null = null;
  for (let k = 1; k < words.length; k++) {
    const a = words.slice(0, k).join(" ");
    const b = words.slice(k).join(" ");
    const max = Math.max(width(a), width(b));
    if (!best || max < best.max) best = { lines: [a, b], max };
  }
  const b = best as { lines: string[]; max: number };
  return { size: Math.min(cap, (REF * fitW) / Math.max(1, b.max)), lines: b.lines };
}
