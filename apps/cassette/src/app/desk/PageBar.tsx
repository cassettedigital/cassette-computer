"use client";

/**
 * A page's slim bar: once a page's head (its cover, name and keys) has scrolled up under the toolbar, a
 * bar rests just below the toolbar with a small cover, the name and the same keys, so Play is never a
 * scroll away (the founder, 2026-10-31). It is lit faintly in the record's colour, takes no room in the
 * page while hidden, and can't be reached by Tab or a screen reader until it shows. While it shows, the
 * toolbar's own scrolled title steps aside for it (desk.module.css).
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import d from "./desk.module.css";

/** The toolbar's height: the head counts as gone once it has slid fully under it. */
const TOOLBAR = 52;

/** Watch a page's keys: `shown` once they have scrolled up past the toolbar. */
export function usePageBar<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => setShown(!e.isIntersecting && e.boundingClientRect.top < TOOLBAR),
      { rootMargin: `-${TOOLBAR}px 0px 0px 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, shown };
}

export function PageBar({ shown, art, title, by, children }: { shown: boolean; art: ReactNode; title: string; by?: ReactNode; children: ReactNode }) {
  return (
    <div className={d.pageBarRail}>
      <div className={d.pageBar} data-shown={shown || undefined} aria-hidden={!shown} inert={!shown}>
        <span className={d.pageBarArt}>{art}</span>
        <span className={d.pageBarWords}>
          <span className={d.pageBarTitle}>{title}</span>
          {by && <span className={d.pageBarBy}>{by}</span>}
        </span>
        <span className={d.pageBarKeys}>{children}</span>
      </div>
    </div>
  );
}
