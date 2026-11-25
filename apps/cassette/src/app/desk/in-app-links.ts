/**
 * Where a link to one of the website's pages goes from inside the computer app's window. Pure.
 *
 * The app is built from the player screens alone (the public copy, board #1207): it has the desk and its
 * own screens, never the website's pages. So inside the app a website link goes to the desk's own screen
 * for the same thing when there is one, and otherwise opens the website in the person's browser, the way
 * Studio and Admin already do (the founder, 2026-11-25). In a browser the website has every page, so only
 * the album and artist rule applies there (DeskShell's link catcher).
 */
import { TASTE } from "@/app/_taste/links";
import { DESK } from "./types";

export type InApp =
  /** the desk's own screen for it */
  | { to: "desk"; path: string }
  /** a station, looked into in the side view (the desk has no station page of its own) */
  | { to: "station"; slug: string }
  /** a page only the website has: in the person's browser, at this address on the website */
  | { to: "outside"; path: string }
  /** not a website page (the desk's own, the hub's, a fragment, another site): left to the browser engine */
  | null;

/** What the app's own server answers: the desk, pairing, the hub and cloud relays, the old library's
 *  redirects, sign-in. A link to any of these stays as it is. */
const APP_OWN = /^\/(desk|desktop|sidecar|api|_next|sign-in|dashboard)(\/|$)/;

/** The album and artist pages, under the taste prefix while they had one. */
const PAGE = new RegExp(`^(?:${TASTE.replace(/[/]/g, "\\/")})?/(album|artist)/(.+)$`);

/** The website's settings panes the desk has its own copy of (app/desk/settings/*). */
const DESK_SETTINGS = new Set(["account", "appearance", "hidden", "purchases"]);

const STATION = /^[a-z0-9-]{1,120}$/;

/**
 * @param href  the link's own address as written (`a.getAttribute("href")`, a router target), not the
 *              resolved one
 * @param inApp true inside the app's window; in a browser only album and artist links change
 */
export function inAppTarget(href: string, inApp: boolean): InApp {
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  const page = href.match(PAGE);
  if (page) return { to: "desk", path: `${DESK}/${page[1]}/${page[2]}` };
  if (!inApp || APP_OWN.test(href)) return null;

  const cut = href.search(/[?#]/);
  const path = (cut < 0 ? href : href.slice(0, cut)).replace(/\/+$/, "") || "/";
  const query = cut < 0 || href[cut] !== "?" ? "" : href.slice(cut).replace(/#.*$/, "");
  const parts = path.split("/").filter(Boolean);

  if (path === "/") return { to: "desk", path: DESK };
  if (parts[0] === "radio" && parts.length === 1) return { to: "desk", path: `${DESK}/radio` };
  if (parts[0] === "radio" && parts.length === 2 && STATION.test(parts[1])) return { to: "station", slug: parts[1] };
  if (path === "/discover") return { to: "desk", path: `${DESK}/discover` };
  if (path === "/search") return { to: "desk", path: `${DESK}/search${query}` };
  if (path === "/settings") return { to: "desk", path: `${DESK}/settings/account` };
  if (parts[0] === "settings" && parts.length === 2 && DESK_SETTINGS.has(parts[1])) return { to: "desk", path: `${DESK}/settings/${parts[1]}` };
  return { to: "outside", path: href };
}
