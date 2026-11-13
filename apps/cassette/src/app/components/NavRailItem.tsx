"use client";

/**
 * NavRailItem — one rail row geometry for every destination, section header,
 * playlist, and device.
 *
 * Index grammar only: three type treatments (meta / destination / entry),
 * accent-bar selection, no filled wash. Leading slot is icon | StatusDot |
 * empty; trailing slot is a mono annotation or a hover-revealed arrow. The
 * legacy LED mode was retired with the rail redesign (058f933f) — the lamp
 * vocabulary lives in the kit StatusDot now.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./NavRailItem.module.css";

export type NavRailTreatment = "meta" | "destination" | "entry";

export function NavRailItem({
  href,
  label,
  icon,
  count,
  current,
  className,
  onClick,
  treatment,
  selected,
  leading,
  affix,
  trailing,
  unavailable,
}: {
  href: string;
  label: string;
  icon?: ReactNode;
  count?: number;
  /** Semantic current page (aria-current). */
  current?: boolean;
  className?: string;
  onClick?: () => void;
  /** Index-rail type treatment: meta / destination / entry. */
  treatment: NavRailTreatment;
  /** Selected route. Prefer over `current` when the two differ. */
  selected?: boolean;
  /** Leading slot — icon, StatusDot, or omit for empty. */
  leading?: ReactNode;
  /** Inline tag right after the label text (the hub's "hub" mark) — rides
   *  with the name instead of floating in the trailing gutter. */
  affix?: ReactNode;
  /** Trailing annotation (meta type). Does not change on hover/selection. */
  trailing?: ReactNode;
  /** Reserved; offline devices are no longer dimmed (ink ruling). */
  unavailable?: boolean;
}) {
  const isSelected = Boolean(selected ?? current);

  const cls = [
    styles.cell,
    styles.index,
    treatment === "meta" ? styles.meta : "",
    treatment === "destination" ? styles.destination : "",
    treatment === "entry" ? styles.entry : "",
    isSelected ? styles.selected : "",
    unavailable ? styles.unavailable : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Link
      href={href}
      className={cls}
      aria-current={current || selected ? "page" : undefined}
      data-selected={isSelected ? "true" : undefined}
      onClick={onClick}
    >
      {/* Lead slot renders only when it has content — headers and lead-less
          rows sit flush left instead of hanging off a phantom icon column. */}
      {(leading ?? icon) != null ? (
        <span className={styles.lead}>{leading ?? icon}</span>
      ) : null}
      <span className={styles.label}>
        {label}
        {affix != null ? <span className={styles.affix}>{affix}</span> : null}
      </span>
      {trailing != null ? <span className={styles.trailing}>{trailing}</span> : null}
      {count != null && trailing == null ? (
        <span className={styles.trailing}>{count}</span>
      ) : null}
    </Link>
  );
}
