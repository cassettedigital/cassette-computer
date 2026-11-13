import styles from "./parts.module.css";

/**
 * Segmented LED meter — discrete, all-or-nothing cells. The lit cells are the
 * drawn rectangles (amber, brighter center + bloom); the gaps between them are
 * the panel's own background, so there are no dark dividing lines. When the count
 * fits, there's one cell per item (album / track) — so a cell is never half-lit.
 */
export function LedMeter({
  value,
  total,
  max = 48,
}: {
  value: number;
  total: number;
  /** Cap on cell count; above this the meter scales proportionally. */
  max?: number;
}) {
  const t = Math.max(0, Math.floor(total));
  const cells = t === 0 ? max : Math.min(t, max);
  const v = Math.max(0, Math.min(Math.floor(value), t));
  let lit = t > 0 ? Math.round((v / t) * cells) : 0;
  // When the bar is capped below the true total, rounding can light every cell
  // at, say, 48 of 49 — which reads as a full, fully-synced device. Hold back a
  // cell so an incomplete device never shows a full meter.
  if (v < t) lit = Math.min(lit, cells - 1);
  return (
    <div className={styles.ledMeter} aria-hidden="true">
      {Array.from({ length: cells }, (_, i) => (
        <span key={i} className={i < lit ? `${styles.ledCell} ${styles.ledLit}` : styles.ledCell} />
      ))}
    </div>
  );
}
