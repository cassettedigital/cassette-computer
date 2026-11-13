/**
 * Keep playing's queue arithmetic for a surface that hands its pick to the player ahead of time (the
 * Mac app: the pick goes to the end of the hub's queue as soon as it is known, so the music carries on
 * with the window closed). Pure and generic over the item, so the Mac's songs and any later surface's
 * share it. lib/keep-playing/queue.test.ts pins it.
 */

/** The pick's songs still waiting in what is to come, in the order they wait. */
export function liveTail<T>(upcoming: readonly T[], tail: readonly string[], idOf: (t: T) => string | null): string[] {
  const waiting = new Set(upcoming.map(idOf).filter((id): id is string => !!id));
  return tail.filter((id) => waiting.has(id));
}

/** Whether the pick sits at the very end of what is to come, in its own order. */
export function tailAtEnd<T>(upcoming: readonly T[], tail: readonly string[], idOf: (t: T) => string | null): boolean {
  if (!tail.length) return true;
  if (upcoming.length < tail.length) return false;
  const end = upcoming.slice(upcoming.length - tail.length).map(idOf);
  return end.every((id, i) => id === tail[i]);
}

/** What is to come with the pick moved back to the end (after a shuffle or an Add to Queue). */
export function withTailLast<T>(upcoming: readonly T[], tail: readonly string[], idOf: (t: T) => string | null): T[] {
  const inTail = new Set(tail);
  const rest = upcoming.filter((t) => !inTail.has(idOf(t) ?? ""));
  const byId = new Map(upcoming.map((t) => [idOf(t), t]));
  return [...rest, ...tail.map((id) => byId.get(id)).filter((t): t is T => t !== undefined)];
}

/** What is to come without the pick (keep playing switched off, or repeat turned on). */
export function withoutTail<T>(upcoming: readonly T[], tail: readonly string[], idOf: (t: T) => string | null): T[] {
  const inTail = new Set(tail);
  return upcoming.filter((t) => !inTail.has(idOf(t) ?? ""));
}
