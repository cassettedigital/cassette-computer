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
  restWide: PressEntry | null;
  grades: PressEntry[];
  moreQuotes: [PressEntry[], PressEntry[]];
  moreQuotesSolo: boolean;
  moreWide: PressEntry | null;
  give: Record<string, number>;
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

/** A quote's length class moved `by` sizes: up (+1) is bigger type, down (-1) smaller, within the three. */
const BY_SIZE: QuoteLength[] = ["l", "m", "s"];
export function shiftLength(len: QuoteLength, by: number): QuoteLength {
  return BY_SIZE[Math.max(0, Math.min(2, BY_SIZE.indexOf(len) + by))];
}

/** The press card's type and frame by size of card (quote.module.css): the words' size and line height per
 *  length class, the headline's, the card's padding across, and its height around the words (padding, the
 *  mark, the gaps, the byline), plus what a headline adds besides its own lines. */
const CARD: Record<"card" | "more", { quote: Record<QuoteLength, [number, number]>; head: [number, number]; across: number; frame: number; headFrame: number }> = {
  card: { quote: { s: [30, 1.22], m: [24, 1.36], l: [19.5, 1.5] }, head: [28, 1.04], across: 60, frame: 148, headFrame: 20 },
  more: { quote: { s: [24, 1.3], m: [20, 1.42], l: [17, 1.5] }, head: [21, 1.04], across: 48, frame: 130, headFrame: 16 },
};
/** The average letter's width per px of type, set ragged with text-wrap: pretty: the serif the words are set
 *  in, and the display caps of a headline. Fitted with the frames above to 40 real cards from five records
 *  measured at all five widths (2026-11-17): off by 4 px on average, a line at worst. */
const WORDS_W = 0.435;
const HEAD_W = 0.45;
/** The widths a wide page draws a column of cards at, narrowest to widest: two columns of (the page less its
 *  gutters, up to 1200, less the gap) / 2, for a page 760, 880, 1000, 1120 and 1264 wide or more. An
 *  arrangement is chosen to sit level at all of them, not just the widest. */
export const PRESS_COLUMNS = [339, 399, 459, 519, 591];

/** A card's height in px at each of PRESS_COLUMNS, its words `shift` sizes up or down from their own. */
export function heightsOf(e: PressEntry, size: "card" | "more", shift = 0): number[] {
  const head = headlineOf(e);
  const q = e.quote ?? "";
  const c = CARD[size];
  const [qs, ql] = c.quote[shiftLength(quoteLength(q, !!head), shift)];
  const [hs, hl] = c.head;
  return PRESS_COLUMNS.map((col) => {
    const w = col - c.across;
    const words = Math.ceil((q.length * WORDS_W * qs) / w) * qs * ql;
    const title = head ? c.headFrame + Math.ceil((head.length * HEAD_W * hs) / w) * hs * hl : 0;
    return Math.round(c.frame + title + words);
  });
}

/** Estimated rendered height in px at the widest column, for the fallback balance of a long Read all. */
export function weightOf(e: PressEntry, size: "card" | "more"): number {
  const h = heightsOf(e, size);
  return h[h.length - 1];
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

/** The gap between two cards in a column, and how near level two columns must end before reading order wins. */
const CARD_GAP = 18;
const LEVEL = 40;

/** Two columns of cards, and when their count is odd one card across their foot. */
export type Arranged<T> = { cols: [T[], T[]]; wide: T | null };

/** The worst difference in height between two columns at any of the widths. */
function unevenness(left: number[][], right: number[][]): number {
  let worst = 0;
  for (let k = 0; k < PRESS_COLUMNS.length; k++) {
    const sum = (col: number[][]) => col.reduce((n, h) => n + h[k], 0) + Math.max(0, col.length - 1) * CARD_GAP;
    worst = Math.max(worst, Math.abs(sum(left) - sum(right)));
  }
  return worst;
}

/** Every way to choose `k` of the indexes 0..n-1, in order. */
function choices(n: number, k: number): number[][] {
  const out: number[][] = [];
  const pick = (from: number, chosen: number[]) => {
    if (chosen.length === k) {
      out.push(chosen);
      return;
    }
    for (let i = from; i <= n - (k - chosen.length); i++) pick(i + 1, [...chosen, i]);
  };
  pick(0, []);
  return out;
}

/** Past this many cards the search is too wide to try every way; they go in order, each to the shorter column. */
const ARRANGE_MAX = 13;

/**
 * The cards in two columns whose feet are nearest level at every width a wide page draws them (the founder,
 * 2026-11-17, of a record whose third card stacked under the taller column: "super awkward, uneven overall
 * heights"). An even count splits evenly; an odd one sets one card across the columns' foot, the one that
 * leaves the rest most level (the founder's "one of the other reviews in a wide format on the bottom"), so a
 * column is never a whole card short. Every split is tried. Among those that end within LEVEL of level,
 * reading order wins: each card as near its own place (the first two side by side, then the next two) as
 * the heights allow, and the last card is the one across the foot. A column keeps the editor's order, and
 * the first card always heads the left. What is left over the page absorbs (album.module.css .cols): the
 * shorter column's cards stretch to the taller one's foot.
 */
export function arrange<T>(items: T[], heights: (t: T) => number[]): Arranged<T> {
  const n = items.length;
  if (n < 2) return { cols: [items.slice(), []], wide: null };
  if (n > ARRANGE_MAX) {
    const odd = n % 2 === 1;
    const inCols = odd ? items.slice(0, -1) : items;
    return { cols: balance(inCols, (t) => { const h = heights(t); return h[h.length >> 1]; }), wide: odd ? items[n - 1] : null };
  }
  const hs = items.map(heights);
  let best: { score: [number, number, number]; left: number[]; right: number[]; wide: number } | null = null;
  const wides = n % 2 === 1 ? items.map((_, i) => i) : [-1];
  for (const wide of wides) {
    const idx = items.map((_, i) => i).filter((i) => i !== wide);
    const half = idx.length / 2;
    for (const chosen of choices(idx.length - 1, half - 1)) {
      const inLeft = new Set([0, ...chosen.map((c) => c + 1)]);
      const left = idx.filter((_, r) => inLeft.has(r));
      const right = idx.filter((_, r) => !inLeft.has(r));
      const off = unevenness(left.map((i) => hs[i]), right.map((i) => hs[i]));
      // how far each card sits from its own place in reading order (row by row, left then right)
      let moved = 0;
      idx.forEach((i, r) => {
        const row = inLeft.has(r) ? left.indexOf(i) : right.indexOf(i);
        moved += Math.abs(row - (r >> 1)) + (inLeft.has(r) === (r % 2 === 0) ? 0 : 0.5);
      });
      if (wide >= 0) moved += n - 1 - wide;
      const score: [number, number, number] = [Math.round(off / LEVEL), moved, off];
      if (!best || score[0] < best.score[0] || (score[0] === best.score[0] && (score[1] < best.score[1] || (score[1] === best.score[1] && score[2] < best.score[2])))) {
        best = { score, left, right, wide };
      }
    }
  }
  const b = best!;
  return { cols: [b.left.map((i) => items[i]), b.right.map((i) => items[i])], wide: b.wide >= 0 ? items[b.wide] : null };
}

/**
 * The give and take that brings two columns' feet together once the cards are placed: a card in the
 * shorter column may set its words a size up, or one in the taller column a size down, one size at most
 * and never past the three sizes, whichever change leaves the columns most level at every width (the
 * founder, 2026-11-17: "some give and take on each different card layout that eventually lands us on one
 * smooth top and one smooth bottom"). A change has to earn its place (LEVEL / 2 nearer level); at most
 * two are made, so the words keep their rhythm of short lines big and long ones smaller. Returns
 * String(order) to the size each changed card moves by.
 */
export function settle(cols: [PressEntry[], PressEntry[]], size: "card" | "more"): Record<string, number> {
  const give: Record<string, number> = {};
  if (cols[0].length === 0 || cols[1].length === 0) return give;
  const col = (c: PressEntry[]) => c.map((e) => heightsOf(e, size, give[String(e.order)] ?? 0));
  for (let round = 0; round < 2; round++) {
    const now = unevenness(col(cols[0]), col(cols[1]));
    let pick: { order: string; by: number; off: number } | null = null;
    for (const c of [0, 1]) {
      for (const e of cols[c]) {
        const key = String(e.order);
        if (give[key]) continue;
        for (const by of [1, -1]) {
          give[key] = by;
          const off = unevenness(col(cols[0]), col(cols[1]));
          delete give[key];
          const len = quoteLength(e.quote ?? "", !!headlineOf(e));
          if (shiftLength(len, by) === len) continue;
          if (off <= now - LEVEL / 2 && (!pick || off < pick.off)) pick = { order: key, by, off };
        }
      }
    }
    if (!pick) break;
    give[pick.order] = pick.by;
  }
  return give;
}

/** The fewest quoted reviews worth a Read all button: one alone joins the cards on show instead (the founder,
 *  2026-11-17: "far too common that we have a button just for showing one more review"). */
export const MIN_BEHIND = 2;

/**
 * The press laid out: the lead full width, the rest of the top set in two columns that end level (arrange,
 * then settle; an odd one across their foot), the grade-only entries as one row of grades (Press.tsx
 * places it), and the quoted entries behind Read all the same way in smaller cards.
 *
 * Two rules keep it from looking broken (the founder, 2026-11-17, of Billie Eilish's: "the grid just kinda...
 * breaks on expansion"): a Read all never holds fewer than MIN_BEHIND quotes (fewer join the cards on show),
 * and while there is a Read all, the cards on show under the lead are an even number, so the two columns
 * end level and the revealed cards start under both of them, never under a hole a whole card tall (an odd
 * last card goes behind Read all, first in line).
 */
export function splitPress(set: Pick<PressSet, "top" | "moreQuoted" | "moreGraded">): PressLayout {
  const lead = set.top[0] ?? null;
  let rest = set.top.slice(1);
  let moreQ = set.moreQuoted.filter((e) => !!e.quote);
  if (moreQ.length < MIN_BEHIND) {
    rest = [...rest, ...moreQ];
    moreQ = [];
  }
  if (moreQ.length > 0 && rest.length > 1 && rest.length % 2 === 1) {
    moreQ = [rest[rest.length - 1], ...moreQ];
    rest = rest.slice(0, -1);
  }
  const restSolo = rest.length === 1;
  const top = arrange(rest, (e) => heightsOf(e, "card"));
  const moreQuotesSolo = moreQ.length === 1;
  const more = arrange(moreQ, (e) => heightsOf(e, "more"));
  const give = { ...settle(top.cols, "card"), ...settle(more.cols, "more") };
  const phoneOrder: Record<string, number> = {};
  [...(lead ? [lead] : []), ...rest].forEach((e, i) => (phoneOrder[String(e.order)] = i));
  moreQ.forEach((e, i) => (phoneOrder[String(e.order)] = i));
  return {
    lead,
    rest: top.cols,
    restSolo,
    restWide: top.wide,
    grades: set.moreGraded.filter((e) => !!e.glyph),
    moreQuotes: more.cols,
    moreQuotesSolo,
    moreWide: more.wide,
    give,
    phoneOrder,
  };
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
