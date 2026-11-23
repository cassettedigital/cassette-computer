/**
 * Review line — the PURE half: which critic line becomes a record's one-sentence
 * overview (the /discover hero's hook, a station's "Top of the rotation"). No
 * database, no Next; unit-tested in review-line.test.ts. The server wrapper
 * (review-line.ts) fetches the rows.
 *
 * Two candidate pools, one scorer. Founder direction (2026-10-04): the hero
 * should reuse the press we already paid to edit rather than pick raw, and a
 * line should be weighted by what it would be good at — standing alone at the
 * top of a page as "a reason you might like this".
 *
 *   1. PRESS cards — the album's album_press row at the live editor floor
 *      (scripts/hobby-press.ts: verbatim-verified, same-record-checked,
 *      language-gated, with the writer's stance and the role of the pulled
 *      sentence). A review card with a positive stance is vetted material: it
 *      always outranks a raw line. Among cards the editor's own signals decide
 *      first (a quote-only or stroke treatment, the LEAD and VERDICT slots, a
 *      verdict-role sentence, the outlet's tier), then how the line reads alone.
 *      Interview and feature cards never lead: the hero credits an outlet, and a
 *      speaker's words under an outlet name read as the outlet's opinion. From
 *      press v19 every card carries the clarity judge's level (anywhere, artist,
 *      album): a line that stands anywhere is the better hero, and a card the
 *      judge's reads split on (contested) never leads at all.
 *   2. RAW rows — album_reviews (verified rows only, BUG-232), the broad free
 *      fallback wherever no press row exists. Where one does exist, the editor's
 *      answer stands even when it is "nothing positive": the raw rows are the same
 *      reviews, and the AI card beats a soft pan as the hero's line. Among raw
 *      lines the words decide, not the provenance: a line that names the record
 *      (the strongest mechanical sign of a verdict about THIS album), reads as a
 *      whole sentence and runs about one breath wins; a leading "But" or "And" is
 *      trimmed, since the sentence it answered was never shown; any other
 *      connective opener costs; the collector (exa → anydecentmusic → wikipedia →
 *      musicbrainz) only breaks ties. (Founder, 2026-10-04, on Da Real World: the
 *      first cut let an Exa line win on where it came from, and the result "isn't
 *      great".) A line carrying a plain negative verdict word never becomes the
 *      hero (BUG-401): the AI card is the better fallback than a pan under "Top
 *      of the rotation".
 *
 * Both pools: 30 to 240 chars, since a hero line is one breath; nearest ~110
 * wins among otherwise-equal lines. Dead-link rows still count (the attribution
 * stays, the link drops).
 *
 * A press card passes the album page's own publication rules first (P1 to P3 in
 * app/(taste)/_kit/press.ts: aggregators, shops and labels, forums, pieces refused
 * by hand), then its other-release check (P4: a card about a reissue, a live album or
 * a deluxe edition, when the record's facts are handed in), and is credited by the
 * page's outlet name, so the hero never quotes a line the page refuses or names its
 * outlet differently (BUG-814, BUG-822, BUG-831). A raw row is credited the same way,
 * through its own address, so a name that is only an address is never the credit.
 */

import { fixMojibake, joinDropCap, withoutHeading } from "@/app/(taste)/_kit/format";
import { hostOf, isMemberSource, type OutletNames } from "@/app/(taste)/_kit/outlets";
import { creditedCard, creditFor } from "@/app/(taste)/_kit/press";
import { stripWrappingMarks } from "@/lib/quote-marks";
import type { RecordFacts } from "@/app/(taste)/_kit/types";

export { stripWrappingMarks };

export type ReviewLine = {
  quote: string;
  publication: string;
  url: string | null;
  /** True when the line is a press-editor card (album_press at the live floor), not a raw row. */
  vetted?: boolean;
};

const MIN_LEN = 30;
const MAX_LEN = 240;
const SWEET_SPOT = 110;


/** Whitespace folded, the marks that wrap the whole line removed, the rest straightened. No sizing, no capitalising. */
function normalizeQuote(raw: string | null | undefined): string {
  if (!raw) return "";
  const q = stripWrappingMarks(fixMojibake(raw).replace(/\s+/g, " "))
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
  // a review page's drop cap split from its word ("T his unexpected tribute...", BUG-662), and a heading glued to
  // its front ("Review Summary: ...")
  return joinDropCap(withoutHeading(q));
}

export function cleanReviewQuote(raw: string | null | undefined): string | null {
  let q = normalizeQuote(raw);
  if (!q) return null;
  if (q.length < MIN_LEN || q.length > MAX_LEN) return null;
  // A hero line reads as a sentence: capitalise the first letter, end on a stop.
  q = q[0].toUpperCase() + q.slice(1);
  if (!/[.!?…]$/.test(q)) q += ".";
  return q;
}

/** The line opens on a word that points back at a sentence the reader never saw. */
const CONNECTIVE_OPENER =
  /^(?:But|And|Yet|So|Still|However|Nevertheless|Nonetheless|Then|Thus|Hence|Though|Although|Instead|Ultimately|Overall|Meanwhile|Elsewhere|Besides|Anyway|Indeed|Of course|In short|In the end|That said|Even so|Otherwise|Because|Since|As such|And so|Which)\b/;

/** A critic speaking as "I": fine on a card, weaker as the one line that stands for the record. */
const FIRST_PERSON_OPENER = /^(?:I|I'm|I've|I'd|I'll|We|We're|We've|We'd|My|Our)\b/;
/** A parenthetical (a catalogue number, a label, an aside) clutters a hero line. */
const PARENTHETICAL = /\([^)]{3,}\)/;
/** An editorial insertion ("[the band's] best record") reads as someone else's edit of the sentence. */
const BRACKETED = /\[[^\]]{2,}\]/;

/**
 * A leading coordinating conjunction answers a sentence the reader never saw. What follows it is
 * still the writer's own words, verbatim, so the hero drops the conjunction and re-capitalises
 * ("But rather than try to capitalize…" reads "Rather than try to capitalize…"). Only "But" and
 * "And": "Yet another great record" and "So much of this record" would lose their first word.
 */
const LEADING_CONJUNCTION = /^(?:But|And)\s+(?=\S)/;
function trimLeadingConjunction(q: string): string {
  const t = q.replace(LEADING_CONJUNCTION, "");
  if (t === q || t.length < MIN_LEN) return q;
  // What remains now opens the line: capitalise it here, not only at display time, so the
  // sentence-start signal sees the line a reader will see.
  return t[0].toUpperCase() + t.slice(1);
}

/** Title words too generic to trust as "names this record" on their own (mirrors album-page-data.ts). */
const GENERIC_TITLE_WORD = new Set([
  "the", "and", "that", "with", "this", "from", "into", "their", "have", "been", "were", "they", "them",
  "than", "then", "what", "when", "where", "which", "while", "will", "would", "could", "should", "about",
  "after", "before", "over", "under", "more", "most", "very", "just", "only", "also", "some", "such",
  "much", "many", "like", "even", "still", "here", "there", "these", "those", "your", "ours", "onto",
  "upon", "each", "every", "both", "same", "does", "done", "being", "through", "album", "record", "songs",
  "song", "music", "band",
]);
/**
 * The line names this record. The strongest mechanical sign that it is a verdict about THIS
 * album rather than an aside, so it carries real weight; a short or generic title ("Blue",
 * "Play") is not trusted, the same distinctiveness bar the album page's same-record guard uses.
 * Hyphens and spaces in the title are interchangeable ("Pin Ups" finds "Pin-Ups").
 */
function namesRecord(q: string, title: string | undefined): boolean {
  if (!title) return false;
  const words = title.trim().split(/[\s\-–]+/).filter(Boolean);
  if (words.length === 0) return false;
  const joined = words.join(" ");
  const distinctive = words.length >= 2 || (joined.length >= 6 && !GENERIC_TITLE_WORD.has(joined.toLowerCase()));
  if (!distinctive) return false;
  const pattern = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\-–]+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "iu").test(q);
}

/**
 * The words that say which way a verdict went. Mechanical on purpose (the press editor has a
 * model's stance for its cards; the raw rows have nothing), so both lists are built from words
 * that are rarely used the other way, and every hit is guarded against a negation just before it
 * ("hardly a dull moment", "not at all boring", "far from brilliant" all stay neutral).
 * Measured 2026-10-04 on the real pool (2,253 raw hero picks): the first dozen pan words caught
 * 30 pans, every sampled hit genuine; the rest were added from pans the replay still let lead
 * ("their weakest project", "Suffers from too much style", "misfires for the first time", "Her
 * blandest record yet"). Praise only reorders: it lifts a rave over a neutral line and can never
 * make a line say something it does not.
 */
const NEGATED = String.raw`(?<!\b(?:hardly|not|isn't|wasn't|aren't|weren't|doesn't|don't|didn't|can't|cannot|no|never|nothing|without|barely|neither|nor|scarcely|rarely|far from|anything but|less than|avoids?|avoiding|free of|devoid of)\s(?:(?:a|an|the|so|too|very|that|quite|entirely|exactly|necessarily|remotely|completely|especially|simply|all|at all|even|ever|being)\s)?)`;
const NEGATIVE_VERDICT = new RegExp(
  NEGATED +
    String.raw`\b(?:disappointing|unlistenable|tedious|forgettable|mediocre|misfire\w*|half-baked|lazy|dull|boring|weakest|uninspired|underwhelming|lacklustre|lackluster|plodding|bloated|unfortunately|sadly|regrettably|bland\w*|cloying|ersatz|nondescript|woeful\w*|insipid|turgid|listless|lifeless|dreary|dismal|limp|inert|clumsy|shapeless|tiresome|stale|soulless|charmless|witless|tuneless|interminable|overlong|pointless|embarrassing|banal\w*|trite|hackneyed|derivative|phoned-in|phoned in|by-the-numbers|by the numbers|paint-by-numbers|a (?:huge |major |big |real |crushing )?disappointment|a letdown|a chore|a bore|a dud|a flop|the worst|a mess|a slog|suffers from|falls flat|fails?\b|inoffensive)\b`,
);
/** Lower the first letter before probing, so a verdict that opens the sentence ("Suffers from…", "Unfortunately, …") still counts; a title mid-sentence ("Dull Lights") still does not. */
function hasNegativeVerdict(q: string): boolean {
  return NEGATIVE_VERDICT.test(q[0].toLowerCase() + q.slice(1));
}
const PRAISE = new RegExp(
  NEGATED +
    String.raw`\b(?:gorgeous\w*|beautiful\w*|best|finest|greatest|triumph\w*|brilliant\w*|superb\w*|remarkabl\w*|extraordinar\w*|stunning\w*|glorious\w*|perfect\w*|arresting|sublime\w*|marvel\w*|wonderful\w*|masterpiece|masterful\w*|masterclass|essential|thrilling\w*|exhilarating\w*|dazzling\w*|excellen\w*|terrific\w*|magnificent\w*|exquisite\w*|irresistibl\w*|flawless\w*|astonishing\w*|breathtaking\w*|joyous\w*|assured|compelling\w*|rewarding|ravishing\w*|luminous|transcendent|classic|exciting)\b`,
  "i",
);
function hasPraise(q: string): boolean {
  return PRAISE.test(q);
}

/** Starts like a sentence (a capital, a digit, or an opening mark) and ends on a stop. */
function startsLikeSentence(q: string): boolean {
  return /^[A-Z0-9"']/.test(q);
}
function endsOnStop(q: string): boolean {
  return /[.!?…"']$/.test(q);
}
/**
 * Distance from one breath. Gentle inside 60 to 150 chars (the band a hero reads well in), then
 * steep: a 190-char line is five lines of display type, a 30-char one is a caption. Verified on
 * the real pool 2026-10-04: with a flat penalty a 190-char line that named the record outscored a
 * clean 105-char sentence that did not (Car Seat Headrest).
 */
function lengthPenalty(q: string): number {
  const n = q.length;
  if (n > 150) return 4 + (n - 150) / 4;
  if (n < 60) return 5 + (60 - n) / 8; // gentler: a short complete sentence is a classic pull quote, not a defect
  return Math.abs(n - SWEET_SPOT) / 10;
}

export type ReviewRow = {
  albumId: number;
  publication: string | null;
  displayQuote: string | null;
  excerpt: string | null;
  source: string | null;
  reviewUrl: string | null;
  reviewUrlDead: boolean | null;
};

/** One press card as album_press.cards / album_press.reveal store it (the fields the hero needs). */
export type PressCardRow = {
  quote: string;
  /** The clarity judge's level (scripts/lib/press-clarity-judge.ts): what a reader must already know. */
  clarity?: string;
  /** Nowhere on some of the judge's reads but not all: album page only, never the hero. */
  clarityContested?: boolean;
  stance: string;
  slot: string;
  treatment: string;
  spanRole: string;
  path: string;
  tier: number;
  rank: number;
  /** The headline the card carries, and where it came from: the album page's other-release check reads a printed headline too (BUG-831). */
  headline?: string;
  headlineSource?: string;
  headlineVerbatim?: boolean;
  source: { name: string; url: string | null; host?: string | null; kind: string; member?: boolean };
};
export type PressRow = { albumId: number; cards: PressCardRow[]; reveal: PressCardRow[] };

export type HeroCandidate = {
  line: ReviewLine;
  score: number;
  rank: number;
  dist: number;
  /** Where the line came from and what it carried, for reading a decision back: "press LEAD/plain/verdict/rave/t1", "raw exa". */
  detail: string;
};
type Candidate = HeroCandidate;

/** Provenance only breaks ties between lines that read equally well; Exa's lines are the newest and page-verified, so it edges the others. */
const SOURCE_SCORE: Record<string, number> = { exa: 6, anydecentmusic: 4, wikipedia: 2, musicbrainz: 0 };
const NAMES_RECORD_RAW = 15;
const NAMES_RECORD_PRESS = 8;
const PRAISE_RAW = 6;
const TREATMENT_SCORE: Record<string, number> = { quoteOnly: 40, stroke: 30 };
const SLOT_SCORE: Record<string, number> = { LEAD: 30, VERDICT: 22, FILL: 12, CLOSER: 8, SOUND: 8 };
const ROLE_SCORE: Record<string, number> = { verdict: 15, thesis: 10, definition: 8, sound: 6, scene: 2 };
const STANCE_SCORE: Record<string, number> = { rave: 10, warm: 4 };
const TIER_SCORE: Record<number, number> = { 1: 10, 2: 5, 3: 0 };
/** The judge's word on how little a reader needs: the hero shows title and artist, so album-level still reads, but a line that stands anywhere is the better hero. */
const CLARITY_SCORE: Record<string, number> = { anywhere: 12, artist: 8, album: 0 };
/** Any eligible press card sits above any raw line: the vetted pool wins whenever it has an answer. */
const VETTED = 1000;

function pressCandidate(c: PressCardRow, inTopSet: boolean, title: string | undefined, names: OutletNames, facts?: RecordFacts): Candidate | null {
  if (!c || typeof c.quote !== "string") return null;
  if (c.source?.kind !== "review" || c.path === "VOICE") return null;
  if (c.stance !== "rave" && c.stance !== "warm") return null;
  if (c.clarityContested) return null;
  // BUG-403 (press v20): a member-written review is labelled "Reader review" on the album page; the
  // hero has no row label to say so, so it never takes the hero.
  if (isMemberSource(c.source ?? {}, names)) return null;
  const raw = trimLeadingConjunction(normalizeQuote(c.quote));
  const quote = cleanReviewQuote(raw);
  // credited, or refused, as the record's own page does: its source rules, then the other-release check (BUG-831)
  const publication = creditedCard(c, facts, names);
  if (!quote || !publication) return null;
  const score =
    VETTED +
    (TREATMENT_SCORE[c.treatment] ?? 0) +
    (inTopSet ? SLOT_SCORE[c.slot] ?? 0 : 0) +
    (ROLE_SCORE[c.spanRole] ?? 0) +
    (STANCE_SCORE[c.stance] ?? 0) +
    (TIER_SCORE[c.tier] ?? 0) +
    (CLARITY_SCORE[c.clarity ?? ""] ?? 0) +
    (namesRecord(raw, title) ? NAMES_RECORD_PRESS : 0) +
    (endsOnStop(raw) ? 6 : 0) -
    (CONNECTIVE_OPENER.test(raw) ? 10 : 0) -
    (FIRST_PERSON_OPENER.test(raw) ? 8 : 0) -
    (PARENTHETICAL.test(raw) ? 5 : 0) -
    (BRACKETED.test(raw) ? 5 : 0) -
    lengthPenalty(raw);
  return {
    line: { quote, publication, url: c.source.url ?? null, vetted: true },
    score,
    rank: Number.isFinite(c.rank) ? c.rank : 0,
    dist: Math.abs(raw.length - SWEET_SPOT),
    detail: `press ${inTopSet ? c.slot || "set" : "reveal"}/${c.treatment}/${c.spanRole || "-"}/${c.stance}/t${c.tier}${c.clarity ? "/" + c.clarity : ""}`,
  };
}

/**
 * The address a raw row's review sits at, with a Wayback Machine copy read through to the page it holds: a raw row has
 * no host of its own, and an archived copy of a real outlet's page is that outlet's, not the archive's.
 */
function rawSourceOf(r: ReviewRow): { name: string; url: string | null; host: string | null } {
  const url = r.reviewUrl ?? null;
  const inner = url ? /^https?:\/\/(?:www\.)?web\.archive\.org\/web\/\d+[a-z_]*\/(https?:\/\/.+)$/i.exec(url)?.[1] ?? null : null;
  const at = inner ?? url;
  return { name: r.publication?.trim() ?? "", url: at, host: hostOf(at) };
}

function rawCandidate(r: ReviewRow, title: string | undefined, outlets: OutletNames): Candidate | null {
  const raw = trimLeadingConjunction(normalizeQuote(r.displayQuote ?? r.excerpt));
  const quote = cleanReviewQuote(raw);
  // the stored name is credited as the album page credits a card: a name that is only an address is never the credit (BUG-831)
  const publication = r.publication?.trim() ? creditFor(rawSourceOf(r), outlets) : null;
  if (!quote || !publication) return null;
  if (hasNegativeVerdict(raw)) return null;
  const names = namesRecord(raw, title);
  const praise = hasPraise(raw);
  const score =
    (SOURCE_SCORE[r.source ?? ""] ?? -4) +
    (names ? NAMES_RECORD_RAW : 0) +
    (praise ? PRAISE_RAW : 0) +
    (startsLikeSentence(raw) ? 8 : 0) +
    (endsOnStop(raw) ? 4 : 0) -
    (CONNECTIVE_OPENER.test(raw) ? 8 : 0) -
    (FIRST_PERSON_OPENER.test(raw) ? 8 : 0) -
    (PARENTHETICAL.test(raw) ? 5 : 0) -
    (BRACKETED.test(raw) ? 5 : 0) -
    lengthPenalty(raw);
  return {
    line: { quote, publication, url: r.reviewUrlDead ? null : r.reviewUrl },
    score,
    rank: 0,
    dist: Math.abs(raw.length - SWEET_SPOT),
    detail: `raw ${r.source ?? "?"}${names ? " names-record" : ""}${praise ? " praise" : ""}`,
  };
}

/** Best first: score, then the editor's own rank, then nearest the sweet spot. */
function compare(a: Candidate, b: Candidate): number {
  return b.score - a.score || b.rank - a.rank || a.dist - b.dist;
}

/**
 * Every eligible candidate per album, best first, with the score and where it came from.
 * Press rows must already be at the live editor floor (the server wrapper filters on
 * editor_version and shape, the same gate the press section itself renders through); a
 * below-floor row is never passed in.
 */
export function rankHeroCandidates(
  pressRows: PressRow[],
  reviewRows: ReviewRow[],
  /** albums.title by id: a line that names its record is the one most likely to be a verdict about it. */
  titles: Record<number, string> = {},
  /** The outlet-name table (src/lib/press-outlet-names.json), which the server passes in as the album page does. */
  names: OutletNames = {},
  /** The press rules' facts for each album (kind, the artist's other releases), for the other-release check; none means the source rules only. */
  facts: Record<number, RecordFacts> = {},
): Record<number, HeroCandidate[]> {
  const all = new Map<number, Candidate[]>();
  const add = (albumId: number, c: Candidate | null) => {
    if (!c) return;
    const list = all.get(albumId) ?? [];
    list.push(c);
    all.set(albumId, list);
  };
  for (const p of pressRows) {
    for (const c of p.cards ?? []) add(p.albumId, pressCandidate(c, true, titles[p.albumId], names, facts[p.albumId]));
    for (const c of p.reveal ?? []) add(p.albumId, pressCandidate(c, false, titles[p.albumId], names, facts[p.albumId]));
  }
  // Where the editor has read the press, the editor's answer stands, including "nothing":
  // a floor row whose cards are all mixed or cool means the record's reception was not a
  // recommendation, and the raw rows for it are the same reviews. Falling through would
  // put a soft pan under "Top of the rotation" (Quiet Nights: "not entirely satisfying").
  const edited = new Set(pressRows.map((p) => p.albumId));
  for (const r of reviewRows) if (!edited.has(r.albumId)) add(r.albumId, rawCandidate(r, titles[r.albumId], names));
  const out: Record<number, HeroCandidate[]> = {};
  for (const [albumId, list] of all) out[albumId] = list.sort(compare);
  return out;
}

/** Pick one hero line per album: the head of rankHeroCandidates. */
export function chooseHeroLines(
  pressRows: PressRow[],
  reviewRows: ReviewRow[],
  titles: Record<number, string> = {},
  names: OutletNames = {},
  facts: Record<number, RecordFacts> = {},
): Record<number, ReviewLine> {
  const out: Record<number, ReviewLine> = {};
  for (const [albumId, list] of Object.entries(rankHeroCandidates(pressRows, reviewRows, titles, names, facts))) {
    if (list[0]) out[Number(albumId)] = list[0].line;
  }
  return out;
}

/** Raw rows only (no press): the fallback chooser on its own. */
export function chooseReviewLines(rows: ReviewRow[], titles: Record<number, string> = {}): Record<number, ReviewLine> {
  return chooseHeroLines([], rows, titles);
}
