"use client";

/**
 * A record's cover wherever a cover sits (records, songs, other releases), with one treatment when
 * there is none or it fails to load: the dark box with the title typeset in it (`small` for a
 * thumbnail: the first letter only). Never an empty slot. The cover is the site's AlbumCover, so it
 * comes resized for its box from the image optimizer, never the original upload; `sizes` says how wide
 * the box is drawn. Nothing is ever drawn over a cover.
 */

import { useState } from "react";
import { AlbumCover } from "@/app/components/AlbumCover";
import s from "./sleeve.module.css";

export function Sleeve({
  src,
  title,
  small,
  sizes,
  className,
  loading = "lazy",
}: {
  src: string | null | undefined;
  title: string;
  small?: boolean;
  /** How wide the box is drawn, for the optimizer (a thumbnail is 64px unless said). */
  sizes?: string;
  className?: string;
  loading?: "lazy" | "eager";
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const show = !!src && failed !== src;
  return (
    <span className={className ? `${s.sleeve} ${className}` : s.sleeve} data-small={small || undefined} data-nocover={show ? undefined : ""}>
      {show ? (
        <AlbumCover bare imageUrl={src} title="" className={s.img} sizes={sizes ?? (small ? "64px" : "(max-width: 760px) 50vw, 320px")} loading={loading} onError={() => setFailed(src)} />
      ) : (
        <span className={s.type} aria-hidden="true">
          {small ? title.trim().charAt(0) : title}
        </span>
      )}
    </span>
  );
}
