"use client";

/**
 * A chip: a short choice drawn as a small outlined key in the label type, 3px corners. A link when it
 * has `href` (a suggested search, a nearby vibe; `pressed` marks the one in force, as aria-current); a
 * toggle when it has `onPress` (a genre to leave out, your library on or off, a station to save), lit in
 * the stock's ink while `pressed`. `label` names it for a screen reader when its text alone is ambiguous.
 * ChipRow sets a row of them, wrapping.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import c from "./chip.module.css";

export function Chip({
  href,
  pressed,
  onPress,
  label,
  children,
}: {
  href?: string;
  pressed?: boolean;
  onPress?: () => void;
  label?: string;
  children: ReactNode;
}) {
  if (href) {
    return (
      <Link className={c.chip} href={href} prefetch={false} aria-current={pressed ? "true" : undefined} aria-label={label}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={c.chip} aria-pressed={!!pressed} aria-label={label} onClick={onPress}>
      {children}
    </button>
  );
}

export function ChipRow({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className={c.group}>
      {label ? <p className={c.label}>{label}</p> : null}
      <div className={c.row}>{children}</div>
    </div>
  );
}
