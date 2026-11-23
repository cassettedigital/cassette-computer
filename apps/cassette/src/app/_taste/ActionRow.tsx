"use client";

/**
 * A row of buttons, the one way the site sets them side by side (the founder, 2026-11-17: "buttons that
 * grid down the page look AWFUL"): always one line, never a second row of whatever didn't fit. When the
 * row can't hold every button at its whole name, the buttons give way in a fixed order (row-fit.ts):
 * Follow to its glyph, the play button to "Preview", then to its glyph; then Buy to "Buy", and the play
 * button again from its whole name. The row is
 * measured, not guessed, since each store's name and each artist's name is its own length.
 *
 * It is right from the first frame: the row carries a one-line script that fits it as the page is read
 * and again whenever it changes size (a streamed page is put in place after it is read), so the page's
 * code isn't needed for that; once that code is running, this fits it again whenever the row or one of
 * its buttons changes size. A menu in the row (Buy) hangs from the row. On a phone the
 * first button takes the room the row leaves, unless it is down to its glyph; a `centred` row (under a
 * page top that is centred on a phone, the album's and the artist's) keeps its buttons at their own widths
 * in the middle.
 *
 * `halves` (design wave 1a): two keys as an equal pair, each half the row, nothing giving way: an account card's Cancel
 * and Sign in, the iPhone's Play and Shuffle. Centring comes from the page shape, never the row.
 *
 * Every key in a row says how it gives way, with data-give (the Button's `give`): "play", "name" or "word" as
 * row-fit.ts reads them, or "keep" for a key that never changes (a glyph-only key, a plain link drawn as a key, either
 * half of a pair). One "keep" per row, except in halves, where both keep. The row says so in development when a key
 * doesn't (the design check's `rows` section holds the same rule in the code, and refuses a row of keys built
 * anywhere but here).
 */

import { useLayoutEffect, useRef, useSyncExternalStore, type ComponentPropsWithoutRef } from "react";
import { rowGiveProblems } from "./row-give";
import { fitRow, ROW_FIT_NOW, ROW_WATCH } from "./row-fit";
import r from "./actionrow.module.css";

const never = () => () => {};

export function ActionRow({
  className,
  children,
  centred,
  halves,
  ...rest
}: ComponentPropsWithoutRef<"div"> & { centred?: boolean; halves?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // the script only while the server's page is being read and taken over: a row drawn later fits in its effect
  const read = useSyncExternalStore(never, () => false, () => true);
  // every render: the row's buttons may have changed
  useLayoutEffect(() => {
    const row = ref.current;
    if (!row) return;
    // the first-frame script's watcher (row-fit.ts) hands over to this one
    const first = (row as HTMLDivElement & { [ROW_WATCH]?: ResizeObserver })[ROW_WATCH];
    if (first) {
      first.disconnect();
      delete (row as HTMLDivElement & { [ROW_WATCH]?: ResizeObserver })[ROW_WATCH];
    }
    fitRow(row);
    if (process.env.NODE_ENV !== "production") {
      for (const problem of rowGiveProblems(row, !!halves)) console.error(`ActionRow: ${problem}.`);
    }
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => fitRow(row));
    ro.observe(row);
    for (const kid of Array.from(row.children)) ro.observe(kid);
    return () => ro.disconnect();
  });
  return (
    // the step attributes are the script's to set (before the page's code runs), never React's
    <div
      ref={ref}
      className={className ? `${r.row} ${className}` : r.row}
      data-centred={centred || undefined}
      data-halves={halves || undefined}
      suppressHydrationWarning
      {...rest}
    >
      {children}
      {read && <script dangerouslySetInnerHTML={{ __html: ROW_FIT_NOW }} />}
    </div>
  );
}
