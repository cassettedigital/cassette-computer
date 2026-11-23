/**
 * The iPhone app shows some of the site's pages inside itself (a record the radio
 * is playing, today), in its own screen with its own back button. Those pages
 * drop the site's menus, footer and breadcrumb, because the app is the frame.
 *
 * The app's web view adds APP_UA_TOKEN to its user agent. A tiny script in the
 * root layout (APP_SURFACE_SCRIPT) sees it before first paint and sets
 * html[data-surface="app"]; globals.css hides the site's chrome under it. The
 * same script sets html[data-paper="dark"] for apps up to CassetteApp/3, which are
 * dark-only, so a page whose paper follows the device (the artist and album pages)
 * holds the dark one inside them. From CassetteApp/4 the app follows light or dark
 * (I-T1, 2026-10-31) and its web view's appearance is the app's, so the page follows
 * it like any browser (DARK_UNTIL_APP_VERSION). Static
 * pages stay static: nothing on the server reads the user agent for this, except
 * a page that is dynamic anyway and needs to change what it renders (previewsOff).
 */

import type { RadioNowPlaying } from "@/lib/radio/types";

export const APP_UA_TOKEN = "CassetteApp";

export function isAppUserAgent(userAgent: string | null | undefined): boolean {
  return !!userAgent && userAgent.includes(`${APP_UA_TOKEN}/`);
}

/**
 * Which window a record page's body is drawn in (page infrastructure step 3d): the website, the iPhone
 * app's web view, or the desktop app's desk. The album and artist bodies share one rule for what a record
 * or artist you don't own offers there (the founder's Decision 6): on the website everything; in the apps
 * Preview, with no song share key and no Claim. A record's Buy stays, and never takes over the window: the
 * desk opens it in the browser, the iPhone's web view hands it to Safari (Q5). Save (an artist's, a record's)
 * is in every window since the founder's Save and Follow model (2026-11-23, board #1162).
 */
export type Surface = "web" | "app" | "desk";

/** The website or the iPhone's web view, from the request's user agent; the desk's pages say "desk" themselves. */
export function surfaceOf(userAgent: string | null | undefined): Exclude<Surface, "desk"> {
  return isAppUserAgent(userAgent) ? "app" : "web";
}

/** The app's version from its user agent ("CassetteApp/2" is 2), or null outside the app. */
export function appVersion(userAgent: string | null | undefined): number | null {
  const m = userAgent?.match(new RegExp(`${APP_UA_TOKEN}/(\\d+)`));
  return m ? Number(m[1]) : null;
}

/**
 * Whether the album and artist pages leave their song previews off: only inside an iPhone app too old to
 * hand the sound over (CassetteApp/1), so the web view never plays over the phone's own player. From
 * CassetteApp/2 a preview plays there with its video on screen (the founder, 2026-10-29, Q11 in
 * docs/CASSETTE_APP_AUDIT.md): one starting tells the app (tellApp), which pauses the phone's music, and
 * leaving the page, locking the phone or starting the phone's music stops it.
 */
export function previewsOff(userAgent: string | null | undefined): boolean {
  const v = appVersion(userAgent);
  return v !== null && v < 2;
}

/**
 * Whether the app opens each page a link leads to as its own screen, from CassetteApp/3 (BUG-640, BUG-641). A page
 * inside it then hands the app the address instead of moving (openInApp, and AppSurface for every link on the page),
 * and the app decides what the tap shows: the person's own copy of an album or artist when their library has it,
 * else the page in a new screen with its own back, and for the homepage a step back instead. Older builds move
 * within their one screen, as before.
 */
export function appOpensPages(userAgent: string | null | undefined): boolean {
  const v = appVersion(userAgent);
  return v !== null && v >= 3;
}

/** Pages that move within their own screen even then: signing in and its steps, and the API. */
const STAYS_IN_SCREEN = /^\/(api|auth|sign-in|sign-up|forgot-password|reset-password|verify-email)(\/|$)/;

/**
 * Inside an app that opens pages itself, hands it `href` (a page on this site) as a new screen and says so. Anywhere
 * else, for another site, for this same page with a different query or hash, or for a sign-in step, false: the
 * caller moves the page as usual. `name` is what the link says, which the app checks against the artists in the
 * person's library.
 */
export function openInApp(href: string, name?: string): boolean {
  if (typeof window === "undefined" || !appOpensPages(navigator.userAgent)) return false;
  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return false;
  }
  if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return false;
  if (STAYS_IN_SCREEN.test(url.pathname)) return false;
  tellApp({ type: "open", path: url.pathname + url.search + url.hash, ...(name ? { name: name.slice(0, 200) } : {}) });
  return true;
}

/** Tells the iPhone app something from a page inside it (its web view listens on "cassette"); a no-op anywhere else. */
export function tellApp(message: { type: "preview-playing" } | { type: "open"; path: string; name?: string }): void {
  try {
    (window as unknown as { webkit?: { messageHandlers?: { cassette?: { postMessage: (m: unknown) => void } } } }).webkit?.messageHandlers?.cassette?.postMessage(message);
  } catch {
    /* not inside the app */
  }
}

/** Apps up to this version are dark-only, so their pages hold the dark paper. */
export const DARK_UNTIL_APP_VERSION = 3;

/**
 * The account window's side panel (account/discover/_parts/RecordFrame) shows the website's own album and artist
 * pages in a frame of this name: the window is the frame there, as the iPhone app is, so the site's chrome steps
 * aside the same way (the first-paint script below, html[data-frame="panel"] beside data-surface="app"). The name
 * stays with the frame as it moves page to page, so every page in it is drawn the same. AppSurface keeps an album
 * or artist link in the panel, sends any other page of the site to the window, and tells the window where it is
 * and whether the page's title is out of sight; the player (PlayerDock) tells it when a preview is docked.
 */
export const PANEL_FRAME = "cassette-panel";

/** What a page in the panel tells the window, and what the window asks of it (window.postMessage, same site). */
export type PanelSays =
  | { cassettePanel: "at"; path: string; title: string }
  /** the page's own title has scrolled out of sight (the window's bar names the record then) */
  | { cassettePanel: "head"; gone: boolean }
  /** a preview is docked (the window gives the page room for the player's rail) */
  | { cassettePanel: "stage"; on: boolean }
  | { cassettePanel: "close" }
  /** the page's Tune in or Stop: the window's own radio plays, never a second one in the panel (null = stop) */
  | { cassettePanel: "radio"; play: string | null }
  /** a station saved or taken back on the page, so the window's own list follows */
  | { cassettePanel: "saved"; slug: string; on: boolean };
export type PanelHears =
  | { cassettePanel: "go"; path: string }
  | { cassettePanel: "prefetch"; path: string }
  /** what the window's radio is doing, so the page's keys say Stop on the station that's on */
  | { cassettePanel: "radio"; slug: string | null; status: "idle" | "connecting" | "playing" | "error"; nowPlaying: RadioNowPlaying | null };

/** Whether this page is in the account window's side panel. */
export function inPanelFrame(): boolean {
  try {
    return typeof window !== "undefined" && window.name === PANEL_FRAME && window.top !== window.self;
  } catch {
    return false;
  }
}

export const APP_SURFACE_SCRIPT =
  `try{var h=document.documentElement,m=navigator.userAgent.match(/${APP_UA_TOKEN}\\/(\\d+)/);if(m){h.setAttribute("data-surface","app");if(parseInt(m[1],10)<=${DARK_UNTIL_APP_VERSION})h.setAttribute("data-paper","dark");}else if(window.name==="${PANEL_FRAME}"&&window.top!==window.self){h.setAttribute("data-surface","app");h.setAttribute("data-frame","panel");}}catch(e){}`;

/**
 * What APP_SURFACE_SCRIPT does, for a page the browser drew itself, where that script never ran (AppSurface): a
 * missing album or artist page comes as an error shell and is drawn on the client.
 */
export function markAppSurface(): void {
  const h = document.documentElement;
  if (h.getAttribute("data-surface") === "app") return;
  h.setAttribute("data-surface", "app");
  const version = appVersion(navigator.userAgent);
  if (version != null && version <= DARK_UNTIL_APP_VERSION) h.setAttribute("data-paper", "dark");
}

/**
 * Where the app's sign-in pass (/api/app-session) may send the web view next: a
 * path on this site, never another site ("//host", "/\\host", a full URL, or a
 * path that smuggles a scheme), else the home page.
 */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (/[\u0000-\u001f]/.test(raw)) return "/";
  try {
    const u = new URL(raw, "https://cassette.digital");
    if (u.origin !== "https://cassette.digital") return "/";
    return u.pathname + u.search + u.hash;
  } catch {
    return "/";
  }
}
