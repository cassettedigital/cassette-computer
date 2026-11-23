/**
 * A glyph on the Cassette app icon's tile (Brand.tsx AppIcon's material, the founder's "Corners lit", 2026-11-23), the
 * glyph flat on it in the icon's orange gradient. One tile wherever a glyph wears it: a page title's place (PageTitle,
 * where it stands as tall as the title's capitals) and the app's own tile on an account card (AuthCard: the computer
 * or the phone, captioned "The Cassette app"). Drawn on its own, its holder sets --tile-font to 1/0.7 of the side it
 * wants.
 */

import { ICON_MARK_BOTTOM, ICON_MARK_TOP } from "./Brand";
import { Icon, type IconName } from "./Icon";
import g from "./glyphtile.module.css";

/** One gradient for every tile's glyph, in the glyph's own 24-unit grid, top to foot. */
const MARK = "cs-title-mark";

export function GlyphTile({ icon }: { icon: IconName }) {
  return (
    <span className={g.tile} aria-hidden="true">
      <svg className={g.defs} width="0" height="0" focusable="false">
        <defs>
          <linearGradient id={MARK} gradientUnits="userSpaceOnUse" x1="12" y1="3" x2="12" y2="21">
            <stop offset="0" stopColor={ICON_MARK_TOP} />
            <stop offset="1" stopColor={ICON_MARK_BOTTOM} />
          </linearGradient>
        </defs>
      </svg>
      <Icon name={icon} size={48} className={g.glyph} />
    </span>
  );
}
