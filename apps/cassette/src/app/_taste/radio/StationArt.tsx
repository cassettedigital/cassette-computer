"use client";

/**
 * A station's square: its picture (the show's, the song's cover, or the station's own art), or with none,
 * or one that fails to load, the station's tile: its colour blended half into the raised stock with its
 * initials in the ink (the phone's RadioTile). Never the browser's broken-image mark.
 *
 * The picture comes through the image ladder at the size of its frame (docs/reference/CASSETTE_IMAGES.md):
 * the stations' own hosts are on the ladder's list, and anything not on it falls back to the stored address.
 */

import { useState } from "react";
import { Picture } from "@discovery/cassette-kit/picture";
import { picture } from "@/lib/images/picture";

export function initials(s: string): string {
  const parts = s.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || s.slice(0, 2).toUpperCase();
}

/**
 * `glass`: the station's own mark (not a show's picture or a song's cover worn in its place) under the
 * station glass (globals.css, data-station-glass); the picture then sits in a box of `className` that
 * clips it, since a picture can't draw over itself.
 */
export function StationArt({ src, name, size, className, glass }: { src: string | null; name: string; size: number; className: string; glass?: boolean }) {
  const [gone, setGone] = useState(false);
  const pic = src && !gone ? picture(src, "station") : null;
  if (pic && (pic.image || pic.original)) {
    if (glass) {
      return (
        <span className={className} data-station-glass="" style={{ overflow: "hidden" }}>
          <Picture {...pic} frame={size} fill width={size} height={size} alt="" style={{ objectFit: "cover" }} onError={() => setGone(true)} />
        </span>
      );
    }
    return <Picture {...pic} frame={size} className={className} width={size} height={size} alt="" onError={() => setGone(true)} />;
  }
  return (
    <span className={className} data-tile="" data-station-glass={glass ? "" : undefined} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
