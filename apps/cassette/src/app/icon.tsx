import { ImageResponse } from "next/og";

/**
 * Browser-tab favicon - the CassetteIcon2 tile in miniature: warm-brown gradient
 * tile with the orange cassette mark, matching the native app icon
 * (apps/cassette-player-ios/CassetteIcon2.icon) and the home-screen icon
 * (apple-icon.tsx).
 *
 * Geometry is the CANONICAL mark (public/logo-mark.svg + the icon generator's
 * markSvg): frame rect x3 y8 w26 h16, reels r3, reel connector up at y=13.012.
 * Sized like icon 2.png (mark ~88% of canvas, scaled 0.88 onto the tile in
 * icon.json), so it fills ~78% of the tile (svg width = 0.88 * tile). Colours
 * are the CassetteIcon2 icon.json gradients converted Display-P3 -> sRGB.
 *
 * A solid tile also retires the old dark-mode plating fight: Safari draws a white
 * legibility plate behind a bare transparent/monochrome favicon in macOS dark
 * mode, but never behind a self-contained solid tile. Rounded corners so the tab
 * reads as a rounded app-icon tile. Literal hex (renders outside CSS).
 */
export const size = { width: 256, height: 256 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 56,
          background: "linear-gradient(180deg, #492a20 0%, #17100b 70%)",
        }}
      >
        <svg width="225" height="225" viewBox="0 0 32 32" fill="none">
          <defs>
            {/* CassetteIcon2 mark gradient (P3 0.910/0.483/0.193 -> 0.910/0.361/0.227) */}
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
