/**
 * Picking songs in a list, the Mac's way (the founder, 2026-11-06: a click on a song selects it, so you can
 * Shift- or Command-click several and add them to a playlist or take them out; only the play symbol plays,
 * so a click never changes what's on). A plain click picks one row; Command (or Control) adds or drops one;
 * Shift picks the run from the last row clicked to this one, keeping the rows already picked with Command.
 * Pure, so a list can keep its picks however it likes (by index here; the desk maps its own keys).
 */

export type Picked = { rows: number[]; anchor: number | null };

export const NOTHING_PICKED: Picked = { rows: [], anchor: null };

export type PickHow = "one" | "toggle" | "range";

/** What a click asks for, from its keys. */
export function pickHow(e: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }): PickHow {
  if (e.shiftKey) return "range";
  if (e.metaKey || e.ctrlKey) return "toggle";
  return "one";
}

export function pick(was: Picked, row: number, how: PickHow): Picked {
  if (how === "toggle") {
    const rows = was.rows.includes(row) ? was.rows.filter((r) => r !== row) : [...was.rows, row].sort((a, b) => a - b);
    return { rows, anchor: row };
  }
  if (how === "range" && was.anchor !== null) {
    const [from, to] = was.anchor < row ? [was.anchor, row] : [row, was.anchor];
    const run = Array.from({ length: to - from + 1 }, (_, i) => from + i);
    return { rows: [...new Set([...was.rows, ...run])].sort((a, b) => a - b), anchor: was.anchor };
  }
  return { rows: [row], anchor: row };
}

/** A right click: on a picked row it acts on all the picks; on any other row it picks that row alone. */
export function pickForMenu(was: Picked, row: number): Picked {
  return was.rows.includes(row) ? was : { rows: [row], anchor: row };
}
