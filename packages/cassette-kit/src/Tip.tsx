"use client";

/**
 * Tip: a small "?" beside a line or a control that opens one short sentence of fact, with an optional "More in Help"
 * (the design system's Tip, design wave 1a, built from the masthead's hand-made key label; the founder's D15: extra
 * detail goes in folds and Help). It lets a card say one line and keep the fuller story a press away, so the card never
 * carries a paragraph.
 *
 * It opens on a click or a tap on every device, never on pointing alone, so a phone gets it too. Escape, a press
 * anywhere outside it, or the "?" again closes it. The sentence is a plain string, one short sentence (the copy budget,
 * W2: 90 characters, held by the design check); anything longer is a Fold or a Help page. The phones' own screens carry
 * no Tips (W8): rename, don't explain.
 *
 * Where it opens (design wave 1a, the founder's stable-eyeline rule): never over the title or the line it explains. Beside
 * its "?" where there's room (computer widths): to the right of the line, just past the edge of the block the line sits in,
 * its top level with the "?", so it covers nothing of the card. Where there isn't (a phone): right under the line,
 * aligned to its start. Always kept 16px inside the window, and always floating, so nothing on the page moves when it
 * opens. The "?" draws small but answers a 44px touch.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { BUDGET } from "./budgets";
import { Glyph } from "./Glyph";
import s from "./tip.module.css";

// The kit compiles without Node's types (its own `tsc` build, which Vercel runs), but the apps that draw it replace
// `process.env.NODE_ENV` when they build, so the development-only check below reads it as written.
declare const process: { env: { NODE_ENV?: string } };

/** The sentence's budget (W2): a Tip is one short sentence. */
export const TIP_MAX = BUDGET.tip;

export function Tip({
  say,
  label = "More about this",
  more,
}: {
  /** One short sentence of fact, at most TIP_MAX characters. */
  say: string;
  /** What the "?" is called for a screen reader. */
  label?: string;
  /** A Help page with the whole story. */
  more?: { href: string; label?: string };
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrap = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLSpanElement>(null);

  if (process.env.NODE_ENV !== "production" && say.length > TIP_MAX) {
    console.error(`Tip: "${say}" is ${say.length} characters; a Tip is one short sentence of at most ${TIP_MAX}.`);
  }

  // where the words sit: beside the "?" past the line's block when there's room, else under the line; inside the window
  const place = useCallback(() => {
    const w = wrap.current;
    const b = box.current;
    if (!w || !b) return;
    const at = w.getBoundingClientRect();
    const key = (w.firstElementChild ?? w).getBoundingClientRect();
    const line = (w.parentElement ?? w).getBoundingClientRect();
    const room = document.documentElement.clientWidth;
    const width = b.offsetWidth;
    const beside = Math.max(key.right, line.right) + 16;
    let x: number;
    let y: number;
    if (room >= 760 && beside + width + 16 <= room) {
      // to the right: its first line level with the "?"
      x = beside;
      y = key.top - 10;
      b.dataset.side = "beside";
    } else {
      // under the line, from its start
      x = Math.min(Math.max(line.left, 16), Math.max(16, room - 16 - width));
      y = line.bottom + 8;
      b.dataset.side = "under";
    }
    b.style.setProperty("--tip-x", `${Math.round(x - at.left)}px`);
    b.style.setProperty("--tip-y", `${Math.round(y - at.top)}px`);
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", key);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", key);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  return (
    <span ref={wrap} className={s.tip}>
      <button type="button" className={s.key} aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        <Glyph name="help" size={14} />
      </button>
      {open ? (
        <span ref={box} id={id} className={s.box}>
          {say}
          {more ? (
            <a className={s.more} href={more.href}>
              {more.label ?? "More in Help"}
            </a>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
