/**
 * The rule every row of keys (ActionRow) holds: each key says how it gives way (data-give: play, name, word, or keep for
 * a key that never changes), and a row keeps at most one key whole, except a pair of halves, where both do. The row
 * checks itself against it in development; row-give.test.ts holds it; the design check's `rows` section reads the
 * same rule in the code (scripts/ci/design-rows.mjs).
 */

import type { Give } from "./Button";

/** What a key may give way to, as data-give says it. */
export const GIVES: readonly Give[] = ["play", "name", "word", "keep"];

/**
 * The keys of a row that don't say how they give way, and whether it keeps more than one (development and the tests):
 * each child of the row, or the one key inside it (a menu's split key), must carry data-give.
 */
export function rowGiveProblems(row: Element, halves: boolean): string[] {
  const out: string[] = [];
  let keeps = 0;
  for (const kid of Array.from(row.children)) {
    if (kid.tagName === "SCRIPT") continue;
    const key = kid.matches("[data-give]") ? kid : kid.querySelector("[data-give]");
    const give = key?.getAttribute("data-give") as Give | null | undefined;
    const name = (kid.textContent || kid.getAttribute("aria-label") || kid.tagName.toLowerCase()).trim().slice(0, 40);
    if (!give) out.push(`"${name}" doesn't say how it gives way (give: ${GIVES.join(", ")})`);
    else if (!GIVES.includes(give)) out.push(`"${name}" gives "${give}", which isn't one of ${GIVES.join(", ")}`);
    else if (give === "keep") keeps++;
  }
  if (!halves && keeps > 1) out.push(`${keeps} keys keep their size; a row keeps one (a pair that never gives way is halves)`);
  return out;
}
