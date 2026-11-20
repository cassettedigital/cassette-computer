/**
 * A page still on its way (a loading.tsx): its shape as bones on the paper, laid out by the page's own
 * classes, so the page arrives where its skeleton stood. The bones are the paper's own track ink, so one
 * skeleton reads right on the light paper and the dark, and inside the desk's window.
 *
 * The look and the motion are skeleton.module.css's, the site's one (nothing for a quick load, then one
 * band of light across every bone at once); every loading state on the site is drawn with these parts.
 *
 *   SkeletonPage   the set: "Loading" for a screen reader, and nothing in it answers a pointer
 *   Skeleton       one bone: a line (the default, sized by `w` and `h`), text (a line of type as tall as
 *                  the letters of the class around it), a pill (a button's height and corners), a cover (a
 *                  square), a circle. Anything else (a page's class, a data attribute its CSS keys on)
 *                  passes through
 *   SkeletonText   a paragraph: its lines in the type of the class around it, the last one short
 *   SkeletonFacts  the facts row (P11): small labels over their values
 *   SkeletonRows   a list's rows: the number, the title (its width varies, so it reads as a list), the
 *                  length; laid out by the page's own row class when it passes one
 *
 * No hooks, so a loading.tsx renders it on the server.
 */

import type { HTMLAttributes, ReactNode } from "react";
import f from "./facts.module.css";
import sk from "./skeleton.module.css";

type Size = number | string;

export function Skeleton({
  shape = "line",
  w,
  h,
  className,
  style,
  ...rest
}: Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  shape?: "line" | "text" | "pill" | "cover" | "circle";
  w?: Size;
  h?: Size;
}) {
  return (
    <span
      aria-hidden="true"
      data-shape={shape}
      className={className ? `${sk.bone} ${className}` : sk.bone}
      style={{ width: w, height: h, ...style }}
      {...rest}
    />
  );
}

export function SkeletonPage({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={className ? `${sk.page} ${className}` : sk.page} aria-busy="true">
      <span className={sk.srOnly} role="status">
        {label}
      </span>
      {/* the bones and the page's empty boxes around them say nothing to a screen reader */}
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

// a paragraph's line ends, so it reads as text and not as a ruled pad
const ENDS = [100, 96, 98, 93, 97];

export function SkeletonText({ lines = 3, last = "62%", className }: { lines?: number; last?: string; className?: string }) {
  return (
    <span className={className ? `${sk.text} ${className}` : sk.text} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} shape="text" w={i === lines - 1 && lines > 1 ? last : `${ENDS[i % ENDS.length]}%`} />
      ))}
    </span>
  );
}

export function SkeletonFacts({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={className ? `${f.facts} ${className}` : f.facts} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={f.fact}>
          <Skeleton w="4.5em" h={11} />
          <Skeleton w={i % 2 ? "5.5em" : "4em"} h={20} />
        </div>
      ))}
    </div>
  );
}

// the titles' widths, so the rows read as a list of songs and not a ruled pad
const TITLES = [62, 48, 74, 55, 68, 41, 58, 71, 50, 64, 45, 69];

export function SkeletonRows({ count = 8, className, rowClassName }: { count?: number; className?: string; rowClassName?: string }) {
  return (
    <div className={className ? `${sk.rows} ${className}` : sk.rows} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={rowClassName ?? sk.row}>
          <Skeleton w="1.2em" h={12} />
          <Skeleton w={`${TITLES[i % TITLES.length]}%`} h={16} />
          <Skeleton w="2.6em" h={12} className={sk.end} />
        </div>
      ))}
    </div>
  );
}
