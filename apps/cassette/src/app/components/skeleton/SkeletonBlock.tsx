/**
 * SkeletonBlock — the base pulse primitive. Every other skeleton composes from
 * this one box. Server component (no hooks) so it renders inside route-level
 * loading.tsx files and streaming Suspense fallbacks with zero client cost.
 *
 * Visual spec (see spec §4.1):
 *   - fill: var(--cs-bg2)
 *   - animation: cs-loadPulse 1.4s ease-in-out infinite (globals.css)
 *   - stagger: animationDelay = (delay % 6) * 0.1s
 *   - reduced motion: animation removed, opacity 0.45 (handled in CSS module)
 */

import type { CSSProperties } from "react";
import styles from "./skeleton.module.css";

const RADII = {
  sm: "var(--cs-radius-sm)",
  md: "var(--cs-radius-md)",
  lg: "var(--cs-radius-lg)",
  full: "9999px",
} as const;

export type SkeletonRadius = keyof typeof RADII;

export type SkeletonBlockProps = {
  /** Defaults to "100%". Pass a number for px or any CSS length. */
  width?: number | string;
  /** Box height. Omit only when an aspect ratio (via `style`) drives height. */
  height?: number | string;
  radius?: SkeletonRadius;
  /** Stagger index — multiplied into a 0–0.5s animation delay (mod 6). */
  delay?: number;
  className?: string;
  /** Escape hatch for one-offs (aspectRatio, margin, flex). Merged last. */
  style?: CSSProperties;
};

export function SkeletonBlock({
  width = "100%",
  height,
  radius = "md",
  delay = 0,
  className,
  style,
}: SkeletonBlockProps) {
  return (
    <div
      aria-hidden="true"
      className={className ? `${styles.block} ${className}` : styles.block}
      style={{
        width,
        height,
        borderRadius: RADII[radius],
        animationDelay: `${(delay % 6) * 0.1}s`,
        ...style,
      }}
    />
  );
}
