/**
 * What a release is, and the lists both pages build from the one catalogue. Pure.
 */

import { https, yearOf } from "./format";
import type { AlbumKind, CatalogRow, FurtherItem, KindedRow, RecordFacts, RecordKind } from "./types";

type Rec = {
  title: string;
  releaseType: string | null;
  releaseDate: string | null;
  /** MusicBrainz's secondary types for the release ("Live", "Mixtape/Street", "Compilation"), where the loader read them. */
  secondaryTypes?: readonly string[] | null;
  /** Set by markRepeats on the second and later copies of a title the catalogue holds many times. */
  repeat?: boolean;
};

/* ── R1: kinds (artist-taste/b/[slug]/gates.ts:67-79, artist-taste/a/[slug]/gates.ts:71-80) ── */

/** Live sets, broadcasts, bonus discs, remix records and hits collections are not studio albums. Never
 *  a bare "live": that would take Live Through This with it ("live in" is a place: Ye Live in Mexico). */
const NOT_STUDIO = /\b(live at|live from|live in|in concert|broadcast|webcast|bonus|dis[ck] 2|remix(es)?|greatest hits|the best of|the very best|the essential|anthology)\b/i;
const LIVE_TITLE = /\b(live at|live from|live in|in concert|broadcast|webcast)\b/i;
/** A hits collection is a compilation whatever the release type says (Waterparks' Greatest Hits is filed as an album). */
const HITS_TITLE = /\b(greatest hits|the best of|the very best|the essential|anthology)\b/i;
const DATED_TITLE = /^\d{4}-\d{2}-\d{2}/;

/**
 * MusicBrainz secondary types that make a release something other than a studio album, lower case. Live, Compilation,
 * Remix and Demo are the four the discovery pass already trusts (phase4-core, journey-core, the artist page's Known For);
 * Mixtape/Street, DJ-mix and the spoken-word types are never a studio record either. Soundtrack is left out on purpose:
 * a film composer's scores are their studio work, and the importer already files a soundtrack under its own release type.
 */
const NOT_STUDIO_TYPES: ReadonlySet<string> = new Set([
  "live", "compilation", "remix", "demo", "mixtape/street", "dj-mix", "spokenword", "interview", "audiobook", "audio drama", "field recording",
]);

/** The release's secondary types, lower case and trimmed; empty when the loader had none. */
function typesOf(a: Rec): Set<string> {
  return new Set((a.secondaryTypes ?? []).map((x) => String(x).trim().toLowerCase()).filter(Boolean));
}

/** MusicBrainz's secondary types out of whatever the database handed back (an array, or the same array as JSON text). */
export function secondaryTypesOf(v: unknown): string[] {
  let x = v;
  if (typeof x === "string") {
    try {
      x = JSON.parse(x);
    } catch {
      return [];
    }
  }
  return Array.isArray(x) ? x.filter((t): t is string => typeof t === "string" && t.trim() !== "") : [];
}

export function isStudio(a: Rec): boolean {
  if (a.repeat) return false;
  if (a.releaseType && a.releaseType !== "album") return false;
  if (!yearOf(a.releaseDate)) return false;
  for (const t of typesOf(a)) if (NOT_STUDIO_TYPES.has(t)) return false;
  const t = a.title.trim();
  if (NOT_STUDIO.test(t)) return false;
  if (DATED_TITLE.test(t)) return false;
  if (/\bEP$/i.test(t)) return false;
  return true;
}

export function recordKind(a: Rec): RecordKind {
  if (isStudio(a)) return "studio";
  const t = a.title.trim();
  const type = (a.releaseType ?? "").toLowerCase();
  const types = typesOf(a);
  if (type === "live" || types.has("live") || LIVE_TITLE.test(t) || DATED_TITLE.test(t)) return "live";
  if (type === "ep" || /\bEP$/i.test(t)) return "ep";
  if (type === "compilation" || types.has("compilation") || HITS_TITLE.test(t)) return "compilation";
  return "other";
}

/**
 * A title the catalogue holds this many times is one work recorded by many performers (a classical composer's page:
 * a Mozart symphony under each conductor), not an artist's run of albums. Four self-titled records (Peter Gabriel,
 * Weezer) stay under it.
 */
export const REPEAT_TITLE_MIN = 5;

/** The title with a trailing bracket ("(Remastered)", "(Live)") off, as a comparable key. */
const repeatKey = (title: string) => normTitle(title.replace(/\s*[([][^)\]]*[)\]]\s*$/, ""));

/**
 * Mark the second and later copies of a title held REPEAT_TITLE_MIN times or more, so they are not listed as studio
 * albums: the earliest dated copy stays the record. Only rows that would be studio albums count. Rows come back in the
 * same order; a marked row is `{ ...row, repeat: true }`.
 */
export function markRepeats<T extends Rec>(rows: T[]): T[] {
  const byKey = new Map<string, number[]>();
  rows.forEach((r, i) => {
    if (!isStudio(r)) return;
    const k = repeatKey(r.title);
    if (!k) return;
    const at = byKey.get(k);
    if (at) at.push(i);
    else byKey.set(k, [i]);
  });
  const out = rows.slice();
  const when = (i: number) => rows[i].releaseDate || "9999";
  for (const at of byKey.values()) {
    if (at.length < REPEAT_TITLE_MIN) continue;
    const keep = at.slice().sort((x, y) => when(x).localeCompare(when(y)) || x - y)[0];
    for (const i of at) if (i !== keep) out[i] = { ...rows[i], repeat: true };
  }
  return out;
}

/** "Live", "EP", "Compilation"; null when the title already says it, and for studio and other. */
export function kindLabel(kind: RecordKind, title: string): string | null {
  const t = title.trim();
  if (kind === "live") return /\b(live|webcast|broadcast|in concert)\b/i.test(t) ? null : "Live";
  if (kind === "ep") return /\bEP$/i.test(t) ? null : "EP";
  if (kind === "compilation") return "Compilation";
  return null;
}

/** One key per song however it was released (artist-taste/b/[slug]/gates.ts:314-319). */
export function songKey(title: string): string {
  let t = title.toLowerCase().trim();
  for (let i = 0; i < 3; i++) t = t.replace(/\s*[([][^)\]]*[)\]]\s*$/, "");
  t = t.replace(/\s+-\s+(remaster(ed)?|live|demo|mono|stereo|single version|radio edit).*$/, "");
  return t.replace(/[^\p{L}\p{N}]+/gu, "");
}

/* ── titles in text and addresses ── */

/** Lowercase, accents off, "&" as "and", apostrophes dropped, every other run of non-alphanumerics one space. */
export function normTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/['‘’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** An address's path, decoded and normalised; "" when there is none. */
export function urlPathWords(url: string | null | undefined): string {
  if (!url) return "";
  let path = "";
  try {
    path = new URL(url).pathname;
  } catch {
    return "";
  }
  try {
    path = decodeURIComponent(path);
  } catch {
    // a broken escape: use the raw path
  }
  return normTitle(path);
}

/** The ways a title shows up in an address: itself, without a leading article, without a trailing
 *  bracket, and each part of a "A / B" or "A: B" title that is 5 characters or more. */
export function titleVariants(title: string): string[] {
  const out = new Set<string>();
  const add = (s: string) => {
    const n = normTitle(s);
    if (n) out.add(n);
  };
  const t = title.trim();
  add(t);
  add(t.replace(/^(the|a|an)\s+/i, ""));
  const bare = t.replace(/\s*[([][^)\]]*[)\]]\s*$/, "");
  add(bare);
  for (const part of bare.split(/\s+\/\s+|:\s+/)) if (part.trim().length >= 5) add(part);
  return [...out];
}

/** P6a: the address names this record (whole words, or run together when that is 6 characters or more). */
export function urlNamesRecord(url: string | null | undefined, title: string): boolean {
  const p = urlPathWords(url);
  if (!p) return false;
  const spaced = ` ${p} `;
  const squashed = p.replace(/ /g, "");
  return titleVariants(title).some((v) => {
    if (spaced.includes(` ${v} `)) return true;
    const run = v.replace(/ /g, "");
    return run.length >= 6 && squashed.includes(run);
  });
}

/* ── the catalogue ── */

/** Studio albums and everything else, each in release order (the catalogue arrives oldest first, undated last). */
export function splitCatalog(rows: CatalogRow[]): { studio: KindedRow[]; other: KindedRow[] } {
  const studio: KindedRow[] = [];
  const other: KindedRow[] = [];
  for (const r of rows) {
    const kind = recordKind(r);
    (kind === "studio" ? studio : other).push({ ...r, kind });
  }
  const dated = (a: KindedRow) => (yearOf(a.releaseDate) ? 0 : 1);
  other.sort((a, b) => dated(a) - dated(b));
  return { studio, other };
}

/**
 * The facts the press rules need about one record. `allTitles` is every album title the artist has,
 * hidden rows included (readArtistTitles): the hidden ones are the reissues, box sets and sessions
 * whose reviews must not pass as this record's (P4d).
 */
export function recordFacts(
  row: Pick<CatalogRow, "id" | "title" | "releaseDate" | "releaseType">,
  catalog: Array<Pick<CatalogRow, "id" | "title">>,
  allTitles: string[] = [],
): RecordFacts {
  const own = normTitle(row.title);
  const visible = new Set(catalog.map((c) => normTitle(c.title)));
  const siblings: string[] = [];
  const editions: string[] = [];
  const seen = new Set<string>([own]);
  for (const c of catalog) {
    const n = normTitle(c.title);
    if (c.id === row.id || !n || seen.has(n)) continue;
    seen.add(n);
    siblings.push(c.title);
  }
  for (const t of allTitles) {
    const n = normTitle(t);
    if (!n || seen.has(n) || visible.has(n)) continue;
    seen.add(n);
    editions.push(t);
  }
  return { title: row.title, kind: recordKind(row), siblings, editions };
}

/** True when this slug is one of the artist's visible releases (rule V1: never link to a 404). */
export const inCatalog = (catalog: CatalogRow[], slug: string | null | undefined): boolean =>
  !!slug && catalog.some((c) => c.slug === slug);

/* ── N1: Further listening ── */

/** The fields of a getSimilarAlbums row this reads (album-page-data.ts:447). */
export type SimilarAlbumIn = {
  id: number;
  slug: string;
  title: string;
  artist_name: string;
  artist_slug: string;
  release_date: string | null;
  cover_art_small_url: string | null;
  cover_art_url: string | null;
  computation_version: string | null;
};

/**
 * Up to `max` neighbours, in the loader's order: the generations in `versions` (the live one, and the
 * prior one the live album page falls back to while the live one has no album edges; the founder asked
 * for these back on 2026-10-21), a cover, visible (in `kinds`), a studio album, another artist, one per
 * artist. None left: the section does not render.
 */
export function furtherListening(
  rows: SimilarAlbumIn[],
  kinds: Record<string, AlbumKind>,
  opts: { versions: string[]; artistSlug: string; max?: number },
): FurtherItem[] {
  const max = opts.max ?? 6;
  const out: FurtherItem[] = [];
  const artists = new Set<string>();
  for (const r of rows) {
    if (out.length >= max) break;
    if (!r.computation_version || !opts.versions.includes(r.computation_version)) continue;
    const cover = https(r.cover_art_small_url ?? r.cover_art_url);
    if (!cover) continue;
    const k = kinds[String(r.id)];
    if (!k || !isStudio({ title: k.title, releaseType: k.releaseType, releaseDate: k.releaseDate, secondaryTypes: k.secondaryTypes })) continue;
    if (!r.artist_slug || r.artist_slug === opts.artistSlug || artists.has(r.artist_slug)) continue;
    artists.add(r.artist_slug);
    out.push({ slug: k.slug, title: r.title, artist: r.artist_name, artistSlug: r.artist_slug, year: yearOf(k.releaseDate ?? r.release_date), cover });
  }
  return out;
}
