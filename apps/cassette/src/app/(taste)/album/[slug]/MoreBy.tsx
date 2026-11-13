"use client";

/**
 * More by <Artist>: the main way onward in a click-through. The artist's studio albums, oldest first, as
 * one row of covers at every width (a prolific artist scrolls sideways instead of stacking a wall); this
 * record marked by the shared marker, a bar in its colour under the cover, never on it, and not a link.
 * Every other cover goes to its album page inside the prototype, so the dock keeps playing. The covers,
 * the marker and the captions are the shared cover's, at the size and spacing Albums like shares, so the
 * two rows line up cover for cover (the founder, 2026-11-06: they read uneven).
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlbumCover } from "@/app/components/AlbumCover";
import { CoverArt, CoverCaption, CoverMark } from "@/app/_taste/Cover";
import { SectionHead } from "@/app/_taste/SectionHead";
import k from "@/app/_taste/taste.module.css";
import { albumHref } from "@/app/_taste/links";
import type { AlbumPage, MoreByItem } from "./types";
import a from "./album.module.css";

/** The covers' size for both rows of the band (More by, Albums like): its column, a few columns to the page. */
export const BAND_COVER = { size: 160, sizes: "(max-width: 760px) 120px, 170px" };

function Tile({ m }: { m: MoreByItem }) {
  return (
    <>
      <CoverArt>{m.cover ? <AlbumCover bare imageUrl={m.cover} title="" {...BAND_COVER} /> : <span className={a.mbNoArt}>{m.title}</span>}</CoverArt>
      <CoverMark on={m.current} />
      <CoverCaption title={m.title} meta={m.year} />
    </>
  );
}

export function MoreBy({ p }: { p: AlbumPage }) {
  const listRef = useRef<HTMLOListElement>(null);
  // a row wider than the page fades at the edge it continues past, so it reads as one you can scroll
  const [edge, setEdge] = useState<"start" | "end" | "both" | null>(null);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const read = () => {
      const more = list.scrollWidth > list.clientWidth + 1;
      const atStart = list.scrollLeft <= 2;
      const atEnd = list.scrollLeft + list.clientWidth >= list.scrollWidth - 2;
      setEdge(!more ? null : atStart ? "end" : atEnd ? "start" : "both");
    };
    read();
    list.addEventListener("scroll", read, { passive: true });
    const ro = new ResizeObserver(read);
    ro.observe(list);
    return () => {
      list.removeEventListener("scroll", read);
      ro.disconnect();
    };
  }, []);

  // when the row scrolls, start it with this record in view (set, not animated; sideways only)
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || list.scrollWidth <= list.clientWidth + 1) return;
    const cur = list.querySelector<HTMLElement>("[data-current]");
    if (!cur) return;
    const pad = parseFloat(getComputedStyle(list).paddingLeft) || 0;
    if (cur.offsetLeft + cur.offsetWidth > list.clientWidth) list.scrollLeft = cur.offsetLeft - pad;
  }, [p.slug]);

  return (
    <section className={a.section} aria-labelledby="more-by-head">
      <div className={k.wrap}>
        <SectionHead id="more-by-head" size="small">
          More by {p.artist}
        </SectionHead>
        <ol ref={listRef} className={a.mb} data-fade={edge ?? undefined}>
          {p.moreBy.map((m) => (
            <li key={m.slug} data-current={m.current || undefined}>
              {m.current ? (
                <span className={a.mbTile} aria-current="page">
                  <Tile m={m} />
                </span>
              ) : (
                <Link className={a.mbTile} href={albumHref(m.slug)}>
                  <Tile m={m} />
                </Link>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
