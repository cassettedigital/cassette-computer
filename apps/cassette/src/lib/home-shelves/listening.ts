/**
 * The listening rows: the phone's On repeat and Around now (AmperfyKit/Home/ListeningShelves.swift, as
 * the phone mock read them in proto/phone-taste/data.ts), defined once here so every surface ranks them
 * the same way. Pure and client-safe: the caller hands in the plays (album key + when) and the clock,
 * and "around now" is read in the caller's own time zone (the browser's), so "this evening" is the
 * listener's evening.
 *
 *   onRepeat   records played on at least three occasions in the last 14 days, weighted toward the
 *              most recent (a 5-day half-life)
 *   aroundNow  records played at this part of the day, on this kind of day (weekday or weekend), over
 *              60 days, at least twice (a 21-day half-life)
 */

/** A day in milliseconds (the shelves' tuning, config.ts, keeps the same constant). */
const DAY_MS = 24 * 60 * 60 * 1000;

export type Play = { key: string; at: number };
export type DayPart = "morning" | "afternoon" | "evening" | "late";

export const LISTENING = {
  onRepeat: { windowDays: 14, halfLifeDays: 5, minPlays: 3, take: 8 },
  aroundNow: { windowDays: 60, halfLifeDays: 21, minPlays: 2, take: 10 },
} as const;

/** The part of the day an hour (0-23, local) falls in: the phone's buckets. */
export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour <= 10) return "morning";
  if (hour >= 11 && hour <= 16) return "afternoon";
  if (hour >= 17 && hour <= 21) return "evening";
  return "late";
}

const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

function rank(plays: Play[], now: number, halfLifeDays: number, minPlays: number, take: number): string[] {
  const score = new Map<string, { s: number; n: number; last: number }>();
  for (const p of plays) {
    const age = Math.max(0, now - p.at) / DAY_MS;
    const e = score.get(p.key) ?? { s: 0, n: 0, last: 0 };
    e.s += Math.pow(0.5, age / halfLifeDays);
    e.n += 1;
    e.last = Math.max(e.last, p.at);
    score.set(p.key, e);
  }
  return [...score.entries()]
    .filter(([, e]) => e.n >= minPlays)
    .sort((a, b) => b[1].s - a[1].s || b[1].last - a[1].last || a[0].localeCompare(b[0]))
    .slice(0, take)
    .map(([k]) => k);
}

/** Records on repeat lately, best first (album keys). */
export function onRepeat(plays: Play[], now: number): string[] {
  const c = LISTENING.onRepeat;
  const since = now - c.windowDays * DAY_MS;
  return rank(
    plays.filter((p) => p.at >= since),
    now,
    c.halfLifeDays,
    c.minPlays,
    c.take,
  );
}

/** A moment's part of the day and kind of day, on this runtime's clock (the browser's). */
const localSlot = (ms: number) => {
  const d = new Date(ms);
  return { part: dayPart(d.getHours()), weekend: isWeekend(d) };
};

/**
 * Records played around this time of day, on this kind of day, best first, with the part named.
 * `slotAt` reads a moment on the listener's clock: the browser's own by default; a server passes
 * the listener's time zone (lib/home).
 */
export function aroundNow(plays: Play[], now: number, slotAt: (ms: number) => { part: DayPart; weekend: boolean } = localSlot): { part: DayPart; keys: string[] } {
  const c = LISTENING.aroundNow;
  const since = now - c.windowDays * DAY_MS;
  const { part, weekend } = slotAt(now);
  const same = plays.filter((p) => {
    if (p.at < since) return false;
    const s = slotAt(p.at);
    return s.part === part && s.weekend === weekend;
  });
  return { part, keys: rank(same, now, c.halfLifeDays, c.minPlays, c.take) };
}
