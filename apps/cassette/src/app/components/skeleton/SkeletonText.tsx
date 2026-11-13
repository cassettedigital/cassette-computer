/**
 * SkeletonText — shorthand for one or more text lines built from SkeletonBlock.
 * The last line is shortened (lastLineWidth) so a paragraph reads as text, not a
 * solid bar. Size maps to a line height: sm 11px / md 14px / lg 18px.
 */

import type { CSSProperties } from "react";
import { SkeletonBlock } from "./SkeletonBlock";

const SIZE_HEIGHT = { sm: 11, md: 14, lg: 18 } as const;

export type SkeletonTextProps = {
  lines?: number;
  /** Width of the final line; earlier lines are full width. Default "68%". */
  lastLineWidth?: string;
  size?: keyof typeof SIZE_HEIGHT;
  /** Gap between lines (px). Default 8. */
  gap?: number;
  className?: string;
  style?: CSSProperties;
};

export function SkeletonText({
  lines = 1,
  lastLineWidth = "68%",
  size = "md",
  gap = 8,
  className,
  style,
}: SkeletonTextProps) {
  const height = SIZE_HEIGHT[size];
  return (
    <div
      className={className}
      style={{ display: "flex", flexDirection: "column", gap, ...style }}
    >
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonBlock
          key={i}
          height={height}
          radius="sm"
          delay={i}
          width={i === lines - 1 && lines > 1 ? lastLineWidth : "100%"}
        />
      ))}
    </div>
  );
}
