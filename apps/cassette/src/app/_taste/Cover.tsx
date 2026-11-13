/**
 * A cover wherever one sits as an object on the page (P8): the one shadow, the one hover (it lifts 3px
 * when its link is pointed at), 2px corners; the one caption under it (the title in the serif, then
 * "ARTIST · YEAR" or the year in the meta type at ink-3); and the one marker for the record you are on,
 * a short bar in its colour under the cover, never on it. A page puts its own art inside (the kit's
 * AlbumCover, a Sleeve, a plain image) and sizes the box.
 */

import type { ReactNode } from "react";
import c from "./cover.module.css";

/** The cover's box: the art goes inside. Its hover answers to the nearest link or button around it. */
export function CoverArt({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={className ? `${c.art} ${className}` : c.art}>{children}</span>;
}

/** The record you are on, marked under its cover in its colour. Takes no room when it is not. */
export function CoverMark({ on }: { on: boolean }) {
  return <span className={c.mark} data-on={on || undefined} aria-hidden="true" />;
}

/** The one caption under a cover. */
export function CoverCaption({ title, meta }: { title: ReactNode; meta?: ReactNode }) {
  return (
    <>
      <span className={c.title}>{title}</span>
      {meta ? <span className={c.meta}>{meta}</span> : null}
    </>
  );
}

/** The class a page gives any other cover box it draws itself (the header's stack, the records panel). */
export const coverClass = c.art;
