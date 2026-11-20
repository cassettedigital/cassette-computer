/**
 * Small formatters both pages use, so a date, a length or a label prints the same way on each. Pure.
 */

// relative, so the pure-rule tests (run with tsx, no path aliases) can load this file
import { mediaUrl } from "../../../lib/image-url";

/** A stored image address as we serve it: http to https, and the media bucket's throttled r2.dev address
 *  to media.cassette.digital, which Cloudflare caches at the edge (lib/image-url, BUG-430). */
export const https = (u: string | null | undefined): string | null => (u ? mediaUrl(u) : null);

/** "1997-05-21" to "1997"; null when there is no year (artist-taste/b/[slug]/gates.ts:61). */
export const yearOf = (d: string | null | undefined): string | null => (d ?? "").match(/^(\d{4})/)?.[1] ?? null;

/** "1997-05-21" to "May 21, 1997", "1999" to "1999" (album-taste/a/[slug]/data.ts:116-123). */
export function formatReleaseDate(raw: string): string {
  const m = raw.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!m) return raw;
  const [, y, mo, d] = m;
  if (!mo) return y;
  const date = new Date(Date.UTC(Number(y), Number(mo) - 1, d ? Number(d) : 1));
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", ...(d ? { day: "numeric" } : {}), timeZone: "UTC" });
}

/** "3:07"; blank when the length is unknown, never 0:00 (album-taste/a/[slug]/Player.tsx:100-105). */
export function fmtTime(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return "";
  const m = Math.floor(sec / 60);
  const r = Math.round(sec % 60);
  return r === 60 ? `${m + 1}:00` : `${m}:${String(r).padStart(2, "0")}`;
}

/** "1 song", "11 songs". */
export const songsLabel = (n: number): string => `${n} ${n === 1 ? "song" : "songs"}`;
/** "53 min". */
export const minutesLabel = (m: number): string => `${m} min`;

/** A label as a person would print it: label_canonical trimmed; null when empty or "Not On Label" (rule L1). */
export function canonicalLabel(labelCanonical: string | null | undefined): string | null {
  const t = (labelCanonical ?? "").trim();
  if (!t || /^not on label$/i.test(t)) return null;
  return t;
}

/** Straight quotes to curly (copied from artist-taste/b/[slug]/gates.ts:289-295, plus the decade
 *  apostrophe: "the '90s" takes ’, not ‘). Running it twice changes nothing. */
export function curl(text: string): string {
  return text
    .replace(/(^|[\s([{\/-])'(?=\d\ds\b)/g, "$1’")
    .replace(/(^|[\s([{\/-])"/g, "$1“")
    .replace(/"/g, "”")
    .replace(/(^|[\s([{\/-])'/g, "$1‘")
    .replace(/'/g, "’");
}

/**
 * A review page's own heading glued to the front of a stored quote: Sputnikmusic's "Review Summary:" (50 stored
 * quotes on 2026-11-18), and a section title whose punctuation was lost ("Conclusion A solid album...", "Final Rating
 * I think...", "Bottom Line Good intentions aside...", 16 more). Only these headings, only at the very start, only
 * before a capital or an opening quote mark, and never before a short label ("Verdict T: ..." stays as it is).
 * "Overall" is not one: writers open sentences with it. The press editor drops the same headings (hobby-press.ts).
 */
const GLUED_HEADING =
  /^(?:Review Summary:|(?:The\s+)?(?:Final (?:Rating|Verdict|Thoughts|Words)|(?:Our |My )?Verdict|Conclusions?|In Conclusion|Summary|Bottom Line|Rating|Score|Recommended Tracks|Key Tracks|Standout Tracks|Highlights|Closing Thoughts|Review)\s*:?)\s+(?=["“‘'A-Z])(?![A-Z]{1,3}:)/;
export function withoutHeading(text: string): string {
  const m = GLUED_HEADING.exec(text);
  return m ? text.slice(m[0].length) : text;
}

/**
 * One mechanical display cleanup for stored quotes: a review page's heading glued to its front is dropped
 * (withoutHeading), and a missing space after a colon, semicolon or comma when a letter follows directly ("tracks:just
 * primo" reads "tracks: just primo"). Never inside a number ("9.3", "1,000") or an address ("http://").
 */
export function tidyQuote(text: string): string {
  return joinDropCap(withoutHeading(text.trimStart())).replace(/([a-zà-ɏ)\]"”'’])([:;,])(?=[A-Za-zÀ-ɏ])/g, "$1$2 ");
}

/**
 * Words a quote opens with that a review page's large first letter can split ("T his", "I t's", "A nd"). Only
 * these are joined: a lone capital can also be a name or a word ("X is the band's best", "A gain in nerve"),
 * so the joined word has to be one an opening sentence actually uses, and never one a real article or
 * pronoun could start ("A long", "A bout", "A gain" stay as written).
 */
const DROP_CAP_WORDS = new Set(
  (
    "this the that there these those they their then though throughout to today taken " +
    "with when while what where who whose why which we well within without whether " +
    "since so still such she some sometimes second several simply seldom " +
    "for from few first five four following fans " +
    "here how he his her however half having heavy " +
    "never no now not nothing new nearly " +
    "many more most my much moreover musically maybe " +
    "but by both because before being best better beyond back barely " +
    "clearly can could despite during do does each even every everything ever easily " +
    "lyrically like less let long last listening perhaps part put rarely rather really recorded released " +
    "just its it in indeed if is into instead " +
    "an and as at after although also all almost already always among another any album " +
    "on one only once of or our over overall out other " +
    "yet you your young get good given great very unlike until up unfortunately ultimately"
  ).split(" "),
);

/**
 * BUG-662, at read time: a review page sets its first letter as a large drop cap, the page's text keeps it as
 * its own piece, and the quote comes through as "T his unexpected tribute...". When a quote opens (after any
 * opening marks) on one capital, a space, then lowercase letters that make one of DROP_CAP_WORDS with it, the
 * two are joined. Running it twice changes nothing.
 */
export function joinDropCap(text: string): string {
  return text.replace(/^([\s"'“‘]*)([A-Z]) ([a-z]+)(?![a-z])/, (whole, lead: string, cap: string, rest: string) =>
    DROP_CAP_WORDS.has((cap + rest).toLowerCase()) ? `${lead}${cap}${rest}` : whole,
  );
}

/** UTF-8 read as Latin-1 ("clichÃ©s" for "clichés"): the pairs that never occur in real text (BUG-814). */
const MOJIBAKE: Array<[string, string]> = [
  ["â€™", "’"], ["â€˜", "‘"], ["â€œ", "“"], ["â€\u009d", "”"], ["â€“", "–"], ["â€”", "—"], ["â€¦", "…"],
  ["Ã©", "é"], ["Ã¨", "è"], ["Ãª", "ê"], ["Ã«", "ë"], ["Ã¡", "á"], ["Ã¢", "â"], ["Ã¤", "ä"], ["Ã¥", "å"],
  ["Ã­", "í"], ["Ã¯", "ï"], ["Ã³", "ó"], ["Ã´", "ô"], ["Ã¶", "ö"], ["Ã¸", "ø"], ["Ãº", "ú"], ["Ã¼", "ü"],
  ["Ã±", "ñ"], ["Ã§", "ç"], ["Ã‰", "É"], ["ÃŸ", "ß"],
];
export function fixMojibake(text: string): string {
  if (!/[ÃÂâ]/.test(text)) return text;
  let out = text;
  for (const [bad, good] of MOJIBAKE) out = out.split(bad).join(good);
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** After a title's closing mark, a word that shows the title is the subject ("Walls’ is"), not a possessive ("Eagles’ notorious"). */
const VERB_AFTER = /^(?:is|was|isn’t|wasn’t|are|were|has|had|hasn’t|have|may|might|will|would|could|should|can|does|did|doesn’t|remains|stands|feels|sounds|seems|marks|offers|proves|shows|finds|brings|takes|makes|gives|works|opens|starts|ends|closes|delivers|captures|continues|presents|represents|sees|comes|arrives|plays|serves|reveals|showcases|demonstrates|contains|features|includes|kicks|picks)\b/i;

/**
 * BUG-814, at read time: a record title that lost its opening quote mark where it opens the quote
 * ("TEN: The Story Goes On’ is…"), or got a wrong-facing one anywhere ("’Madame X’"), gets ‘ back. Narrow on
 * purpose (the 2026-11-04 review found a broader version turning possessives into titles, "Revenge is ‘Kiss’
 * best"): only titles we know (the record's own, the artist's other releases) that start with a capital or a
 * digit as written in the quote, only at the quote's start, and a title ending in s only when a verb follows
 * (so "Dire Straits’ third album" stays a possessive). A split possessive ("Superstar’ s") and a doubled mark
 * ("MDNA’’") are joined first. Runs after curl().
 */
export function restoreTitleMarks(text: string, titles: readonly string[]): string {
  let out = text.replace(/(\p{L})’ s\b/gu, "$1’s").replace(/’’/g, "’").replace(/‘‘/g, "‘");
  const lower = out.toLowerCase();
  const known = [...new Set(titles.map((t) => t.trim()))]
    .filter((t) => t.length >= 3 && !/^[‘’'"“”]/.test(t) && lower.includes(t.toLowerCase()))
    .sort((a, b) => b.length - a.length);
  const capital = (s: string) => /^[\p{Lu}\p{N}]/u.test(s);
  for (const t of known) {
    const esc = escapeRe(t);
    out = out.replace(new RegExp(`^(${esc})’(?![\\p{L}\\p{N}])(\\s+\\S+)?`, "iu"), (whole, title: string, next?: string) => {
      if (!capital(title)) return whole;
      if (/s$/i.test(title) && !(next && VERB_AFTER.test(next.trim()))) return whole;
      return `‘${title}’${next ?? ""}`;
    });
    out = out.replace(new RegExp(`(^|[\\s(—–-])’(${esc})’(?![\\p{L}\\p{N}])`, "giu"), (whole, before: string, title: string) =>
      capital(title) ? `${before}‘${title}’` : whole,
    );
  }
  return out;
}
