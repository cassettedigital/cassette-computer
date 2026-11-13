/**
 * A page with nothing to show, in whatever frame it lands in: the line in big caps, one plain sentence
 * under it, then the ways on (a search, a link, Try again), each on its own line. The missing page
 * (Lost) and the page that didn't load (Failed) are both this, on the paper's own inks, so it reads the
 * same on the light paper and the dark and inside the desk's window.
 *
 * `wrap={false}` when the page already sits in its own column (help's article beside its topics).
 */

import type { ReactNode } from "react";
import t from "./taste.module.css";
import l from "./lost.module.css";

export function EmptyState({
  title,
  lede,
  wrap = true,
  children,
}: {
  title: ReactNode;
  lede?: ReactNode;
  wrap?: boolean;
  /** The ways on: a search, a link, Try again. */
  children?: ReactNode;
}) {
  return (
    <div className={wrap ? `${t.wrap} ${l.lost}` : l.lost}>
      <h1 className={l.line}>{title}</h1>
      {lede && <p className={l.lede}>{lede}</p>}
      {children}
    </div>
  );
}
