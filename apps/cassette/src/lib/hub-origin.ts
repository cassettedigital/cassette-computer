/**
 * Where this page reaches the person's own hub (the sidecar on their computer), or nowhere.
 *
 * - The desktop app: `/sidecar`, a same-origin route its own local server forwards to the hub
 *   (app/sidecar/[...path]/route.ts), so no browser rule applies.
 * - Local development: NEXT_PUBLIC_SIDECAR_URL=http://127.0.0.1:5173, a plain page talking to loopback.
 * - The website in a regular browser: nowhere. Its music pages point people to the app instead
 *   (the founder, 2026-10-29). A secure public page reaching into the computer needed one shared
 *   certificate for local.cassette.digital whose private key went to every copy (grounds for revoking
 *   it), Safari blocks the plain alternative, and Chrome asks permission before a website reaches apps
 *   on the computer. So no request, image or probe leaves a browser for the hub: nothing to prompt
 *   for, nothing to renew.
 */

/** The hub's base address for this page, or null where the page can't reach one (the website). */
export const SIDECAR_URL: string | null = process.env.NEXT_PUBLIC_SIDECAR_URL || null;

/** The desktop app's same-origin route to its own hub. */
export const SIDECAR_SAME_ORIGIN = SIDECAR_URL?.startsWith("/") ?? false;

/** Whether this page can reach a hub at all: false on the website in a regular browser. */
export const HUB_IN_REACH = SIDECAR_URL !== null;

/** A hub address for an <img> or a link, or null where there is no hub to ask. */
export function hubURL(path: string): string | null {
  return SIDECAR_URL === null ? null : `${SIDECAR_URL}${path}`;
}

/**
 * fetch() against the hub. Where the page can't reach one it rejects without making any request, so
 * every caller's unreachable path (they are all fail-soft) runs and nothing leaves the browser.
 */
export function hubFetch(path: string, init?: RequestInit): Promise<Response> {
  if (SIDECAR_URL === null) return Promise.reject(new Error("no hub in reach of this page"));
  return fetch(`${SIDECAR_URL}${path}`, init);
}
