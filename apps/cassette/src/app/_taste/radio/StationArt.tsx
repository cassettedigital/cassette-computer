"use client";

/**
 * A station's square: its picture (the show's, the song's cover, or the station's own art), or with none,
 * or one that fails to load, the station's tile: its colour blended half into the raised stock with its
 * initials in the ink (the phone's RadioTile). Never the browser's broken-image mark.
 */

import { useState } from "react";

export function initials(s: string): string {
  const parts = s.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || s.slice(0, 2).toUpperCase();
}

export function StationArt({ src, name, size, className }: { src: string | null; name: string; size: number; className: string }) {
  const [gone, setGone] = useState(false);
  if (src && !gone) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={className} src={src} alt="" width={size} height={size} loading="lazy" onError={() => setGone(true)} />;
  }
  return (
    <span className={className} data-tile="" aria-hidden="true">
      {initials(name)}
    </span>
  );
}
