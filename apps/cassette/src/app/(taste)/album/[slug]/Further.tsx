"use client";

/**
 * Albums like this one: studio albums by other artists that sit beside it (the live album page's own
 * neighbours, one per artist), as the shared covers with the one caption (the title and "ARTIST · YEAR")
 * under them, each into its album page inside the prototype. The same cover, size and spacing as More by
 * above it, so the two line up cover for cover.
 *
 * The page asks for more than it shows and the shelf shows whole rows only (the founder, 2026-11-06: one
 * short row says that's all there is; a short second row says we stopped in the wrong place): see .shelf.
 * A cover that fails to load takes its tile out of the list, so the rows still count whole, and a shelf
 * with nothing left goes.
 */

import { useState } from "react";
import Link from "next/link";
import { AlbumCover } from "@/app/components/AlbumCover";
import { CoverArt, CoverCaption, CoverMark } from "@/app/_taste/Cover";
import { SectionHead } from "@/app/_taste/SectionHead";
import k from "@/app/_taste/taste.module.css";
import { albumHref } from "@/app/_taste/links";
import type { AlbumPage } from "./types";
import { BAND_COVER } from "./MoreBy";
import a from "./album.module.css";

export function Further({ p }: { p: AlbumPage }) {
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const shown = p.further.filter((f) => !gone.has(f.slug));
  if (shown.length === 0) return null;
  return (
    <section className={`${a.section} ${a.further}`} aria-labelledby="further-head">
      <div className={k.wrap}>
        <SectionHead id="further-head" size="small">
          Albums like <em>{p.title}</em>
        </SectionHead>
        <ul className={a.shelf}>
          {shown.map((f) => (
            <li key={f.slug}>
              <Link className={a.mbTile} href={albumHref(f.slug)}>
                <CoverArt>
                  <AlbumCover bare imageUrl={f.cover} title="" {...BAND_COVER} onError={() => setGone((s) => new Set(s).add(f.slug))} />
                </CoverArt>
                {/* the marker's room, as in More by, so the captions of the two rows sit at one height */}
                <CoverMark on={false} />
                <CoverCaption title={f.title} meta={`${f.artist}${f.year ? ` · ${f.year}` : ""}`} />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
