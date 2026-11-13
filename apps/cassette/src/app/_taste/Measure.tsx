/**
 * The one measured bar (P10), for the album's meter and the artist's Known for: a 1px track at ink-4, a
 * 3px fill in the record's colour from `from` to `to` (0 to 1), an optional 10px dot at `to` and an
 * optional tick for "their usual". Unlit, the fill and the dot drop to ink-3 (a row that is in step).
 *
 * Its one motion is the page's focal fill: when the list it sits in scrolls in (the reveal observer marks
 * it data-shown), the fill grows out of `from` and the dot rides from `from` to `to`, 0.9s, each row
 * 80ms after the one before (`i`). Still and full for anyone who asks for less motion. The fill sits on
 * Cassette's flat stock, so the dot is cut out of the track in that stock.
 */

import type { CSSProperties } from "react";
import s from "./measure.module.css";

const clamp = (v: number) => Math.max(0, Math.min(1, v));

export function Measure({
  to,
  from = 0,
  dot,
  tick,
  tickLabel,
  lit = true,
  i = 0,
  label,
}: {
  to: number;
  from?: number;
  dot?: boolean;
  /** Where "their usual" sits, 0 to 1. */
  tick?: number;
  /** The words over the tick, on the first row only. */
  tickLabel?: string;
  lit?: boolean;
  /** The row's place in its list, for the stagger. */
  i?: number;
  /** What the bar says, for a screen reader; without it the bar is decoration. */
  label?: string;
}) {
  const a = clamp(from);
  const b = clamp(to);
  const style = {
    "--lo": Math.min(a, b),
    "--span": Math.abs(b - a),
    "--to": b,
    "--shift": a - b,
    "--origin": b >= a ? "left" : "right",
    "--tick": tick == null ? 0 : clamp(tick),
    "--i": i,
  } as CSSProperties;
  return (
    <span className={s.measure} data-lit={lit || undefined} style={style} {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}>
      {tick != null && (
        <i className={s.tick}>
          {tickLabel && (
            <span className={s.usual} data-anchor={tick < 0.15 ? "start" : tick > 0.85 ? "end" : undefined}>
              {tickLabel}
            </span>
          )}
        </i>
      )}
      <i className={s.fill} />
      {dot && (
        <i className={s.rail}>
          <i className={s.dot} />
        </i>
      )}
    </span>
  );
}
