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
 */

import { useLayoutEffect, useRef, useSyncExternalStore, type ComponentPropsWithoutRef } from "react";
import { fitRow, ROW_FIT_NOW, ROW_WATCH } from "./row-fit";
import r from "./actionrow.module.css";

const never = () => () => {};

export function ActionRow({
  className,
  children,
  centred,
  ...rest
}: ComponentPropsWithoutRef<"div"> & { centred?: boolean }) {
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
      suppressHydrationWarning
      {...rest}
    >
      {children}
      {read && <script dangerouslySetInnerHTML={{ __html: ROW_FIT_NOW }} />}
    </div>
  );
}
