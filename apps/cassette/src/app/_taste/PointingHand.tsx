/**
 * The printer's pointing hand (U+261E), the one marker for the open or current row of a list (P9): out
 * at the row's left edge, centred on it, in the record's colour as text (--accent-ink, else
 * --accent-c). It slides in on the spring when its row opens. The row is positioned and leaves room at
 * its left for it. Decorative: the row says what is open.
 */

import h from "./hand.module.css";

export function PointingHand({ on }: { on: boolean }) {
  return <span className={h.hand} data-on={on || undefined} aria-hidden="true" />;
}
