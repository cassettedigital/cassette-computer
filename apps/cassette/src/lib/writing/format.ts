/**
 * The shape of a written piece on Cassette: the ONE contract the editor, the reading pages and the
 * storage all agree on. Design: docs/reference/CASSETTE_WRITING.md. Build plan: docs/CASSETTE_WRITING_PLAN.md.
 *
 * A piece is a small set of facts about it (kind, title, what it is about, a score for a review) plus a
 * body. The body is a document tree whose JSON matches TipTap's own (`{ type: "doc", content: [...] }`,
 * marks as `{ type: "bold" }`, attrs under `attrs`), so the editor saves and loads it as is. The reading
 * pages never run TipTap: they walk this tree and draw kit parts, so a public page stays light.
 *
 * Only the nodes and marks listed here exist. Anything else (a pasted font, a colour, a table, raw HTML)
 * is not part of a piece, and `validatePost` refuses it. Blank lines are not kept: the editor drops empty
 * top-level paragraphs when it saves (an empty paragraph is still valid, so a half-typed draft saves). Sizes are the three the guide kit allows: the
 * title (drawn by the page), a head (level 2) and a small head (level 3). There is no free font size.
 *
 * Records are referenced by catalog id and drawn LIVE from the catalog, so a card never goes stale and
 * never carries a copied title or cover. What a record is doing in the piece is its role:
 *   - about:      the piece is about it (picked in the piece's facts, never inferred from the body).
 *                 Only these put the piece on that album or artist page.
 *   - list_entry: a numbered entry with a note, in a list piece. The album page can say "#3 on ...".
 *   - mention:    a card in passing. Clickable in the piece; it touches no album page.
 *
 * Scores: a review is the only kind with a score, and a review always has one. Five stars with halves,
 * stored as a whole number 1..10 (1 = half a star, 10 = five stars) so the display can change later.
 *
 * Pure: no database, no React, so the editor, the pages, scripts and tests can all import it.
 */

export const POST_FORMAT_VERSION = 1;

// ---------------------------------------------------------------------------------------------------
// The facts about a piece

export const POST_KINDS = ["review", "essay", "list", "interview"] as const;
export type PostKind = (typeof POST_KINDS)[number];

/** A catalog record or artist, by id. Drawn live; the id is the only thing stored. */
export type RecordRef = { type: "album"; albumId: number } | { type: "artist"; artistId: number };

export type RecordRole = "about" | "list_entry" | "mention";

/** Score bounds: 1 = half a star, 10 = five stars. */
export const SCORE_MIN = 1;
export const SCORE_MAX = 10;

/** A picture a writer uploaded. `src` is the stored address in our uploads bucket; pages show it through
 * imageRef() (docs/reference/CASSETTE_IMAGES.md), never as is. Every picture carries a credit line. */
export interface PictureAttrs {
  src: string;
  alt: string;
  credit: string;
  caption?: string;
  /** The original's size in pixels. Templates lay a picture out by its shape (wide or upright) and a page
   * holds its space before it loads, so validatePost requires both; the editor reads them at upload. Types
   * keep them optional so a reader never breaks on an old value. */
  width?: number;
  height?: number;
}

/** What stands for a piece on a shelf (the journal's front page, a writer's page): one of the records the
 * piece attaches, or a picture the writer chose. Absent: the lead picture, else the record it is about. */
export type Preview = { type: "record"; ref: RecordRef } | { type: "picture"; attrs: PictureAttrs };

export interface Post {
  kind: PostKind;
  title: string;
  /** One line under the title. */
  dek?: string;
  /** The lead picture, drawn above the body. */
  lead?: PictureAttrs | null;
  /** What the piece is about. A review: exactly one album. Others: any number of albums or artists. */
  about: RecordRef[];
  /** Reviews only, and required there: SCORE_MIN..SCORE_MAX. Null or absent on every other kind. */
  score?: number | null;
  /** How the piece is laid out, the writer's choice (founder, 2026-11-07). The list of templates lives with
   * the renderer (`src/app/_taste/writing/templates.ts`); a value it doesn't know draws in the kind's default
   * and is never refused, so adding or retiring a template never breaks a piece. */
  template?: string | null;
  /** What stands for the piece on a shelf, the writer's choice. */
  preview?: Preview | null;
  body: PostBody;
}

// ---------------------------------------------------------------------------------------------------
// The body: TipTap-shaped JSON, limited to these nodes

export type Mark = { type: "bold" } | { type: "italic" } | { type: "link"; attrs: { href: string } };

export interface TextNode {
  type: "text";
  text: string;
  marks?: Mark[];
}
export interface HardBreakNode {
  type: "hardBreak";
}
export type InlineNode = TextNode | HardBreakNode;

export interface ParagraphNode {
  type: "paragraph";
  content?: InlineNode[];
}
export interface HeadingNode {
  type: "heading";
  attrs: { level: 2 | 3 };
  content?: InlineNode[];
}
export interface ListItemNode {
  type: "listItem";
  content: Array<ParagraphNode | BulletListNode | OrderedListNode>;
}
export interface BulletListNode {
  type: "bulletList";
  content: ListItemNode[];
}
export interface OrderedListNode {
  type: "orderedList";
  attrs?: { start?: number };
  content: ListItemNode[];
}
/** A pull quote. */
export interface BlockquoteNode {
  type: "blockquote";
  content: ParagraphNode[];
}
export interface HorizontalRuleNode {
  type: "horizontalRule";
}
/** How wide a picture in the text sits (founder, 2026-11-07, from the editor's board): as wide as the text
 * (`column`, the default), stepping out past it on both sides (`wider`), or beside the text with the words
 * running round it (`beside`; on a phone it sits between paragraphs). */
export const PICTURE_SIZES = ["column", "wider", "beside"] as const;
export type PictureSize = (typeof PICTURE_SIZES)[number];

/** How a record card in the text looks (same board): the cover beside the words (`card`, the default), a
 * big cover with the words under it for the record a piece is built around (`big`), or a small slip for a
 * record named in passing (`slip`). The shape is only how it looks: its role still comes from `about`. */
export const RECORD_SHAPES = ["card", "big", "slip"] as const;
export type RecordShape = (typeof RECORD_SHAPES)[number];

export interface PictureNode {
  type: "picture";
  attrs: PictureAttrs & { size?: PictureSize };
}
/** A record card dropped into the text: a mention, unless the same record is also in `about`. */
export interface RecordNode {
  type: "record";
  attrs: { ref: RecordRef; shape?: RecordShape };
}
/** A numbered entry in a list piece: the record, then the writer's note about it. Numbered by order. */
export interface ListEntryNode {
  type: "listEntry";
  attrs: { ref: RecordRef };
  content?: Array<ParagraphNode | BulletListNode | OrderedListNode | BlockquoteNode>;
}

export type BlockNode =
  | ParagraphNode
  | HeadingNode
  | BulletListNode
  | OrderedListNode
  | BlockquoteNode
  | HorizontalRuleNode
  | PictureNode
  | RecordNode
  | ListEntryNode;

export interface PostBody {
  type: "doc";
  content: BlockNode[];
}

// ---------------------------------------------------------------------------------------------------
// Helpers

export function sameRef(a: RecordRef, b: RecordRef): boolean {
  return a.type === "album" && b.type === "album"
    ? a.albumId === b.albumId
    : a.type === "artist" && b.type === "artist"
      ? a.artistId === b.artistId
      : false;
}

export function refKey(ref: RecordRef): string {
  return ref.type === "album" ? `album:${ref.albumId}` : `artist:${ref.artistId}`;
}

/** Half-star display of a score: 7 -> 3.5. */
export function scoreToStars(score: number): number {
  return score / 2;
}

/** A link a writer may put in a piece: the web, email, or a Cassette path. Never a script address. */
export function isAllowedHref(href: string): boolean {
  if (href.startsWith("/") && !href.startsWith("//")) return true;
  try {
    const u = new URL(href);
    return u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:";
  } catch {
    return false;
  }
}

export interface Attachment {
  ref: RecordRef;
  role: RecordRole;
  /** For list entries: 1-based number in the list. */
  position?: number;
}

/**
 * Every record the piece attaches, once each, with its strongest role (about > list_entry > mention).
 * This is what storage indexes, so an album page can ask "which pieces are about me / list me".
 */
export function deriveAttachments(post: Post): Attachment[] {
  const out = new Map<string, Attachment>();
  for (const ref of post.about) out.set(refKey(ref), { ref, role: "about" });
  let position = 0;
  const walk = (nodes: ReadonlyArray<{ type: string; content?: unknown; attrs?: unknown }>) => {
    for (const node of nodes) {
      if (node.type === "listEntry") {
        position += 1;
        const ref = (node as ListEntryNode).attrs.ref;
        const k = refKey(ref);
        const had = out.get(k);
        if (!had || had.role === "mention") out.set(k, { ref, role: "list_entry", position });
      } else if (node.type === "record") {
        const ref = (node as RecordNode).attrs.ref;
        const k = refKey(ref);
        if (!out.has(k)) out.set(k, { ref, role: "mention" });
      }
      if (Array.isArray(node.content)) walk(node.content as never);
    }
  };
  walk(post.body.content);
  return [...out.values()];
}

// ---------------------------------------------------------------------------------------------------
// Validation: the same rules for the editor (to tell the writer), storage (to refuse) and pages (to trust)

export interface Problem {
  /** Where: "title", "score", "about", or "body" plus a path like "body.3.content.0". */
  at: string;
  message: string;
}

const BLOCKS = new Set(["paragraph", "heading", "bulletList", "orderedList", "blockquote", "horizontalRule", "picture", "record", "listEntry"]);
const INLINES = new Set(["text", "hardBreak"]);
const MARKS = new Set(["bold", "italic", "link"]);

function isRef(v: unknown): v is RecordRef {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  if (r.type === "album") return Number.isInteger(r.albumId) && (r.albumId as number) > 0;
  if (r.type === "artist") return Number.isInteger(r.artistId) && (r.artistId as number) > 0;
  return false;
}

function checkPicture(attrs: unknown, at: string, problems: Problem[]) {
  const a = (attrs ?? {}) as Partial<PictureAttrs>;
  if (typeof a.src !== "string" || !a.src.trim()) problems.push({ at, message: "A picture needs its upload." });
  if (typeof a.alt !== "string") problems.push({ at, message: "A picture needs a description for people who can't see it." });
  if (typeof a.credit !== "string" || !a.credit.trim()) problems.push({ at, message: "Every picture needs a credit line." });
  const size = (v: unknown) => Number.isInteger(v) && (v as number) > 0;
  if (!size(a.width) || !size(a.height)) problems.push({ at, message: "This picture is missing its size. Upload it again." });
}

function checkInline(nodes: unknown, at: string, problems: Problem[]) {
  if (nodes === undefined) return;
  if (!Array.isArray(nodes)) return void problems.push({ at, message: "Text in the wrong shape." });
  nodes.forEach((n, i) => {
    const here = `${at}.${i}`;
    if (!n || !INLINES.has(n.type)) return void problems.push({ at: here, message: `"${n?.type}" can't go in a piece.` });
    if (n.type === "text") {
      if (typeof n.text !== "string" || n.text.length === 0) problems.push({ at: here, message: "Empty text." });
      for (const m of n.marks ?? []) {
        if (!MARKS.has(m?.type)) problems.push({ at: here, message: `"${m?.type}" formatting can't go in a piece.` });
        if (m?.type === "link" && !isAllowedHref(String(m.attrs?.href ?? ""))) problems.push({ at: here, message: "That link address isn't allowed." });
      }
    }
  });
}

function checkBlocks(nodes: unknown, at: string, kind: PostKind, problems: Problem[], inside: string | null) {
  if (!Array.isArray(nodes)) return void problems.push({ at, message: "Body in the wrong shape." });
  nodes.forEach((n, i) => {
    const here = `${at}.${i}`;
    const t = n?.type;
    if (!BLOCKS.has(t) && t !== "listItem") return void problems.push({ at: here, message: `"${t}" can't go in a piece.` });
    switch (t) {
      case "paragraph":
        return checkInline(n.content, `${here}.content`, problems);
      case "heading":
        if (n.attrs?.level !== 2 && n.attrs?.level !== 3) problems.push({ at: here, message: "Heads come in two sizes only." });
        return checkInline(n.content, `${here}.content`, problems);
      case "bulletList":
      case "orderedList":
        if (!Array.isArray(n.content) || n.content.length === 0 || n.content.some((c: { type?: string }) => c?.type !== "listItem"))
          return void problems.push({ at: here, message: "A list holds at least one item, and list items only." });
        return checkBlocks(n.content, `${here}.content`, kind, problems, t);
      case "listItem":
        if (inside !== "bulletList" && inside !== "orderedList") problems.push({ at: here, message: "A list item outside a list." });
        if (!Array.isArray(n.content) || n.content[0]?.type !== "paragraph") problems.push({ at: here, message: "A list item starts with its words." });
        return checkBlocks(n.content ?? [], `${here}.content`, kind, problems, t);
      case "blockquote":
        if (!Array.isArray(n.content) || n.content.length === 0 || n.content.some((c: { type?: string }) => c?.type !== "paragraph"))
          return void problems.push({ at: here, message: "A pull quote holds at least one plain paragraph." });
        return checkBlocks(n.content, `${here}.content`, kind, problems, t);
      case "horizontalRule":
        return;
      case "picture":
        if (inside) problems.push({ at: here, message: "A picture sits on its own, not inside a list or quote." });
        if (n.attrs?.size !== undefined && !(PICTURE_SIZES as readonly unknown[]).includes(n.attrs.size))
          problems.push({ at: here, message: "Pictures sit as wide as the text, wider, or beside it." });
        return checkPicture(n.attrs, here, problems);
      case "record":
        if (inside) problems.push({ at: here, message: "A record card sits on its own, not inside a list or quote." });
        if (!isRef(n.attrs?.ref)) problems.push({ at: here, message: "A record card needs its record." });
        if (n.attrs?.shape !== undefined && !(RECORD_SHAPES as readonly unknown[]).includes(n.attrs.shape))
          problems.push({ at: here, message: "A record card is a card, a big cover, or a slip." });
        return;
      case "listEntry":
        if (kind !== "list") problems.push({ at: here, message: "Numbered record entries belong in a list piece." });
        if (inside) problems.push({ at: here, message: "A list entry sits at the top level." });
        if (!isRef(n.attrs?.ref)) problems.push({ at: here, message: "A list entry needs its record." });
        return checkBlocks(n.content ?? [], `${here}.content`, kind, problems, t);
    }
  });
}

/** Every problem with a piece, in plain words. An empty array means it can be saved and shown. */
export function validatePost(post: Post): Problem[] {
  const problems: Problem[] = [];
  if (!POST_KINDS.includes(post.kind)) problems.push({ at: "kind", message: "Pick what kind of piece this is." });
  if (typeof post.title !== "string" || !post.title.trim()) problems.push({ at: "title", message: "Give it a title." });
  if (!Array.isArray(post.about) || post.about.some((r) => !isRef(r))) problems.push({ at: "about", message: "Something it's about is missing its record." });
  const about = Array.isArray(post.about) ? post.about : [];

  if (post.kind === "review") {
    const albums = about.filter((r) => r.type === "album");
    if (albums.length !== 1 || about.length !== 1) problems.push({ at: "about", message: "A review is about exactly one record." });
    const s = post.score;
    if (typeof s !== "number" || !Number.isInteger(s) || s < SCORE_MIN || s > SCORE_MAX)
      problems.push({ at: "score", message: "A review needs a score, from half a star to five." });
  } else if (post.score !== undefined && post.score !== null) {
    problems.push({ at: "score", message: "Only a review has a score." });
  }

  if (post.lead) checkPicture(post.lead, "lead", problems);

  if (post.template !== undefined && post.template !== null && (typeof post.template !== "string" || !/^[a-z][a-z0-9-]{0,39}$/.test(post.template)))
    problems.push({ at: "template", message: "That template isn't one we have." });

  if (post.preview) {
    const pv = post.preview as Partial<Preview> & { ref?: unknown; attrs?: unknown };
    if (pv.type === "picture") checkPicture(pv.attrs, "preview", problems);
    else if (pv.type === "record" && isRef(pv.ref)) {
      if (post.body?.type === "doc" && !deriveAttachments(post).some((a) => sameRef(a.ref, pv.ref as RecordRef)))
        problems.push({ at: "preview", message: "The preview record has to be one this piece is about, lists or mentions." });
    } else problems.push({ at: "preview", message: "The preview needs a record or a picture." });
  }

  if (!post.body || post.body.type !== "doc") problems.push({ at: "body", message: "Body in the wrong shape." });
  else checkBlocks(post.body.content, "body", post.kind, problems, null);

  if (post.kind === "list" && post.body?.type === "doc" && !post.body.content.some((n) => n.type === "listEntry"))
    problems.push({ at: "body", message: "A list needs at least one record entry." });

  return problems;
}
