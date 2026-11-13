/**
 * The album page's pure helpers: how the loader's rows become the page's facts, songs, press layout,
 * "More by" row and sources. Pure: relative imports only, no React, no @/, so the tests load it from
 * the repo root.
 */

import { formatReleaseDate, minutesLabel, yearOf } from "../../_kit/format";
import { isUnknownTrack } from "../../_kit/tracks";
import type { CatalogRow, PressEntry, PressSet, RecordKind, TrackIn } from "../../_kit/types";

/* ── types this file returns (structural copies of types.ts, which imports @/ paths) ── */

type FactBox = { k: "Released" | "Label" | "Songs" | "Length"; v: string };
type MoreByItem = { slug: string; title: string; year: string | null; cover: string | null; current: boolean };
type SourceItem = { outlet: string; url: string | null; icon: string | null };
/* ── where to buy (buy.ts reads the stores; these are its rules) ── */

/** The store the Buy button leads with before a person has picked one: the artist's own store, then
 *  Barnes & Noble (the founder's store to lead with), then Apple when it has a price, then eBay. */
export const BUY_PICK_ORDER = ["direct", "bn", "apple", "ebay"] as const;
export function buyPick(keys: string[]): string | null {
  return BUY_PICK_ORDER.find((k) => keys.includes(k)) ?? keys[0] ?? null;
}

/** Which stores a record can be bought from: none for a webcast or a broadcast; new copies (Barnes &
 *  Noble, Amazon, Apple) only for a studio album or a compilation, plus Apple for an EP; used copies
 *  (eBay) for anything a person can own. */
export function storesFor(kind: RecordKind, title: string): { newCopies: boolean; apple: boolean; used: boolean } | null {
  if (/\b(webcast|broadcast)\b/i.test(title)) return null;
  const onShelf = kind === "studio" || kind === "compilation";
  return { newCopies: onShelf, apple: onShelf || kind === "ep", used: true };
}
type PressLayout = {
  lead: PressEntry | null;
  rest: [PressEntry[], PressEntry[]];
  restSolo: boolean;
  grades: PressEntry[];
  moreQuotes: [PressEntry[], PressEntry[]];
  moreQuotesSolo: boolean;
  phoneOrder: Record<string, number>;
};

/* ── songs ── */

export type LoaderTrack = {
  id: number;
  position: number;
  title: string;
  durationSeconds: number | null;
  videoId?: string | null;
  fallbackVideoIds?: string[];
  featured?: string[];
  /** A claimed artist's own uploaded music video for the song (published, by track), when there is one. */
  videoUrl?: string | null;
};

/** The artist's own video address as the page plays it: a full https address, else none (a base that was
 *  never set leaves only a path behind, which would play nothing). */
export function ownVideoUrl(v: string | null | undefined): string | null {
  return typeof v === "string" && /^https:\/\/\S+$/i.test(v.trim()) ? v.trim() : null;
}

/**
 * The live loader's tracks merged by id with the kit's own read: titles, ids, previews and guests from
 * the loader (it carries a creator's retitles and the same YouTube order as the live page); disc and
 * recognition from readPlaylists (the loader sorts by position only). With a creator's tracklist
 * override (`keepOrder`) the loader's positions stand. Copied from The Feature's
 * proto/album-taste/a/[slug]/data.ts:182-209, reshaped for layoutTracks.
 */
export function mergeTracks(loader: LoaderTrack[], own: TrackIn[], keepOrder: boolean): Array<TrackIn & { featured: string[]; videoUrl: string | null }> {
  const byId = new Map(own.map((o) => [o.id, o]));
  return loader.map((t) => {
    const o = byId.get(t.id);
    return {
      id: t.id,
      disc: o?.disc ?? null,
      position: keepOrder ? t.position : (o?.position ?? t.position),
      title: t.title,
      seconds: t.durationSeconds ?? o?.seconds ?? null,
      recognition: o?.recognition ?? null,
      videoId: t.videoId ?? o?.videoId ?? null,
      fallbackVideoIds: t.fallbackVideoIds ?? o?.fallbackVideoIds ?? [],
      featured: (t.featured ?? []).filter((f) => f && f.trim()),
      videoUrl: ownVideoUrl(t.videoUrl),
    };
  });
}

/**
 * The songs the layout left off with an edition's bonus disc (layoutTracks, `bonusDropped`): in the loader's
 * list but not in the laid-out one, and a real song, not a blank or "[unknown]" row. Empty when no disc was
 * dropped. The page does not list them, but a link to one (?song=) still opens it (BUG-715).
 */
export function songsLeftOff<T extends { id: number; title: string }>(all: T[], laid: Array<{ id: number }>, bonusDropped: boolean): T[] {
  if (!bonusDropped) return [];
  const kept = new Set(laid.map((t) => t.id));
  return all.filter((t) => !kept.has(t.id) && !isUnknownTrack(t.title));
}

/**
 * The previews the pane lists: each song's YouTube tile except the songs a claimed artist uploaded their own video
 * for, which plays ahead of YouTube (BUG-539). Each keeps its place in the record's full preview list, since the
 * player's queue is that whole list.
 */
export function previewPane<T extends { trackId: number }>(playables: T[], ownVideo: { has(trackId: number): boolean }): Array<{ x: T; idx: number }> {
  return playables.flatMap((x, idx) => (ownVideo.has(x.trackId) ? [] : [{ x, idx }]));
}

/* ── the opener ── */

/** The title's CSS fit: its longest word (at least 4) and a size cap by length. Copied from The Feature data.ts:146-151. */
export function titleFit(title: string): { word: number; max: number } {
  const word = Math.max(4, ...title.split(/\s+/).map((w) => w.length));
  const len = title.length;
  const max = len <= 12 ? 132 : len <= 24 ? 104 : len <= 40 ? 76 : 56;
  return { word, max };
}

/** The facts as small labelled boxes, each only when it is known. */
export function factBoxes(row: { releaseDate: string | null; label: string | null }, songs: number, minutes: number | null): FactBox[] {
  const out: FactBox[] = [];
  if (row.releaseDate && /^\d{4}/.test(row.releaseDate)) out.push({ k: "Released", v: formatReleaseDate(row.releaseDate) });
  if (row.label) out.push({ k: "Label", v: row.label });
  if (songs > 0) out.push({ k: "Songs", v: String(songs) });
  if (minutes != null && minutes > 0) out.push({ k: "Length", v: minutesLabel(minutes) });
  return out;
}

/** The same facts as the iPhone app's own album screen prints them, one line: "2024 · 11 songs · 38 min". The
 *  label stays off, as it does there. */
export function factLine(facts: Array<{ k: string; v: string }>): string {
  const out: string[] = [];
  for (const f of facts) {
    if (f.k === "Released") {
      const year = f.v.match(/\b\d{4}\b/)?.[0];
      if (year) out.push(year);
    } else if (f.k === "Songs") out.push(f.v === "1" ? "1 song" : `${f.v} songs`);
    else if (f.k === "Length") out.push(f.v);
  }
  return out.join(" · ");
}

/* ── More by ── */

/** The artist's studio albums, oldest first (readCatalog order), this one marked when it is one of them. */
export function moreByItems(studio: CatalogRow[], currentId: number): MoreByItem[] {
  return studio.map((r) => ({ slug: r.slug, title: r.title, year: yearOf(r.releaseDate), cover: r.coverSmall ?? r.cover, current: r.id === currentId }));
}

/* ── press ── */

/**
 * A card's headline as the page prints it: whenever the card has one, on every size of card (the
 * founder, 2026-10-21: "The review formatting lost quite a bit of its character and emphasis"). Kept
 * only from the outlet's printed title or the editor's line from the article (the kit already nulls
 * every other source and voice cards), and not when the editor set the card as a plain quote.
 */
export function headlineOf(e: PressEntry): string | null {
  if (e.voice) return null;
  if (e.treatment === "quoteOnly" || e.treatment === "voiceQuoteOnly") return null;
  return e.headline;
}

/**
 * The highlighter stroke on a headline, the press section's one loud mark, reserved for the strongest of
 * sentiments (the founder, 2026-10-21): only where the editor's stored treatment is "stroke", the
 * writer's stance is a rave, and the headline is a verdict rather than a description (isVerdict). Everything
 * else prints its headline plain.
 */
export function strokeOf(e: PressEntry): boolean {
  const head = headlineOf(e);
  return e.treatment === "stroke" && e.stance === "rave" && !!head && isVerdict(head);
}

/**
 * Words a headline only uses when it is judging the record, not describing it (the founder, 2026-10-21:
 * highlight "real verdicts like OK Computer's, not descriptions like In Rainbows' and The King of Limbs'").
 * The editor stores "stroke" on about one rave headline in four, and half of those describe ("A call to the
 * dance floor", "A very different kind of Radiohead record"); this list keeps the clear verdicts ("Startlingly
 * accomplished set", "Their best in a decade", "Worthy of the hype"), about one stroke in eight of the 508 in
 * the v20 press files. Strict on purpose: a missed highlight costs less than a wrong one. BUG register: the
 * editor should only store "stroke" on a verdict, and then this can go.
 */
const VERDICT =
  /\b(best|finest|greatest|triumph\w*|master(ful|ed|y)?|startling\w*|stunning\w*|dazzling|brilliant\w*|sublime|perfect\w*|wondrous|wonderful|glorious|gorgeous|superb|remarkable|exhilarating|extraordinary|astonishing|breathtaking|transcend\w*|flawless|classic|watershed|magnificent|thrilling|accomplished|hype)\b/i;
export function isVerdict(headline: string): boolean {
  return VERDICT.test(headline);
}

/** A quote's length class, by characters: short lines are set big, long ones smaller, so the grid has a
 *  rhythm. Under a headline the words step down one size (the headline carries the card). */
export type QuoteLength = "s" | "m" | "l";
export const SHORT_QUOTE = 80;
export const LONG_QUOTE = 160;
export function quoteLength(quote: string, headed: boolean): QuoteLength {
  const n = quote.length;
  const own: QuoteLength = n <= SHORT_QUOTE ? "s" : n <= LONG_QUOTE ? "m" : "l";
  if (!headed) return own;
  return own === "s" ? "m" : "l";
}

/** The card sizes' text metrics at the wide column width, for the balance estimate: characters per line
 *  and line height in px, per length class (quote.module.css sets the sizes these follow). */
const METRICS: Record<"card" | "more", Record<QuoteLength, { perLine: number; lineH: number }>> = {
  card: { s: { perLine: 37, lineH: 37 }, m: { perLine: 46, lineH: 32.5 }, l: { perLine: 57, lineH: 29.5 } },
  more: { s: { perLine: 47, lineH: 31 }, m: { perLine: 56, lineH: 28.5 }, l: { perLine: 66, lineH: 25.5 } },
};

/** Estimated rendered height in px at the wide column width, for balancing the two columns on the server. */
export function weightOf(e: PressEntry, size: "card" | "more"): number {
  const head = headlineOf(e);
  const q = e.quote ?? "";
  const { perLine, lineH } = METRICS[size][quoteLength(q, !!head)];
  const base = size === "more" ? 140 : 172; // padding, mark and byline
  const headPerLine = size === "more" ? 52 : 40;
  const headLineH = size === "more" ? 22 : 29;
  return base + (head ? Math.ceil(head.length / headPerLine) * headLineH + 12 : 0) + Math.ceil(q.length / perLine) * lineH;
}

/** Each item, in order, into whichever column is lighter so far (ties to the left). */
export function balance<T>(items: T[], weight: (t: T) => number): [T[], T[]] {
  const left: T[] = [];
  const right: T[] = [];
  let l = 0;
  let r = 0;
  for (const x of items) {
    const w = weight(x);
    if (l <= r) {
      left.push(x);
      l += w;
    } else {
      right.push(x);
      r += w;
    }
  }
  return [left, right];
}

/**
 * The press laid out: the lead full width, the rest of the top set in two balanced columns, the
 * grade-only entries as one row of grades (Press.tsx places it), and the quoted entries behind Read all
 * in two balanced columns of smaller cards.
 */
export function splitPress(set: Pick<PressSet, "top" | "moreQuoted" | "moreGraded">): PressLayout {
  const lead = set.top[0] ?? null;
  const rest = set.top.slice(1);
  const restSolo = rest.length === 1;
  const restCols: [PressEntry[], PressEntry[]] = restSolo ? [rest, []] : balance(rest, (e) => weightOf(e, "card"));
  const moreQ = set.moreQuoted.filter((e) => !!e.quote);
  const moreQuotesSolo = moreQ.length === 1;
  const moreCols: [PressEntry[], PressEntry[]] = moreQuotesSolo ? [moreQ, []] : balance(moreQ, (e) => weightOf(e, "more"));
  const phoneOrder: Record<string, number> = {};
  set.top.forEach((e, i) => (phoneOrder[String(e.order)] = i));
  moreQ.forEach((e, i) => (phoneOrder[String(e.order)] = i));
  return { lead, rest: restCols, restSolo, grades: set.moreGraded.filter((e) => !!e.glyph), moreQuotes: moreCols, moreQuotesSolo, phoneOrder };
}

/** A headline split around its accent phrase (case-insensitive); null when there is no phrase or it is not in the headline. */
export function headParts(headline: string, accent: string | null): [string, string, string] | null {
  if (!accent || !accent.trim()) return null;
  const at = headline.toLowerCase().indexOf(accent.toLowerCase());
  if (at < 0) return null;
  return [headline.slice(0, at), headline.slice(at, at + accent.length), headline.slice(at + accent.length)];
}

/** Every outlet on the page, once, in the order the page shows them: the top set, the chips, then the revealed cards. */
export function sourcesOf(set: Pick<PressSet, "top" | "moreQuoted" | "moreGraded">): SourceItem[] {
  const seen = new Set<string>();
  const out: SourceItem[] = [];
  for (const e of [...set.top, ...set.moreGraded, ...set.moreQuoted]) {
    if (seen.has(e.outletKey)) continue;
    seen.add(e.outletKey);
    out.push({ outlet: e.outlet, url: e.url, icon: e.icon });
  }
  return out;
}

/** An outlet's monogram: the shared set's one helper, handed on so this file's tests keep covering it. */
export { monogram } from "../../../_taste/outlet";
