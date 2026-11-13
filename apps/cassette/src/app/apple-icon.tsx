import { ImageResponse } from "next/og";

/**
 * iOS / Safari home-screen + Start Page "Favorites" icon. This is the flat web
 * twin of the native app icon (apps/cassette-player-ios/CassetteIcon2.icon):
 * a warm-brown vertical gradient tile with the orange cassette mark.
 *
 * Geometry is the CANONICAL mark (public/logo-mark.svg + the icon generator's
 * markSvg), not a hand-redraw: frame rect x3 y8 w26 h16, reels r3, and the reel
 * connector up at y=13.012 (the tape line sits at the top of the reels, the
 * intentional cassette look). Sized to match icon 2.png, whose mark fills ~88%
 * of its canvas and is then scaled 0.88 onto the tile in icon.json -> so the
 * mark spans ~78% of the tile here (svg width = 0.88 * tile).
 *
 * Colours are the CassetteIcon2 icon.json gradients converted Display-P3 -> sRGB
 * (that file's stops are P3; this renders in sRGB). iOS applies its own squircle
 * mask, so the tile is full-bleed. Literal hex is required: this renders outside
 * the app's CSS, so --cs-* won't resolve.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // CassetteIcon2 tile gradient (P3 0.270/0.171/0.133 -> 0.087/0.066/0.044).
          // icon.json runs the stop at y=0.7, so the bottom colour holds the last 30%.
          background: "linear-gradient(180deg, #492a20 0%, #17100b 70%)",
        }}
      >
        <svg width="158" height="158" viewBox="0 0 32 32" fill="none">
          <defs>
            {/* CassetteIcon2 mark gradient (P3 0.910/0.483/0.193 -> 0.910/0.361/0.227),
                one pass top-to-bottom across the whole mark (userSpaceOnUse). */}
            <linearGradient
              id="mark"
              gradientUnits="userSpaceOnUse"
              x1="16"
              y1="8"
              x2="16"
              y2="24"
            >
              <stop offset="0" stopColor="#f97408" />
              <stop offset="1" stopColor="#fb4f29" />
            </linearGradient>
          </defs>
          <g
            stroke="url(#mark)"
            strokeWidth="2.2"
            strokeLinejoin="round"
            strokeLinecap="round"
          >
            <rect x="3" y="8" width="26" height="16" rx="3.5" />
            <circle cx="11.5" cy="16" r="3" />
            <circle cx="20.5" cy="16" r="3" />
            <path d="M11.798,13.012 L20.213,13.012" />
          </g>
        </svg>
      </div>
    ),
    { ...size },
  );
}
