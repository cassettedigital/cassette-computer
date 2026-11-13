/**
 * The real marks, nothing hand-drawn (moved here unchanged from home-taste/Brand.tsx). The cassette
 * mark is public/logo-mark.svg's canonical geometry (frame, two reels, the line of tape across their
 * tops). The app icon is the CassetteIcon2 tile: a warm brown gradient with the mark in an orange
 * gradient, the same drawing src/app/icon.tsx makes for the browser tab and the home screen.
 *
 * The mark on its own (LogoMark) is drawn in the icon's own orange gradient wherever it stands, so the
 * logo in a window is the logo on the iPhone's and the Mac's home screens (founder, 2026-11-12: the flat
 * interface orange read "dreary and sad" beside the icon). It is the brand, not the accent, so a colour
 * skin does not move it, as it does not move the app icon.
 */

import { useId } from "react";

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

export function LogoMark({ className }: { className?: string }) {
  const id = `${useId().replace(/[^a-zA-Z0-9]/g, "")}mark`;
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      fill="none"
      stroke={`url(#${id})`}
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

export function AppIcon({ className, label }: { className?: string; label?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
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
          <stop offset="0" stopColor="#492a20" />
          <stop offset="0.7" stopColor="#17100b" />
        </linearGradient>
        <MarkGradient id={`${id}mark`} />
      </defs>
      <rect width="64" height="64" rx="14" fill={`url(#${id}tile)`} />
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
