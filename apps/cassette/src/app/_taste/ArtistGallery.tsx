"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Picture } from "@discovery/cassette-kit/picture";
import { picture } from "@/lib/images/picture";
import { cleanPhotoCredit } from "@/lib/photo-credit";
import { Icon } from "./Icon";
import g from "./gallery.module.css";

/**
 * An artist's photos: the header picture is the door. Over the picture it lays a full-cover key and one
 * quiet count (the photos glyph and the number, or the expand glyph for one photo) in a small round tag
 * low in the middle, where a round portrait still shows it. Pressing it opens the theater: the photos one
 * at a time on the reader's own paper (it follows the device, as every page does), large and whole, with
 * round keys to go back and on (and the arrow keys, and a swipe), a strip of small ones to jump between,
 * and each photo's Commons credit under it. The header photo is the first, so its credit is reachable
 * here too; a public-domain or CC0 photo shows none. Escape, the Close key or a press outside a photo
 * closes it, and focus goes back where it was.
 *
 * Its own stock, because the theater is portaled to <body> (outside any page's paper) so a header's
 * overflow never clips it. Pictures come from the image ladder through the kit's one picture part.
 */
export interface GalleryImage {
  url: string;
  width?: number | null;
  height?: number | null;
  author?: string | null;
  licenseShort?: string | null;
  licenseUrl?: string | null;
  sourceUrl?: string | null;
  attributionRequired?: boolean | null;
  changesNote?: string | null;
}

function Credit({ img }: { img: GalleryImage }) {
  if (img.attributionRequired !== true) return null;
  return (
    <figcaption className={g.credit} data-testid="theater-caption">
      {cleanPhotoCredit(img.author) || "Photo"}
      {img.licenseShort ? (
        <>
          {" · "}
          {img.licenseUrl ? (
            <a href={img.licenseUrl} target="_blank" rel="noopener noreferrer">
              {img.licenseShort}
            </a>
          ) : (
            img.licenseShort
          )}
        </>
      ) : null}
      {" · "}
      {img.sourceUrl ? (
        <a href={img.sourceUrl} target="_blank" rel="noopener noreferrer">
          via Wikimedia Commons
        </a>
      ) : (
        "via Wikimedia Commons"
      )}
      {img.changesNote ? ` (${img.changesNote})` : ""}
    </figcaption>
  );
}

export function ArtistGallery({ images, artistName }: { images: GalleryImage[]; artistName: string }) {
  const [idx, setIdx] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const touchX = useRef<number | null>(null);
  const closeKey = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => setMounted(true), []);

  const n = images.length;
  const open = idx !== null;
  const go = useCallback((d: number) => setIdx((i) => (i === null ? i : (i + d + n) % n)), [n]);
  const close = useCallback(() => setIdx(null), []);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    closeKey.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      opener.current?.focus();
    };
  }, [open, go, close]);

  if (!n) return null;
  const cur = idx !== null ? images[idx] : null;

  return (
    <>
      {/* the door: the picture itself, and one quiet count */}
      <button
        type="button"
        className={g.door}
        aria-label={`View ${n} photo${n > 1 ? "s" : ""} of ${artistName}`}
        onClick={() => setIdx(0)}
        data-testid="gallery-trigger"
      />
      {/* the number is drawn by CSS (data-count), not written in the page: a text reader (a crawler, an AI
          fetcher) took it for the page's first words ("13 13", BUG-851). The door above says it in words. */}
      <div className={g.count} aria-hidden="true" data-count={n >= 2 ? n : undefined}>
        <Icon name={n >= 2 ? "photos" : "expand"} size={12} />
      </div>

      {mounted &&
        open &&
        cur &&
        createPortal(
          <div role="dialog" aria-modal="true" aria-label={`${artistName} photos`} className={g.theater} onClick={close}>
            <button ref={closeKey} type="button" className={`${g.key} ${g.close}`} aria-label="Close" onClick={close}>
              <Icon name="close" size={18} />
            </button>

            <div className={g.stage}>
              {n > 1 && (
                <button
                  type="button"
                  className={`${g.key} ${g.back}`}
                  aria-label="Previous photo"
                  onClick={(e) => {
                    e.stopPropagation();
                    go(-1);
                  }}
                >
                  <Icon name="chevron" size={18} />
                </button>
              )}
              <figure className={g.figure} onClick={(e) => e.stopPropagation()}>
                <Picture
                  {...picture(cur.url, "photo", { w: cur.width, h: cur.height })}
                  rung={1200}
                  loading="eager"
                  alt={artistName}
                  className={g.photo}
                  onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
                  onTouchEnd={(e) => {
                    if (touchX.current == null) return;
                    const dx = e.changedTouches[0].clientX - touchX.current;
                    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
                    touchX.current = null;
                  }}
                />
                <Credit img={cur} />
              </figure>
              {n > 1 && (
                <button
                  type="button"
                  className={`${g.key} ${g.on}`}
                  aria-label="Next photo"
                  onClick={(e) => {
                    e.stopPropagation();
                    go(1);
                  }}
                >
                  <Icon name="chevron" size={18} />
                </button>
              )}
            </div>

            {n > 1 && (
              <div className={g.strip} onClick={(e) => e.stopPropagation()}>
                {images.map((img, i) => (
                  <button
                    key={i}
                    type="button"
                    className={g.thumb}
                    aria-label={`Photo ${i + 1} of ${n}`}
                    aria-current={i === idx ? "true" : undefined}
                    onClick={() => setIdx(i)}
                  >
                    <Picture {...picture(img.url, "photo", { w: img.width, h: img.height })} frame={52} alt="" />
                  </button>
                ))}
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
