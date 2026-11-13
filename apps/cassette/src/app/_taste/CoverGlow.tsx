/**
 * A cover's own light behind it (P8), one recipe: the phone app's (AmbientCoverBackdrop), the kit's
 * AlbumCover blurred and oversized, reaching up and out but barely down, so the next section's stock
 * starting right below never cuts it. It fills a box that reaches out from its positioned parent (the
 * album opener's cover column, the artist header's stack of covers), never further than the page's
 * margin or the room above the opener, and fades to nothing before the box ends, so no edge of the
 * window ever cuts it. Kept quiet (the founder, 2026-10-21: "bring these down quite a bit on both"): a
 * faint wash of the cover's colour with no shape of its own, one recipe for the album opener and the
 * artist header. `soft` is the artist header's: lower, wider and slower to fall off. Decorative.
 */

import { AlbumCover } from "@/app/components/AlbumCover";
import g from "./glow.module.css";

export function CoverGlow({ src, soft }: { src: string; soft?: boolean }) {
  return (
    <div className={g.glow} data-soft={soft || undefined} aria-hidden="true">
      <AlbumCover decorative imageUrl={src} title="" />
    </div>
  );
}
