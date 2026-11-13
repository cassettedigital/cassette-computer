/**
 * photo-credit - turns a Wikimedia Commons "Artist" field into the name a credit line should print
 * (BUG-482).
 *
 * Commons stores the author as a small piece of HTML that was never meant to be read as a line of text,
 * and the harvest and backfill scripts stored it with the tags blanked and nothing else touched. The
 * result printed on artist pages was Sufjan Stevens' "Sufjan Stevens playing banjo.jpg : Joe Lencioni
 * derivative work: Antilived", and a stray "( talk )" on many more (a link to the author's talk page).
 *
 * The rules, in order, all conservative: strip tags and decode entities (the old strip turned "&amp;" into
 * a blank); drop talk-page links; drop a leading file name; for a derivative-work chain keep the
 * photographer and drop the editor; drop labels like "Photo:" and "Original uploader was ... at
 * en.wikipedia"; drop bare web addresses; an unknown or empty author is null, so the caller prints a plain
 * "Photo" instead of "Unknown author". Applied when a row is written (so new rows are clean) and when a
 * credit is drawn (so rows already stored print clean without a database change). Idempotent: cleaning a
 * clean credit changes nothing. Pure and import-free; tested in photo-credit.test.ts.
 */

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", copy: "©" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? " ";
  });
}

const FILE_PREFIX = /^(?:(?:file|image)\s*:\s*)?(.{1,200}?\.(?:jpe?g|png|gif|webp|tiff?|svg))\s*:\s*(.+)$/i;
// the same, when the stored text has no colon after the file name: "Sweeney Todd.jpg chattingjason from ..."
const FILE_PREFIX_BARE = /^.{1,200}?\.(?:jpe?g|png|gif|webp|tiff?|svg)\s+(.+)$/i;
const DERIVATIVE = /^(.*?)[\s,;]*\b(?:derivative work|derived work|modified by|edited by|cropped by|cropping by|retouched by|restored by|colou?rized by)\b\s*:?\s*(.*)$/i;
const ORIGINAL_UPLOADER = /^(?:the\s+)?original uploader was\s+(.+?)\s+at\s+(?:\S+\s+)?\S*wikipedia\S*\s*\.?\s*$/i;
const UNKNOWN = /^(?:unknown|anonymous|anon\.?|n\/?a|none|not specified|unspecified|no author|author unknown|unknown (?:author|photographer|artist)|\?+|-+)$/i;

/** The credit to print, or null when there is nothing worth printing (the caller falls back to "Photo"). */
export function cleanPhotoCredit(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = decodeEntities(String(raw).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, " "));
  s = s.replace(/\s+/g, " ").trim();
  // a link to the author's talk page: "( talk )", "(talk | contribs)", "[ talk ]"
  s = s.replace(/[(\[]\s*(?:talk|talk\s*[|·/]\s*contribs?|contribs?)\s*[)\]]/gi, " ");
  s = s.replace(/\s+/g, " ").trim();
  // a leading file name: "Sufjan Stevens playing banjo.jpg : Joe Lencioni ..."
  const file = FILE_PREFIX.exec(s);
  if (file) s = file[2].trim();
  else {
    const bare = FILE_PREFIX_BARE.exec(s);
    if (bare) s = bare[1].trim();
  }
  // a derivative-work chain keeps the photographer and drops the editor
  const deriv = DERIVATIVE.exec(s);
  if (deriv) s = (deriv[1].trim() || deriv[2].trim());
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(ORIGINAL_UPLOADER, "$1");
    s = s.replace(/^(?:photo(?:graph(?:er|y)?)?|picture|image|credit|source|author|original uploaded by|uploaded by|taken by|photographed by|by)\b\s*[:\-–]?\s*/i, "");
    s = s.replace(/^(?:©|\(c\))\s*(?:\d{4}\s+)?/i, "");
    s = s.replace(/^user\s*:\s*/i, "");
    if (s === before) break;
  }
  s = s.replace(/https?:\/\/\S+/g, " ");
  // what a removed address leaves behind: empty brackets, a dangling "at", a tail "Original uploader was ..."
  s = s.replace(/[(\[]\s*[)\]]/g, " ").replace(/[.;,]?\s*\b(?:the\s+)?original uploader was\b.+$/i, (m, off: number) => (off > 0 ? "" : m));
  s = s.replace(/\s+(?:at|on|from|via)\s*$/i, "");
  s = s.replace(/\s+([,.;:!?)\]])/g, "$1").replace(/([(\[])\s+/g, "$1").replace(/\s+/g, " ");
  s = s.replace(/^[\s:;,|/\-–]+|[\s:;,|/\-–]+$/g, "").trim();
  if (!s || UNKNOWN.test(s) || /\bunknown (?:author|photographer)\b/i.test(s)) return null;
  return s;
}
