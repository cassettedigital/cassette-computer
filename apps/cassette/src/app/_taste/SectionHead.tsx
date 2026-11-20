/**
 * The section head (P5): one head, big for a page's main sections and a size down for the smaller ones.
 * No info tip: a head says what the section is, and the section shows it (2026-10-28). `after` puts a small
 * control right after the text, on its baseline (the records' view options); the row is the positioned
 * box a phone's menu hangs from. `inline` is for a control that is the sentence's last word ("If you like X for
 * their ___"): the row takes the head's own type, so the word space and the word's size follow the head's.
 * `trail` puts a control at the far end; passing it
 * at all, even as false, keeps the row, so the head sits the same with or without the control. With `after` as well,
 * the trail stands at the end of the head and its control together, and never wraps away from them onto a line of its
 * own (a Discover shelf's menu word, then its play key).
 */

import type { ReactNode } from "react";
import h from "./head.module.css";

export function SectionHead({
  id,
  size = "big",
  after,
  inline = false,
  trail,
  children,
}: {
  id?: string;
  size?: "big" | "small";
  /** A small control right after the head's text, on its baseline. */
  after?: ReactNode;
  /** The control after the text is the sentence's last word: a word space away, in the head's size. */
  inline?: boolean;
  trail?: ReactNode;
  children: ReactNode;
}) {
  const head = (
    <h2 id={id} className={size === "small" ? `${h.head} ${h.small}` : h.head}>
      {children}
    </h2>
  );
  const row =
    after !== undefined ? (
      <div className={h.withAfter} data-inline={inline || undefined} data-small={size === "small" || undefined}>
        {head}
        {after}
      </div>
    ) : (
      head
    );
  if (trail === undefined) return row;
  return (
    <div className={h.withTrail}>
      {row}
      {trail}
    </div>
  );
}
