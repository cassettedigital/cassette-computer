/**
 * A station's place in today's order: the same all day, different the next (a small steady hash). Apart
 * from lib/radio/dial so the Radio page's body (components/radio/RadioDial) can turn the dial without the
 * registry the dial is built from.
 */
export function dailyTurn(day: number, slug: string): number {
  let h = 2166136261;
  for (const c of `${day}|${slug}`) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
