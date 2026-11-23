/**
 * The first Home ("Rip it or drop it", Shelves FirstRun) is for a library with nothing in it. As soon as
 * one record has gone in, the regular Home takes over (the founder, 2026-11-20: three records in and the
 * big banner was still there), and an add still going on shows in the note at the window's foot. Its own
 * module so the window's drop handler (DeskDrop) can tell when Home is showing the add card, without a cycle.
 */
export function showsFirstRun(records: number): boolean {
  return records === 0;
}

/** How many empty sleeves the first Home draws for records to land in: one whole row. */
export const FIRST_ROW = 6;
