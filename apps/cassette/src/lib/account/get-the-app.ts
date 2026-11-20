/**
 * Which app the account window's get-the-app strip offers first: the download for the computer the page is
 * open on (the brand rule: platform names on download keys only), the other computer apps after it, and on a
 * phone no download at all (Cassette runs on the computer where the music is). The same reading of the
 * browser as the desk's old website home (desk/Away.tsx, retired on the website 2026-11-08), here on its own
 * so it is tested (get-the-app.test.ts). Pure: the caller hands in the browser's navigator.
 */

import { RELEASE, type PlatformRelease } from "../../config/release";

export type Download = PlatformRelease & { downloadUrl: string };

/** The computer apps with a real build to hand out (config/release.ts), in its order. */
export const DESKTOP_DOWNLOADS: Download[] = [RELEASE.macos, RELEASE.windows].filter(
  (r): r is Download => r.status === "available" && r.downloadUrl !== null,
);

export type System = "macos" | "windows" | "phone" | "other";

export type NavigatorLike = {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: { platform?: string };
};

/** The kind of computer a browser is on. An iPad asking for the desktop site says "Mac" with a touch screen. */
export function systemOf(nav: NavigatorLike): System {
  const ua = nav.userAgent.toLowerCase();
  if (/iphone|ipad|android/.test(ua) || (/mac/.test(ua) && (nav.maxTouchPoints ?? 0) > 1)) return "phone";
  const os = (nav.userAgentData?.platform || nav.platform || ua).toLowerCase();
  if (os.includes("win")) return "windows";
  if (os.includes("mac")) return "macos";
  return "other";
}

/** The download to lead with on this computer (null when there's none for it), then the rest. */
export function downloadsFor(system: System, all: Download[] = DESKTOP_DOWNLOADS): { mine: Download | null; rest: Download[] } {
  const mine = all.find((r) => r.platform === system) ?? null;
  return { mine, rest: all.filter((r) => r !== mine) };
}
