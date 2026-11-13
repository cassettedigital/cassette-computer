/**
 * The renderer's pure half: what a piece's body (lib/writing/format.ts) draws, decided without React, so
 * tests can pin it and the editor's preview reads the same rules. PieceBody.tsx draws from these.
 *
 *   - Only the nodes and marks in format.ts draw. Anything else draws nothing (never raw HTML, never its
 *     text): a node the contract does not name may be a paste from another app, or a future node this
 *     build cannot draw.
 *   - A link draws only when format.ts allows its address; otherwise its words stay, unlinked.
 *   - List entries are numbered by their order in the body, the same numbers deriveAttachments() stores,
 *     so a piece and an album page's "#3 on ..." always agree. An entry whose record is hidden draws
 *     nothing and keeps its number (the others are not renumbered under it).
 *   - Stars come from the stored score, 1..10 as half stars (format.ts scoreToStars).
 *
 * Pure: no React, no database.
 */

import {
  PICTURE_SIZES,
  POST_KINDS,
  RECORD_SHAPES,
  SCORE_MAX,
  SCORE_MIN,
  isAllowedHref,
  refKey,
  scoreToStars,
  type PictureSize,
  type Post,
  type PostKind,
  type RecordRef,
  type RecordShape,
} from "@/lib/writing/format";

/* ── blocks ── */

/** What a block node draws as; null for anything format.ts does not name (it draws nothing). */
export type BlockPart =
  | "paragraph"
  | "head"
  | "smallHead"
  | "bulletList"
  | "orderedList"
  | "pullQuote"
  | "rule"
  | "picture"
  | "record"
  | "listEntry";

type Loose = { type?: unknown; attrs?: unknown; content?: unknown } | null | undefined;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function blockPart(node: Loose): BlockPart | null {
  if (!isObj(node)) return null;
  switch (node.type) {
    case "paragraph":
      return "paragraph";
    case "heading": {
      const level = isObj(node.attrs) ? node.attrs.level : null;
      return level === 2 ? "head" : level === 3 ? "smallHead" : null;
    }
    case "bulletList":
      return "bulletList";
    case "orderedList":
      return "orderedList";
    case "blockquote":
      return "pullQuote";
    case "horizontalRule":
      return "rule";
    case "picture":
      return pictureOf(node) ? "picture" : null;
    case "record":
      return refOf(node) ? "record" : null;
    case "listEntry":
      return refOf(node) ? "listEntry" : null;
    default:
      return null;
  }
}

/** Where a block sits: the top of the body, inside a list item, inside a list entry's note, inside a pull quote. */
export type Place = "top" | "item" | "entry" | "quote";

const ALLOWED: Record<Place, ReadonlySet<BlockPart>> = {
  top: new Set(["paragraph", "head", "smallHead", "bulletList", "orderedList", "pullQuote", "rule", "picture", "record", "listEntry"]),
  item: new Set(["paragraph", "bulletList", "orderedList"]),
  entry: new Set(["paragraph", "bulletList", "orderedList", "pullQuote"]),
  quote: new Set(["paragraph"]),
};

/**
 * Whether a part draws where it sits (format.ts's placement rules): pictures, record cards, heads and
 * breaks sit at the top level only; a list item holds text and lists; a pull quote holds plain paragraphs;
 * a numbered entry belongs at the top of a list piece and nowhere else.
 */
export function drawsIn(part: BlockPart | null, place: Place, kind: PostKind): boolean {
  if (!part || !ALLOWED[place].has(part)) return false;
  return part !== "listEntry" || kind === "list";
}

/** A node's children as an array (a malformed one has none). */
export function childrenOf(node: Loose): unknown[] {
  return isObj(node) && Array.isArray(node.content) ? node.content : [];
}

/** A record card's or list entry's record, when it names one properly. */
export function refOf(node: Loose): RecordRef | null {
  if (!isObj(node) || !isObj(node.attrs)) return null;
  const r = node.attrs.ref;
  if (!isObj(r)) return null;
  if (r.type === "album" && Number.isInteger(r.albumId) && (r.albumId as number) > 0) return { type: "album", albumId: r.albumId as number };
  if (r.type === "artist" && Number.isInteger(r.artistId) && (r.artistId as number) > 0) return { type: "artist", artistId: r.artistId as number };
  return null;
}

/** A picture's facts, when it has its upload and its credit (format.ts refuses one without). */
export function pictureOf(node: Loose): { src: string; alt: string; credit: string; caption: string | null; width: number | null; height: number | null } | null {
  const a = isObj(node) && isObj(node.attrs) ? node.attrs : null;
  return pictureFacts(a);
}

export function pictureFacts(a: Record<string, unknown> | null | undefined) {
  if (!a || typeof a.src !== "string" || !a.src.trim() || typeof a.credit !== "string" || !a.credit.trim()) return null;
  const size = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null);
  return {
    src: a.src.trim(),
    alt: typeof a.alt === "string" ? a.alt : "",
    credit: a.credit.trim(),
    caption: typeof a.caption === "string" && a.caption.trim() ? a.caption.trim() : null,
    width: size(a.width),
    height: size(a.height),
  };
}

/** Where an ordered list starts: its own start when it is a whole number of 1 or more, else 1. */
export function orderedStart(node: Loose): number {
  const s = isObj(node) && isObj(node.attrs) ? node.attrs.start : undefined;
  return typeof s === "number" && Number.isInteger(s) && s >= 1 ? s : 1;
}

/* ── how a picture or a record card sits (the writer's choice) ── */

/** A picture's size in the text: its own when it is one we draw, else as wide as the text. Never nothing. */
export function pictureSize(node: Loose): PictureSize {
  const v = isObj(node) && isObj(node.attrs) ? node.attrs.size : undefined;
  return (PICTURE_SIZES as readonly unknown[]).includes(v) ? (v as PictureSize) : "column";
}

/** A record card's shape: its own when it is one we draw, else the cover beside the words. Never nothing. */
export function recordShape(node: Loose): RecordShape {
  const v = isObj(node) && isObj(node.attrs) ? node.attrs.shape : undefined;
  return (RECORD_SHAPES as readonly unknown[]).includes(v) ? (v as RecordShape) : "card";
}

/** Text a picture beside it can run round: paragraphs and lists. Everything else starts below it. */
const wraps = (node: unknown): boolean => {
  const part = blockPart(node as Loose);
  return part === "paragraph" || part === "bulletList" || part === "orderedList";
};

/**
 * The order the body's top-level nodes draw in, and the pictures drawn as wide as the text after all.
 * A picture set beside the text needs words after it to run round it. When none follow (it ends the piece,
 * or the next thing is another picture, a card or a head), it moves up to sit beside the paragraph before
 * it instead; with no paragraph before it either, it is drawn as wide as the text. Nothing else moves.
 */
export function bodyOrder(content: unknown): { order: number[]; asColumn: Set<number> } {
  const nodes = Array.isArray(content) ? content : [];
  const order = nodes.map((_, i) => i);
  const asColumn = new Set<number>();
  nodes.forEach((node, i) => {
    if (blockPart(node as Loose) !== "picture" || pictureSize(node as Loose) !== "beside") return;
    if (i + 1 < nodes.length && wraps(nodes[i + 1])) return;
    const at = order.indexOf(i);
    const before = at > 0 ? order[at - 1] : -1;
    if (before >= 0 && blockPart(nodes[before] as Loose) === "paragraph") {
      order.splice(at, 1);
      order.splice(at - 1, 0, i);
    } else asColumn.add(i);
  });
  return { order, asColumn };
}

/* ── inline text ── */

/** One run of text with its marks, or a line break. */
export type Run = { text: string; bold: boolean; italic: boolean; href: string | null } | { br: true };

/**
 * A paragraph's or head's inline content as runs. Text keeps its words whatever happens; a mark format.ts
 * does not name is ignored, and a link whose address is not allowed loses its link (not its words).
 * Anything that is neither text nor a line break draws nothing.
 */
export function inlineRuns(nodes: unknown): Run[] {
  if (!Array.isArray(nodes)) return [];
  const out: Run[] = [];
  for (const n of nodes) {
    if (!isObj(n)) continue;
    if (n.type === "hardBreak") {
      out.push({ br: true });
      continue;
    }
    if (n.type !== "text" || typeof n.text !== "string" || n.text.length === 0) continue;
    let bold = false;
    let italic = false;
    let href: string | null = null;
    for (const m of Array.isArray(n.marks) ? n.marks : []) {
      if (!isObj(m)) continue;
      if (m.type === "bold") bold = true;
      else if (m.type === "italic") italic = true;
      else if (m.type === "link") {
        const h = isObj(m.attrs) && typeof m.attrs.href === "string" ? m.attrs.href.trim() : "";
        if (h && isAllowedHref(h)) href = h;
      }
    }
    out.push({ text: n.text, bold, italic, href });
  }
  return out;
}

/** The plain words of some inline content (a dek, a description for search). */
export function plainText(nodes: unknown): string {
  return inlineRuns(nodes)
    .map((r) => ("br" in r ? " " : r.text))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** A link leaves Cassette when it is not one of our own paths. */
export const isOutside = (href: string): boolean => !(href.startsWith("/") && !href.startsWith("//"));

/* ── list entries ── */

/** Each top-level list entry's number, by its index in the body: 1, 2, 3 in order, as deriveAttachments stores them. */
export function entryNumbers(content: unknown): Map<number, number> {
  const out = new Map<number, number>();
  if (!Array.isArray(content)) return out;
  let n = 0;
  content.forEach((node, i) => {
    if (isObj(node) && node.type === "listEntry") {
      n += 1;
      if (refOf(node)) out.set(i, n);
    }
  });
  return out;
}

/* ── stars ── */

export type Stars = { full: number; half: boolean; empty: number; stars: number; label: string };

/** A review's stars from its stored score (1 = half a star, 10 = five); null for a score format.ts refuses. */
export function starsOf(score: unknown): Stars | null {
  if (typeof score !== "number" || !Number.isInteger(score) || score < SCORE_MIN || score > SCORE_MAX) return null;
  const stars = scoreToStars(score);
  const full = Math.floor(stars);
  const half = stars - full >= 0.5;
  const empty = 5 - full - (half ? 1 : 0);
  const word = stars === 1 ? "star" : "stars";
  return { full, half, empty, stars, label: `${stars} ${word} out of 5` };
}

/** A piece's stars: only a review has them. */
export function pieceStars(post: Pick<Post, "kind" | "score">): Stars | null {
  return post.kind === "review" ? starsOf(post.score) : null;
}

/* ── records ── */

/** Every record the piece draws or is about, once each, in the order first met (about first). */
export function refsOf(post: Pick<Post, "about" | "body">): RecordRef[] {
  const seen = new Map<string, RecordRef>();
  const add = (r: RecordRef | null) => {
    if (r && !seen.has(refKey(r))) seen.set(refKey(r), r);
  };
  for (const r of Array.isArray(post.about) ? post.about : []) add(refOf({ attrs: { ref: r } }));
  const walk = (nodes: unknown[]) => {
    for (const n of nodes) {
      const part = blockPart(n as Loose);
      if (part === "record" || part === "listEntry") add(refOf(n as Loose));
      walk(childrenOf(n as Loose));
    }
  };
  walk(childrenOf(post.body as Loose));
  return [...seen.values()];
}

/**
 * The record that stands for a piece where a shelf shows it by a picture: the first album it is about,
 * else its first list entry, else its first record card, else the first artist it is about.
 */
export function leadRecord(post: Pick<Post, "about" | "body">): RecordRef | null {
  const about = (Array.isArray(post.about) ? post.about : []).map((r) => refOf({ attrs: { ref: r } })).filter((r): r is RecordRef => !!r);
  const album = about.find((r) => r.type === "album");
  if (album) return album;
  const content = childrenOf(post.body as Loose);
  for (const part of ["listEntry", "record"] as const) {
    const hit = content.find((n) => blockPart(n as Loose) === part);
    if (hit) return refOf(hit as Loose);
  }
  return about[0] ?? null;
}

/** The record a review is about (its one album), for its stars and its structured data. */
export function reviewed(post: Pick<Post, "kind" | "about">): RecordRef | null {
  if (post.kind !== "review" || !Array.isArray(post.about)) return null;
  const albums = post.about.filter((r) => r?.type === "album");
  return albums.length === 1 ? albums[0] : null;
}

/* ── words for a piece's kind ── */

export const KIND_WORD: Record<PostKind, string> = { review: "Review", essay: "Essay", list: "List", interview: "Interview" };

export const isKind = (k: unknown): k is PostKind => typeof k === "string" && (POST_KINDS as readonly string[]).includes(k);
