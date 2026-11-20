/**
 * The press, read once for both pages: which album_press entries may show on a record, in what order,
 * with which grade, and the ONE review count. Pure: the rows come from data.ts.
 *
 * buildPress applies, in order: P1 aggregators, P2 non-publications (forums, blogs, and since 2026-11-04 shops,
 * labels and shop pages, BUG-822), P3 unnamed outlets (with fan archives read back to the paper that ran the
 * piece, and garbled stored names repaired), P4 another release's card (P4a to P4c, plus P4d: a reissue or
 * box-set review on a studio record), P5 the quote gate, P6 borrowed grades, P7 nothing left, P8 one entry per
 * outlet, P9 the top set, P10 the lead. A refused entry is never shown or counted. Quotes and headlines are
 * repaired at read time for UTF-8 read as Latin-1 and a title's lost opening mark (BUG-814).
 *
 * Fields read from album_press.cards[] and .reveal[]: quote, slot, stance, speaker, rowLabel, headline,
 * headlineSource, treatment, accent, pieceType, clarity, clarityContested, and source.{name, url, host,
 * date, grade, gradeSource, kind, member}. Declared in data-floors.ts (album_press notes) and the
 * scripts/hobby-press.ts header.
 */

import { curl, fixMojibake, restoreTitleMarks, tidyQuote } from "./format";
import { scoreGlyph, scorePct } from "./grades";
import {
  homeOf,
  hostOf,
  iconFor,
  isAggregator,
  isCarrierHost,
  isMemberSource,
  isKnownOutlet,
  isNonPublicationHost,
  isShopPage,
  outletKey,
  outletName,
  outletRank,
  registrable,
  reprintOf,
  type OutletNames,
} from "./outlets";
import { normTitle, urlNamesRecord, urlPathWords } from "./records";
import type { PressEntry, PressRowData, PressSet, RecordFacts, RecordKind, StripItem } from "./types";

/** The album page's empty state, as The Feature renders it (Spine.tsx:211). */
export const STILL_WRITING = "We’re still writing this one up.";

/** Whether the research found nothing to document for this record (BUG-62): its last enrichment run was
 *  skipped as album_not_documented. No write-up is coming, so the page must not promise one. A rerun of the
 *  skipped records (--retry-skipped) replaces the mark when it does find something. */
export function isUndocumented(ai: { status?: unknown; reason?: unknown } | null | undefined): boolean {
  return !!ai && ai.status === "skipped" && ai.reason === "album_not_documented";
}

/** The line under "Press." when there is no press: "still writing" for a record not yet written up, nothing
 *  at all (null: no section) for one the research found nothing on. */
export function pressEmptyLine(undocumented: boolean): string | null {
  return undocumented ? null : STILL_WRITING;
}

type Raw = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const srcOf = (c: Raw): Raw => (c && typeof c.source === "object" && c.source ? (c.source as Raw) : {});

const MAX_TOP = 6;
const CLARITY = new Set(["anywhere", "artist", "album"]);
/** P4a: a qualifier after the record's own title means another version of it. */
const QUALIFIERS = ["live", "demo", "demos", "remix", "remixes", "remixed", "instrumental", "instrumentals", "acoustic", "sessions", "unplugged"];
/** P4d: words that mark a reissue or box-set review on a studio record. */
const REISSUE = /\s(oknotok|mnesia|amnesiae|reissue|reissued|box set|boxset)\s/;
/**
 * Single pieces refused by hand, each one for the bug register (the editor should never have kept it):
 * a review of a reissue whose address and words never say so.
 *   - Drowned in Sound, OK Computer, 10/10 dated 2017-06-23 (the OKNOTOK release day).
 *   - Forced Exposure, Byron Coley on the live set Sun Ra in Nickelsdorf, carded on Nuclear War (BUG-824;
 *     found in the live check of wave 1, 2026-11-04).
 */
const DENIED_URLS = new Set([
  "drownedinsound.com/releases/19981/reviews/4151129",
  "forcedexposure.com/features/byron-coley-sun-ra-in-nickelsdorf/reviewsunranickelsdorf.html",
]);

const bareUrl = (u: string | null): string =>
  (u ?? "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");

const isDeniedPiece = (url: string | null | undefined): boolean => !!url && DENIED_URLS.has(bareUrl(url));

/**
 * The outlet a stored card is credited to on the album page, or null when the page refuses its source: P1 to P3
 * below (aggregators; shops, labels, forums and blogs on the product's own blocklist; pieces refused by hand; a
 * fan archive's reprint read back to its paper; a name that is only the address). For the surfaces that quote
 * album_press without building the whole set: the discover hero (lib/discovery/review-line-pick.ts) and the
 * homepage's press room (proto/home-taste/press-data.ts), so a quote is never credited one way there and
 * another, or refused, on the record's own page (BUG-814, BUG-822).
 */
export function creditFor(source: { name?: unknown; url?: unknown; host?: unknown }, names: OutletNames = {}): string | null {
  const url = str(source.url) || null;
  const host = (str(source.host) || hostOf(url) || "").toLowerCase() || null;
  const name = str(source.name).trim();
  // an archive's copy read back to its paper is credited to the paper, though the archive itself is not press
  const reprint = reprintOf(url, names, name);
  if (isAggregator(name, host) || (isNonPublicationHost(host, names) && !reprint?.outlet) || isShopPage(url) || isDeniedPiece(url)) return null;
  return reprint ? reprint.outlet : outletName(name, host ?? "", names, url);
}

/** "Review · 1997" to "1997"; a bare "Review" or "Interview" to null; "Looking back · 2012" and "Reader review" as they are. */
export function rowMeta(rowLabel: string): string | null {
  const t = rowLabel.trim();
  if (!t) return null;
  const m = /^(review|interview)\s*(?:·\s*(.*))?$/i.exec(t);
  if (m) return m[2]?.trim() || null;
  return t;
}

/** Every host whose icon the page may need: each row's hosts, each entry's own, and each outlet's home. */
export function pressHosts(rows: PressRowData[], names: OutletNames = {}): string[] {
  const out = new Set<string>();
  const add = (h: string | null | undefined) => {
    const v = (h ?? "").trim().toLowerCase();
    if (!v) return;
    out.add(v);
    const r = registrable(v);
    if (r) out.add(r);
  };
  for (const row of rows) {
    for (const h of row.hosts ?? []) add(h);
    for (const c of [...(row.cards ?? []), ...(row.reveal ?? [])] as Raw[]) {
      const s = srcOf(c);
      const host = str(s.host) || hostOf(str(s.url) || null);
      add(host);
      const reprint = reprintOf(str(s.url) || null, names, str(s.name));
      const name = reprint?.outlet ?? outletName(str(s.name), host ?? "") ?? "";
      if (name) add(homeOf(name));
    }
  }
  return [...out].sort();
}

/** P4: is this entry about another release? Returns the rule that caught it, or null. */
function anotherRelease(hay: string, facts: RecordFacts): string | null {
  const own = normTitle(facts.title);
  if (!own) return null;
  const notLive = facts.kind !== "live";
  const ownHasQualifier = QUALIFIERS.some((q) => ` ${own} `.includes(` ${q} `));
  if (notLive && !ownHasQualifier && QUALIFIERS.some((q) => hay.includes(` ${own} ${q} `))) return "P4a";
  if (notLive && / live (album|record|recordings?|set) /.test(hay)) return "P4b";
  for (const s of facts.siblings) {
    const n = normTitle(s);
    if (n.startsWith(`${own} `) && hay.includes(` ${n} `)) return "P4c";
  }
  if (facts.kind === "studio") {
    if (REISSUE.test(hay)) return "P4d";
    for (const s of facts.editions ?? []) {
      const n = normTitle(s);
      if (n.startsWith(`${own} `) && hay.includes(` ${n} `)) return "P4d";
    }
  }
  return null;
}

/**
 * The headline a stored card may print: the outlet's printed title, or the writer's own words taken from the article and
 * checked word for word (headlineVerbatim, scripts/lib/press-headline.ts). An article headline built before that
 * check may be the editor's rewording, so it doesn't print until it's been checked (the founder, 2026-11-10: people
 * do the talking).
 */
function printedHeadline(c: Raw): { source: "title" | "article" | null; raw: string } {
  const source = c.headlineSource === "title" ? "title" : c.headlineSource === "article" && c.headlineVerbatim === true ? "article" : null;
  return { source, raw: source ? str(c.headline).trim() : "" };
}

/** What P4 reads of a card: its quote, its printed headline and the words in its address, as one normalised string. */
function hayOf(c: Raw, url: string | null): string {
  return ` ${normTitle([str(c.quote), printedHeadline(c).raw].join(" "))} ${urlPathWords(url)} `.replace(/\s+/g, " ");
}

/**
 * P4 for one stored card: the rule that says it is about another release of the artist (a reissue, a live album, a
 * deluxe edition, a longer sibling title), or null. The album page asks it in buildPress, and the discover hero and the
 * homepage's press room ask it here too, so none of the three quotes a card the record's own page refuses (BUG-831).
 */
export function anotherReleaseRule(card: unknown, facts: RecordFacts): string | null {
  if (!card || typeof card !== "object") return null;
  const c = card as Raw;
  return anotherRelease(hayOf(c, str(srcOf(c).url) || null), facts);
}

/**
 * The outlet a whole stored card is credited to on the record's own page, or null when the page refuses it: the source
 * rules of creditFor, then P4 when the record's facts are known. The one reading the discover hero and the homepage's
 * press room use for a press card (BUG-814, BUG-822, BUG-831). Without facts only the source is judged.
 */
export function creditedCard(card: unknown, facts: RecordFacts | null | undefined, names: OutletNames = {}): string | null {
  if (!card || typeof card !== "object") return null;
  const outlet = creditFor(srcOf(card as Raw), names);
  if (!outlet) return null;
  return facts && anotherReleaseRule(card, facts) ? null : outlet;
}

/**
 * The record's press set. `row` null (no press, or below the editor floor) gives an empty set.
 * `icons` maps host to the address of its icon (readIcons over pressHosts).
 */
export function buildPress(row: PressRowData | null, facts: RecordFacts, icons: Record<string, string>, names: OutletNames = {}): PressSet {
  const refused: PressSet["refused"] = [];
  if (!row) return finish([], [], refused);
  const raw: Array<{ c: Raw; tier: "card" | "reveal" }> = [
    ...((Array.isArray(row.cards) ? row.cards : []) as Raw[]).map((c) => ({ c, tier: "card" as const })),
    ...((Array.isArray(row.reveal) ? row.reveal : []) as Raw[]).map((c) => ({ c, tier: "reveal" as const })),
  ];

  type Draft = PressEntry & { gradeIn: string | null };
  const drafts: Draft[] = [];
  // the titles a quote may name in marks: the record's own and the artist's other releases (BUG-814)
  const titles = [facts.title, ...facts.siblings, ...(facts.editions ?? [])];
  const clean = (t: string) => restoreTitleMarks(curl(tidyQuote(fixMojibake(t))), titles);
  let anotherReleaseFound = false;

  raw.forEach(({ c, tier }, order) => {
    if (!c || typeof c !== "object") return;
    const s = srcOf(c);
    const url = str(s.url) || null;
    const host = (str(s.host) || hostOf(url) || "").toLowerCase() || null;
    const name = str(s.name).trim();
    const refuse = (rule: string, outlet = name) => refused.push({ order, outlet, url, rule });

    // P3, with an archive's reprint read back to the paper it ran in: a library archive is not press, but the paper
    // it holds a page of is
    const reprint = reprintOf(url, names, name);
    if (isAggregator(name, host)) return refuse("P1");
    if ((isNonPublicationHost(host, names) && !reprint?.outlet) || isShopPage(url)) return refuse("P2");
    if (isDeniedPiece(url)) return refuse("denied");
    if (reprint && !reprint.outlet) return refuse("P3-carrier");
    const outlet = reprint?.outlet ?? outletName(name, host ?? "", names, url);
    if (!outlet) return refuse("P3");

    // P4: another release's card
    const { source: headlineSource, raw: headlineRaw } = printedHeadline(c);
    const other = anotherRelease(hayOf(c, url), facts);
    if (other) {
      if (other !== "P4d") anotherReleaseFound = true;
      return refuse(other, outlet);
    }

    // P5: the quote gate
    const quoteRaw = str(c.quote).trim();
    const clarity = CLARITY.has(str(c.clarity)) ? (str(c.clarity) as PressEntry["clarity"]) : null;
    const quoteOk = quoteRaw.length >= 30 && quoteRaw.length <= 320 && clarity != null && c.clarityContested !== true;

    const kind = str(s.kind) || "review";
    const treatment = str(c.treatment);
    const slot = str(c.slot);
    const voice = slot === "VOICE" || treatment === "voice" || treatment === "voiceQuoteOnly";
    const rowLabel = str(c.rowLabel);
    const year =
      /^(\d{4})/.exec(str(s.date))?.[1] ?? reprint?.year ?? /\b(1[89]\d\d|20\d\d)\b/.exec(rowLabel)?.[1] ?? null;
    const gradeIn = str(s.grade).trim() || null;
    const carrier = host && (reprint || isCarrierHost(registrable(host))) ? registrable(host) : null;
    // A reader-review site marked after its cards were stored (READER_REVIEW_HOSTS) reads "Reader review" as a new
    // build would label it, not the label stored before (a Sputnikmusic card still read "Looking back · 2016").
    const member = isMemberSource(s, names);
    const label = member && !voice && !/^reader review/i.test(rowLabel) ? `Reader review${year ? ` · ${year}` : ""}` : rowLabel;

    drafts.push({
      order,
      tier,
      quote: quoteOk ? clean(quoteRaw) : null,
      headline: headlineRaw && !voice ? clean(headlineRaw.replace(/[.:!]+$/, "")) : null,
      headlineSource: headlineRaw && !voice ? headlineSource : null,
      treatment,
      accent: str(c.accent).trim() || null,
      voice,
      speaker: str(c.speaker).trim() || null,
      slot,
      stance: str(c.stance) || "none",
      rowLabel: label,
      meta: rowMeta(label),
      pieceType: str(c.pieceType),
      clarity,
      outlet,
      outletKey: outletKey(outlet),
      known: isKnownOutlet(outlet, reprint ? null : host, names),
      url,
      host,
      carrier,
      icon: iconFor(reprint ? null : host, outlet, icons),
      year,
      grade: gradeIn,
      glyph: null,
      pct: null,
      kind,
      member,
      gradeIn,
    });
  });

  // P6: borrowed grades, now that we know whether another release's cards were in the mix
  for (const d of drafts) {
    const trusted =
      !!d.gradeIn &&
      (facts.kind === "studio" || urlNamesRecord(d.url, facts.title)) &&
      !(anotherReleaseFound && !d.url);
    d.grade = trusted ? d.gradeIn : null;
    d.glyph = trusted && d.kind === "review" ? scoreGlyph(d.gradeIn) : null;
    d.pct = d.glyph ? scorePct(d.gradeIn) : null;
    if (!d.glyph) {
      d.grade = null;
      d.pct = null;
    }
  }

  // P7: nothing left to show
  const kept = drafts.filter((d) => {
    if (d.quote || d.glyph) return true;
    refused.push({ order: d.order, outlet: d.outlet, url: d.url, rule: "P7" });
    return false;
  });

  // P8: one entry per outlet; the first wins and may take a later row's grade for the same piece
  const firstByKey = new Map<string, Draft>();
  const unique: Draft[] = [];
  for (const d of kept) {
    const first = firstByKey.get(d.outletKey);
    if (!first) {
      firstByKey.set(d.outletKey, d);
      unique.push(d);
      continue;
    }
    const samePiece = !!first.url && !!d.url && bareUrl(first.url) === bareUrl(d.url);
    const unlinkedGrade = !d.url && !d.quote && (!d.year || !first.year || d.year === first.year);
    if (!first.glyph && d.glyph && (samePiece || unlinkedGrade)) {
      first.grade = d.grade;
      first.glyph = d.glyph;
      first.pct = d.pct;
    }
    refused.push({ order: d.order, outlet: d.outlet, url: d.url, rule: "P8" });
  }

  const entries: PressEntry[] = unique.map(({ gradeIn: _g, ...e }) => e);

  // P9: the top set
  const quoted = entries.filter((e) => e.quote);
  let top = quoted.filter((e) => e.tier === "card");
  if (top.length < 3) top = [...top, ...quoted.filter((e) => e.tier === "reveal").slice(0, 3 - top.length)];
  top = top.slice(0, MAX_TOP);

  // P10: the lead (leadFirst, scripts/lib/press-clarity-judge.ts:333-340, widened)
  const shaky = (e: PressEntry) =>
    e.member || e.slot === "DISSENT" || e.stance === "cool" || e.stance === "pan" || e.voice || !e.known;
  if (top.length > 1 && shaky(top[0])) {
    const i = top.findIndex((e, j) => j > 0 && !shaky(e) && e.kind === "review" && (e.stance === "rave" || e.stance === "warm"));
    if (i > 0) top = [top[i], ...top.slice(0, i), ...top.slice(i + 1)];
  }

  const inTop = new Set(top.map((e) => e.order));
  const more = entries.filter((e) => !inTop.has(e.order));
  return finish(top, more, refused);
}

function finish(top: PressEntry[], more: PressEntry[], refused: PressSet["refused"]): PressSet {
  const all = [...top, ...more];
  return {
    top,
    more,
    total: all.length,
    noun: all.every((e) => e.kind === "review") ? "review" : "piece",
    moreQuoted: more.filter((e) => e.quote),
    moreGraded: more.filter((e) => !e.quote),
    refused: refused.sort((a, b) => a.order - b.order),
  };
}

/** P11: the ONE review count. Both pages print this number and nothing else. */
export const countReviews = (set: PressSet): number => set.total;

/**
 * P11's button text. Artist page (`more` false): "Read the review", "Read all 21 reviews". Album page
 * (`more` true): "Read 1 more review", "Read all 15 more reviews".
 */
export function readAllLabel(n: number, noun: "review" | "piece", more: boolean): string {
  if (more) return n === 1 ? `Read 1 more ${noun}` : `Read all ${n} more ${noun}s`;
  return n === 1 ? `Read the ${noun}` : `Read all ${n} ${noun}s`;
}

/** A line that ends like a sentence: a full stop, a question or an exclamation, a closing quote allowed after. */
const ENDS_LIKE_A_SENTENCE = /[.!?]["'”’)\]]*$/;

/**
 * P12: the artist page's one line for a record. The first card (stored order) whose quote is a whole
 * sentence of 60 to 240 characters, reads on the artist page (clarity anywhere or artist), is a
 * critic's (not a voice, a reader or a dissent) and comes from an outlet we know. Null when none.
 */
export function recordLine(set: PressSet): PressEntry | null {
  const pool = [...set.top, ...set.more].sort((a, b) => a.order - b.order);
  return (
    pool.find(
      (e) =>
        e.tier === "card" &&
        !!e.quote &&
        e.quote.length >= 60 &&
        e.quote.length <= 240 &&
        ENDS_LIKE_A_SENTENCE.test(e.quote) &&
        (e.clarity === "anywhere" || e.clarity === "artist") &&
        !e.voice &&
        !e.member &&
        e.slot !== "DISSENT" &&
        e.known,
    ) ?? null
  );
}

/**
 * P13: the critics strip beside the cover. Studio albums only; shown when 2 or more graded reviews
 * average 80% or better. Graded entries on the page's cards come first, then those behind Read all,
 * each group in outlet order; at most 3. `inMore` marks one whose card is behind Read all.
 */
export function criticsStrip(set: PressSet, kind: RecordKind): StripItem[] {
  if (kind !== "studio") return [];
  const graded = (list: PressEntry[]) => list.filter((e) => e.kind === "review" && e.glyph && e.pct != null);
  const pool = [...graded(set.top), ...graded(set.more)];
  if (pool.length < 2) return [];
  const mean = pool.reduce((s, e) => s + (e.pct ?? 0), 0) / pool.length;
  if (mean < 80) return [];
  const byRank = (a: PressEntry, b: PressEntry) => outletRank(a.outlet) - outletRank(b.outlet) || (b.pct ?? 0) - (a.pct ?? 0);
  const ordered = [...graded(set.top).sort(byRank), ...graded(set.more).sort(byRank)];
  const inTop = new Set(set.top.map((e) => e.order));
  return ordered.slice(0, 3).map((e) => ({ outlet: e.outlet, glyph: e.glyph as string, icon: e.icon, url: e.url, inMore: !inTop.has(e.order) }));
}
