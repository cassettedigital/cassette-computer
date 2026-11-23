/**
 * Quote marks round a pulled line. Pure, no imports: the discover hero (lib/discovery/review-line-pick.ts) and the
 * album page's review cards (lib/album-page-data.ts) both take the marks that wrap a whole line off, so one masonry never
 * mixes a collector's curly-wrapped quote with a bare one, and neither strips a title's own mark (BUG-831, BUG-232).
 */

const MARK_PAIRS: Record<string, string> = { "“": "”", "‘": "’", '"': '"', "'": "'" };
const MARK_OPENERS: Record<string, string[]> = { "”": ["“"], "’": ["‘"], '"': ['"'], "'": ["'"] };
const isWordChar = (c: string | undefined): boolean => !!c && /[\p{L}\p{N}]/u.test(c);
/** Is the character at `i` a quote mark, rather than an apostrophe inside a word ("don't", "rock 'n' roll" keeps both)? */
const isMarkAt = (t: string, i: number): boolean => !((t[i] === "'" || t[i] === "’") && isWordChar(t[i - 1]) && isWordChar(t[i + 1]));
function marksOf(t: string, ch: string): number[] {
  const at: number[] = [];
  for (let i = 0; i < t.length; i++) if (t[i] === ch && isMarkAt(t, i)) at.push(i);
  return at;
}

/**
 * The quote marks that wrap the whole line, taken off; a mark that belongs to a title or phrase INSIDE the line stays
 * with its partner. A mark at the start goes when its partner is the last character (the whole line is one quotation), or
 * when it has no partner anywhere (a stray). One whose partner closes mid-line is a title's own mark and stays:
 * "'Kid A' is a landmark" is not "Kid A' is a landmark" (BUG-831). The same at the end. Runs before marks are straightened,
 * so a curly pair keeps its direction.
 */
export function stripWrappingMarks(raw: string): string {
  let t = raw.trim();
  for (let round = 0; round < 4 && t.length > 0; round++) {
    const before = t;
    const first = t[0];
    const close = MARK_PAIRS[first];
    if (close && isMarkAt(t, 0)) {
      const closes = marksOf(t, close).filter((i) => i > 0);
      const last = t.length - 1;
      if (closes.length === 0) {
        t = t.slice(1).trim(); // a stray opening mark
      } else if (closes[closes.length - 1] === last && t.length > 2) {
        // the closing mark is the last character: it wraps the line when nothing inside closes it first
        const inside = closes.filter((i) => i < last);
        const wraps = first === close ? inside.length === 0 : (() => {
          let depth = 0;
          for (let i = 0; i < last; i++) {
            if (t[i] === first && isMarkAt(t, i)) depth++;
            else if (t[i] === close && isMarkAt(t, i)) depth--;
            if (depth === 0) return false;
          }
          return true;
        })();
        if (wraps) t = t.slice(1, -1).trim();
      }
    }
    const end = t.length - 1;
    const lastCh = t[end];
    if (end >= 0 && MARK_OPENERS[lastCh] && isMarkAt(t, end)) {
      const hasOpener = MARK_OPENERS[lastCh].some((o) => marksOf(t.slice(0, end), o).length > 0);
      if (!hasOpener) t = t.slice(0, -1).trim(); // a stray closing mark
    }
    if (t === before) break;
  }
  return t;
}
