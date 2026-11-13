/**
 * A page still on its way (a loading.tsx): its shape as bones on the paper, laid out by the page's own
 * classes, so the page arrives where its skeleton stood. The bones are the paper's own track ink, so one
 * skeleton reads right on the light paper and the dark, and inside the desk's window.
 *
 *   SkeletonPage   the set: "Loading" for a screen reader; nothing at all for a quick load, then the bones,
 *                  then one slow breath for the whole set (none when the reader asks for less motion)
 *   Skeleton       one bone: a line (the default), a pill (a button's height and corners), a cover (a
 *                  square), a circle. `w` and `h` size it; anything else (a page's class, a data attribute
 *                  its CSS keys on) passes through
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
  shape?: "line" | "pill" | "cover" | "circle";
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
