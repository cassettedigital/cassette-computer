/**
 * Cover glass: a record lights the card it sits in, seen through a pane of the card's own paper (the
 * iPhone's Now Playing glass, AmbientCoverBackdrop). One recipe for every card that wants it, so it is
 * never drawn again from scratch: the Mac's Resume and Deep Dive cards today.
 *
 *   <div className={cx(styles.card, glassHost)} style={{ "--glass-radius": "16px" }}>
 *     <CoverGlass playing={isPlaying}><img src={smallCover} alt="" /></CoverGlass>
 *     …the card's own content…
 *   </div>
 *
 * - The host takes `glassHost`: it positions and clips, and lifts everything else it holds above the glass.
 * - The child is the picture, a small copy (64px is plenty: it is blurred wide). Pass whatever draws a
 *   cover where the card lives (the Mac's Art, the kit's AlbumCover); CoverGlass stretches it to fill.
 * - `--glass-radius` is the host's corner radius; `--glass-paper` the pane's colour if it isn't the
 *   kit's raised surface; `--glass-tint` the record's accent, which the light then takes as its one hue.
 * - `ramp="down"` thickens the pane downward, for a picture above its words; the default thickens it
 *   across, for a picture beside them.
 * - `rim` alone gives any surface the glass's lit edge without the light behind it.
 *
 * Not this: a cover's light behind a page's opener, reaching past its box (CoverGlow), or a bar tinted
 * with the record's colour (the Mac's page bar, --pk-tint-glow). Decorative.
 */

import type { ReactNode } from "react";
import g from "./glass.module.css";

/** The class a host of CoverGlass takes. */
export const glassHost = g.host;
/** The glass's lit edge on its own. */
export const rim = g.rim;

export function CoverGlass({
  children,
  playing,
  ramp = "across",
}: {
  children: ReactNode;
  playing?: boolean;
  ramp?: "across" | "down";
}) {
  return (
    <span className={g.layer} data-playing={playing || undefined} data-ramp={ramp} aria-hidden="true">
      <span className={g.light}>{children}</span>
      <span className={g.tint} />
      <span className={g.pane} />
    </span>
  );
}
