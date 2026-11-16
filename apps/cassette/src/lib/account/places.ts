/**
 * The website's account window (app/account): its places, which one /account reopens, and what the strip at
 * the top of every place says about this person's computer. Pure, so it is tested on its own (places.test.ts),
 * and safe on the server and in the browser.
 *
 * The window is the website's own, a different thing from the library (the founder, 2026-11-08): a person's
 * music plays only in the Cassette app on their own computer, so the website never draws their records as a
 * library. Its places are Discover, Radio, Reviews, Stats and Invite friends, in that order. Radio is the Mac app's
 * own Radio page (the founder, 2026-11-09: "exactly as it is in desktop view"), the one thing on the website that
 * plays. Invite friends holds a member's three invite links (lib/account/invites.ts, the founder 2026-11-09).
 *
 *   sticky      /account reopens the place this person used last: the window writes PLACE_COOKIE when a
 *               place opens, and /account reads it on the server, so nothing flashes. Discover by default.
 *               Until they're set up it opens Setup instead (lib/account/setup), which isn't one of the places:
 *               it leads the rail only until then, and is never the place remembered.
 *   the zone    the window also writes the browser's time zone (ZONE_COOKIE), so Stats can count "this
 *               month" and "evenings" in the person's own time, on the server.
 *   computer    at the rail's foot once one is paired: its name, and on while it has checked in within the
 *               last 15 minutes (lib/device-status, the same window the devices page uses), when a click opens
 *               the window the Cassette app serves on that computer. Before one is paired, Setup says how.
 */

import { deviceLight } from "../device-status";

export const ACCOUNT_PLACES = ["discover", "radio", "reviews", "stats", "invites"] as const;
export type AccountPlace = (typeof ACCOUNT_PLACES)[number];

export const DEFAULT_PLACE: AccountPlace = "discover";

/** The place /account reopens, written by the window when a place opens (path /account, a year). */
export const PLACE_COOKIE = "cassette-account-place";
/** The browser's own time zone, written by the window, read by Stats. */
export const ZONE_COOKIE = "cassette-zone";

/** Where a place lives. */
export const placeHref = (place: AccountPlace) => `/account/${place}`;

/** The place a cookie names, or the default for anything else (missing, old, tampered with). */
export function placeFrom(value: string | null | undefined): AccountPlace {
  return (ACCOUNT_PLACES as readonly string[]).includes(value ?? "") ? (value as AccountPlace) : DEFAULT_PLACE;
}

/** The place an address is in (anything under it counts), or null outside the places (/account itself). */
export function placeOf(pathname: string | null | undefined): AccountPlace | null {
  const seg = /^\/account\/([^/?#]+)/.exec(pathname ?? "")?.[1];
  return seg && (ACCOUNT_PLACES as readonly string[]).includes(seg) ? (seg as AccountPlace) : null;
}

/** A time zone the cookie names, when it is one this runtime knows; null otherwise. */
export function zoneFrom(value: string | null | undefined): string | null {
  let zone = value?.trim();
  // the window writes it escaped ("America%2FChicago"); a reader may or may not have unescaped it
  if (zone?.includes("%")) {
    try {
      zone = decodeURIComponent(zone);
    } catch {
      return null;
    }
  }
  if (!zone || zone.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(zone)) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

/** The window the Cassette app serves on the person's own computer (the desktop app's local server). */
export const APP_WINDOW_URL = "http://localhost:41730";

/** A computer's name as the desk says it (desk/data.ts): its network name without ".local", dashes as spaces. */
export function computerName(host: string | null | undefined): string {
  const name = (host ?? "").trim().replace(/\.local$/i, "").replace(/-/g, " ").trim();
  return name || "your computer";
}

export type ComputerRow = { lanHostname: string | null; lastSeenAt: Date | string | null };

export type ComputerState =
  /** no computer paired: the get-the-app strip */
  | { kind: "none" }
  /** checked in within the window: "Open on <name>" */
  | { kind: "on"; name: string; seen: string }
  /** paired, not on lately: the strip says nothing */
  | { kind: "off"; name: string };

/** "Checked in just now", "Checked in 1 minute ago", "Checked in 12 minutes ago". */
export function checkedIn(lastSeenAt: Date | string, now: number): string {
  const at = lastSeenAt instanceof Date ? lastSeenAt.getTime() : new Date(lastSeenAt).getTime();
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return "Checked in just now";
  return `Checked in ${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
}

export function computerState(row: ComputerRow | null | undefined, now: number = Date.now()): ComputerState {
  if (!row) return { kind: "none" };
  const name = computerName(row.lanHostname);
  if (row.lastSeenAt != null && deviceLight(row.lastSeenAt, "player", now) === "live") {
    return { kind: "on", name, seen: checkedIn(row.lastSeenAt, now) };
  }
  return { kind: "off", name };
}
