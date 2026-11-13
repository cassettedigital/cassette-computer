/**
 * A review's stars: five, with halves, drawn from the stored score (walk.ts starsOf). Said once to a
 * screen reader as "4.5 stars out of 5"; the drawing itself is hidden from it. Draws nothing for a score
 * format.ts refuses.
 */

import { starsOf } from "./walk";
import w from "./writing.module.css";

const STAR = "M12 2.6l2.83 6.08 6.67.78-4.93 4.56 1.3 6.58L12 17.3l-5.87 3.3 1.3-6.58L2.5 9.46l6.67-.78z";
/** The star's left half: the same outline, closed down its middle (both its top and its inner foot sit on x = 12). */
const HALF = "M12 2.6L9.17 8.68 2.5 9.46l4.93 4.56-1.3 6.58L12 17.3z";

function Star({ fill }: { fill: "full" | "half" | "empty" }) {
  return (
    <svg className={w.star} data-fill={fill} viewBox="0 0 24 24" aria-hidden="true">
      <path className={w.starTrack} d={STAR} />
      {fill !== "empty" ? <path className={w.starFill} d={fill === "half" ? HALF : STAR} /> : null}
    </svg>
  );
}

export function Stars({ score, size = "small" }: { score: unknown; size?: "small" | "big" }) {
  const s = starsOf(score);
  if (!s) return null;
  const marks: Array<"full" | "half" | "empty"> = [
    ...Array<"full">(s.full).fill("full"),
    ...(s.half ? (["half"] as const) : []),
    ...Array<"empty">(s.empty).fill("empty"),
  ];
  return (
    <span className={w.stars} data-size={size} role="img" aria-label={s.label}>
      {marks.map((m, i) => (
        <Star key={i} fill={m} />
      ))}
    </span>
  );
}
