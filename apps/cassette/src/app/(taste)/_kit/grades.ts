/**
 * Grades as printed. Copied from album-taste/a/[slug]/press.ts:75-106 (itself the September page's).
 */

/** "4.5 / 5 stars" to "★★★★½", "9.1 / 10" to "9.1/10", "A" to "A". Null when it is not a score we print. */
export function scoreGlyph(label: string | null | undefined): string | null {
  if (!label) return null;
  const s = label.trim().replace(/−/g, "-");
  const five = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*5\b/);
  if (five) {
    const n = Number(five[1]);
    const full = Math.floor(n);
    const half = n - full >= 0.5;
    if (full >= 1 && full <= 5) return "★".repeat(full) + (half ? "½" : "");
    return null;
  }
  const ten = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*10\b/);
  if (ten) return `${ten[1]}/10`;
  const hundred = s.match(/^(\d+)\s*\/\s*100\b/);
  if (hundred) return `${hundred[1]}/100`;
  if (/^[A-D][+-]?$/.test(s)) return s;
  return null;
}

/** A grade as a percentage, so outlets on different scales can be compared. Null when unparseable. */
export function scorePct(label: string | null | undefined): number | null {
  if (!label) return null;
  const s = label.trim().replace(/−/g, "-");
  const frac = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (frac) {
    const v = Number(frac[1]);
    const b = Number(frac[2]);
    return b > 0 ? Math.round((v / b) * 100) : null;
  }
  const letters: Record<string, number> = {
    "A+": 100, A: 95, "A-": 90, "B+": 85, B: 80, "B-": 75, "C+": 70, C: 65, "C-": 60, "D+": 55, D: 50, "D-": 45, F: 30,
  };
  return letters[s] ?? null;
}
