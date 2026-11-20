/**
 * SkeletonBlock: the dashboard's bone, sized by width, height and a corner radius. It wears the site's one
 * bone (app/_taste/skeleton.module.css: nothing for a quick load, then one band of light across every bone
 * at once, still for less motion), so the dashboard's skeletons load the way every other page does. Server
 * component (no hooks), for loading.tsx files and Suspense fallbacks alike.
 */

import type { CSSProperties } from "react";
import sk from "@/app/_taste/skeleton.module.css";

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
  /** Kept for older callers; ignored. Every bone shares the one band of light, never staggered. */
  delay?: number;
  className?: string;
  /** Escape hatch for one-offs (aspectRatio, margin, flex). Merged last. */
  style?: CSSProperties;
};

export function SkeletonBlock({
  width = "100%",
  height,
  radius = "md",
  delay: _delay = 0,
  className,
  style,
}: SkeletonBlockProps) {
  return (
    <div
      aria-hidden="true"
      className={className ? `${sk.bone} ${className}` : sk.bone}
      style={{
        width,
        height,
        borderRadius: RADII[radius],
        ...style,
      }}
    />
  );
}
