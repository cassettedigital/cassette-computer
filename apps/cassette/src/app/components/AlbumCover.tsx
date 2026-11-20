'use client';

import { useEffect, useState } from "react";
import { Picture } from "@discovery/cassette-kit/picture";
import { picture } from "@/lib/images/picture";
import styles from "./AlbumCover.module.css";

interface AlbumCoverProps {
  imageUrl?: string | null;
  title: string;
  /** Explicit pixel size (square). Omit for fill mode — the parent sizes it. */
  size?: number;
  className?: string;
  /** The frame for the browser's pick: needed in fill mode, or when CSS sizes the box. A fixed `size` alone is its own frame. */
  sizes?: string;
  priority?: boolean;
  /**
   * Render bare — no `.wrap`, no ghost-initials fallback — so the cover drops
   * into a caller-owned frame (hero well, label / mosaic cell, device thumb)
   * without double-framing. Returns null when the image is missing or errors;
   * the caller owns the empty state (pass `onError` to learn about load failure).
   * Fill mode (no `size`) needs a positioned parent with a real box size —
   * do not pair fill with shrink-wrap / aspect-ratio:auto CSS.
   */
  bare?: boolean;
  /**
   * Decorative blurred backdrop (the card "glow"). Implies bare, hidden from
   * assistive tech. Always the ladder's smallest size: resolution is irrelevant
   * once the parent `.glow` blurs it. Returns null when there is no art.
   */
  decorative?: boolean;
  /** Fired when a bare/framed cover fails to load (caller can show initials). */
  onError?: () => void;
  /**
   * The browser's load and decode hints, lazy and async unless set. A cover that swaps in while it's
   * on screen (a player's art) can ask for eager and sync, so it never shows blank while it loads or decodes.
   */
  loading?: "lazy" | "eager";
  decoding?: "async" | "sync" | "auto";
  /**
   * Fill mode: the frame another screen drew this same cover at (its `sizes`, "112px" for the radio dial's On
   * now card). That size is drawn underneath at once, from the copy the browser already has, and this one
   * lands over it when it arrives, so a cover just seen on the screen before never starts from blank.
   */
  under?: string;
}

/** Displays album art, or ghost initials if missing or on load error. Every cover it draws is marked `data-lands`:
 *  clear over its frame until it has loaded, then a gentle fade in (the root layout's script, globals.css cs-land). */
export function AlbumCover({
  imageUrl,
  title,
  size,
  className = "",
  sizes,
  priority = false,
  bare = false,
  decorative = false,
  onError,
  loading,
  decoding,
  under,
}: AlbumCoverProps) {
  const [hasError, setHasError] = useState(false);
  useEffect(() => {
    setHasError(false);
  }, [imageUrl]);
  const markError = () => {
    setHasError(true);
    onError?.();
  };
  const art = picture(imageUrl, "cover");

  // Decorative glow backdrop: the smallest size, blurred + sized by the parent `.glow`,
  // hidden from AT. Never a second full-size request.
  if (decorative) {
    if (!imageUrl) return null;
    return (
      <span className={styles.fillBox}>
        <Picture {...art} rung={120} alt="" aria-hidden="true" fill className={className || undefined} data-lands="" />
      </span>
    );
  }

  const initials = title
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  // The caller's `sizes` when it gave one (a box its CSS sizes), else a fixed size is its own frame,
  // else a grid card's.
  const frame = sizes ? { sizes } : size ? { frame: size } : { sizes: "(max-width: 640px) 50vw, 200px" };

  // Bare mode: just the image — no wrap, no ghost. The caller's frame
  // provides the box and its own empty/initials state. Null on miss/error.
  if (bare) {
    if (!imageUrl || hasError) return null;
    const common = {
      ...art,
      ...frame,
      alt: title,
      priority,
      className: className || undefined,
      onError: markError,
      loading,
      decoding,
    };
    return size ? (
      <Picture {...common} width={size} height={size} data-lands="" />
    ) : (
      <span className={styles.fillBox}>
        {/* not marked to land softly: a copy the browser already has shows the moment it's drawn */}
        {under ? <Picture {...art} sizes={under} fill alt="" aria-hidden="true" className={className || undefined} loading="eager" /> : null}
        <Picture {...common} fill data-lands="" />
      </span>
    );
  }

  const inlineStyle = size ? { width: size, height: size } : undefined;

  if (imageUrl && !hasError) {
    return (
      <div
        className={`${styles.wrap} ${className}`}
        style={inlineStyle}
      >
        <Picture
          {...art}
          {...frame}
          alt={title}
          width={size}
          height={size}
          fill={!size}
          priority={priority}
          className={styles.img}
          onError={markError}
          loading={loading}
          decoding={decoding}
          data-lands=""
        />
      </div>
    );
  }

  return (
    <div
      className={`${styles.wrap} ${styles.ghost} ${className}`}
      style={inlineStyle}
    >
      <span className={styles.initials}>{initials || "?"}</span>
    </div>
  );
}
