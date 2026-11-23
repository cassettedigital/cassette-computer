/**
 * The real marks, nothing hand-drawn (moved here unchanged from home-taste/Brand.tsx). The cassette
 * mark is public/logo-mark.svg's canonical geometry (frame, two reels, the line of tape across their
 * tops). The app icon is the CassetteIcon2 tile with the mark in an orange gradient, drawn here in the
 * website's app-icon material (the kit's appIcon, which the page titles' tile wears too). The browser tab's and
 * the home screen's icons (src/app/icon.tsx, apple-icon.tsx) keep the native icon's own flat colours: they sit
 * beside it, and the material can't be seen at their sizes.
 *
 * The mark on its own (LogoMark) is drawn in the icon's own orange gradient wherever it stands, so the
 * logo in a window is the logo on the iPhone's and the Mac's home screens (founder, 2026-11-12: the flat
 * interface orange read "dreary and sad" beside the icon). It is the brand, not the accent, so a colour
 * skin does not move it, as it does not move the app icon.
 */

import { useId } from "react";
import { APP_ICON } from "@discovery/cassette-kit/app-icon";

/** The app icon's mark gradient (CassetteIcon2's icon.json, Display P3 taken to sRGB), top to bottom. */
export const ICON_MARK_TOP = "#f97408";
export const ICON_MARK_BOTTOM = "#fb4f29";

function MarkPaths() {
  return (
    <>
      <rect x="3" y="8" width="26" height="16" rx="3.5" />
      <circle cx="11.5" cy="16" r="3" />
      <circle cx="20.5" cy="16" r="3" />
      <path d="M11.798 13.012L20.213 13.012" />
    </>
  );
}

/** The icon's mark gradient, in the mark's own units (one pass from the frame's top, y 8, to its foot, y 24). */
function MarkGradient({ id }: { id: string }) {
  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="16" y1="8" x2="16" y2="24">
      <stop offset="0" stopColor={ICON_MARK_TOP} />
      <stop offset="1" stopColor={ICON_MARK_BOTTOM} />
    </linearGradient>
  );
}

/** The mark: in its gradient, or (`tone="white"`) plain white, for a dark ground the gradient wouldn't read on. */
export function LogoMark({ className, tone = "gradient" }: { className?: string; tone?: "gradient" | "white" }) {
  const id = `${useId().replace(/[^a-zA-Z0-9]/g, "")}mark`;
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      fill="none"
      stroke={tone === "white" ? "#fff" : `url(#${id})`}
      strokeWidth="2.2"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <MarkGradient id={id} />
      </defs>
      <MarkPaths />
    </svg>
  );
}

/**
 * The app icon: the tile in the kit's app-icon material (tokens.json appIcon, the founder's pick on 2026-11-23),
 * its calm lacquer body and the hint of light from behind the glass along its edge, with the mark flat on it. The
 * edge light keeps the page-title tile's pixel floors at the size it is drawn (`px`, the footer's 28 by default),
 * so it stays a soft glow and never thins to a hairline; the kit's angular mask is drawn here as two soft pools at
 * the corners it lights (the top left and the bottom right). The sheen is left out: at 28px it can't be seen.
 */
export function AppIcon({ className, label, px = 28 }: { className?: string; label?: string; px?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const { body, edge } = APP_ICON;
  const unit = 64 / px; // drawing units to a pixel, at the size it is drawn
  const off = Math.max(edge.offset * 64, edge.minPx[0] * unit);
  const blur = Math.max(edge.blur * 64, edge.minPx[1] * unit);
  // everything outside the tile, moved by d: blurred and clipped back to the tile, it is the light along its edge
  const outside = (d: number) => `M-64 -64H128V128H-64Z M${d} ${d + 14}a14 14 0 0 1 14-14h36a14 14 0 0 1 14 14v36a14 14 0 0 1-14 14h-36a14 14 0 0 1-14-14z`;
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}tile`} x1="0" y1="0" x2="0" y2="1">
          {body.map(([color, at]) => (
            <stop key={at} offset={at} stopColor={color} />
          ))}
        </linearGradient>
        <MarkGradient id={`${id}mark`} />
        <clipPath id={`${id}clip`}>
          <rect width="64" height="64" rx="14" />
        </clipPath>
        <filter id={`${id}soft`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={blur / 2} />
        </filter>
        {[0, 64].map((at) => (
          <radialGradient key={at} id={`${id}pool${at}`} gradientUnits="userSpaceOnUse" cx={at} cy={at} r="46">
            <stop offset="0" stopColor="#fff" />
            <stop offset="0.45" stopColor="#fff" stopOpacity="0.6" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
        ))}
        <mask id={`${id}pools`}>
          <rect width="64" height="64" fill={`url(#${id}pool0)`} />
          <rect width="64" height="64" fill={`url(#${id}pool64)`} />
        </mask>
      </defs>
      <rect width="64" height="64" rx="14" fill={`url(#${id}tile)`} />
      <g clipPath={`url(#${id}clip)`} mask={`url(#${id}pools)`}>
        <g filter={`url(#${id}soft)`}>
          <path fillRule="evenodd" fill={edge.lead[0]} fillOpacity={edge.lead[1]} d={outside(off)} />
          <path fillRule="evenodd" fill={edge.trail[0]} fillOpacity={edge.trail[1]} d={outside(-off)} />
          <path fillRule="evenodd" fill={edge.around[0]} fillOpacity={edge.around[1]} d={outside(0)} />
        </g>
      </g>
      {/* the mark fills 88% of the tile, centered, like the native icon */}
      <g
        transform="translate(3.875 3.875) scale(1.758)"
        fill="none"
        stroke={`url(#${id}mark)`}
        strokeWidth="2.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <MarkPaths />
      </g>
    </svg>
  );
}
