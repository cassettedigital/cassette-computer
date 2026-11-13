"use client";

/**
 * HubPicture - the ONE way a picture the person's hub serves is drawn: their folder cover, their artist
 * photo (docs/reference/CASSETTE_IMAGES.md). Catalog and uploaded pictures go through the kit's <Picture>;
 * these are the person's own, read from their computer, so they get the rules a local app should have, here
 * and nowhere else (the guard in scripts/ci/guardrails.mjs refuses a raw <img> anywhere else):
 *
 *  - Its address comes from coverArtURL / artistPhotoURL (lib/playback-remote), which round every request to
 *    the image ladder's sizes, so one cover has one address per size.
 *  - A picture this window has already drawn is drawn WITH its page (eager, decoded on the main thread), so
 *    coming back to a page doesn't blink. One arriving for the first time loads lazily and decodes off the
 *    main thread, so scrolling a big grid never waits on it (BUG-920, 2026-11-08).
 *  - A picture that failed before the page woke (drawn on the server) still moves on to the next source.
 *
 * Fills its box unless the caller styles it.
 */

import type { CSSProperties } from "react";

/** The hub's pictures this window has already drawn, by address (the newest few thousand). */
const shown = new Set<string>();
const SHOWN_KEPT = 5000;
function noteShown(url: string) {
  if (shown.has(url)) return;
  shown.add(url);
  if (shown.size > SHOWN_KEPT) shown.delete(shown.values().next().value!);
}

/** Whether an address is one of the hub's own pictures (a folder cover or an artist folder photo). */
export function isHubPicture(url: string): boolean {
  return url.includes("/api/playback/cover?") || url.includes("/api/library/artist-photo?");
}

export function HubPicture({
  src,
  srcSet,
  sizes,
  alt = "",
  priority,
  width,
  height,
  className,
  style,
  onLoad,
  onError,
}: {
  /** From coverArtURL / artistPhotoURL, never built by hand. */
  src: string;
  /** Every ladder size of the same picture, when the box is sized by CSS (`sizes` then says how wide). */
  srcSet?: string;
  sizes?: string;
  alt?: string;
  /** Above the fold: never lazy. */
  priority?: boolean;
  width?: number;
  height?: number;
  className?: string;
  style?: CSSProperties;
  onLoad?: () => void;
  onError?: () => void;
}) {
  const held = shown.has(src);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={src}
      src={src}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      width={width}
      height={height}
      loading={priority || held ? "eager" : "lazy"}
      decoding={held ? "sync" : "async"}
      className={className}
      style={style ?? (className ? undefined : { width: "100%", height: "100%", objectFit: "cover", display: "block" })}
      onLoad={() => {
        noteShown(src);
        onLoad?.();
      }}
      onError={onError}
      ref={(img) => {
        if (!img?.complete) return;
        if (img.naturalWidth > 0) {
          noteShown(src);
          return;
        }
        // drawn on the server, it can fail before the page wakes and its error is missed
        if (img.dataset.missed) return;
        img.dataset.missed = "1";
        onError?.();
      }}
    />
  );
}
