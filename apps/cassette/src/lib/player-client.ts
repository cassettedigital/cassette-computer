import "server-only";
import { headers } from "next/headers";
import { PUBLIC_SITE_URL } from "@/lib/urls";
import { localRequestRefusal } from "@/lib/desktop-local-guard";
import { fetchCloud } from "@/lib/cloud-fetch";

/**
 * Token-mode transport — the desktop half of the device-token migration (Move 3).
 *
 * When the local server runs as a paired desktop client it carries a per-device
 * bearer token (from the OS keychain, handed in via env) instead of the
 * production DATABASE_URL. In that mode, server components fetch their data from
 * the cloud over the token instead of querying the database directly.
 *
 * `createLazyDb` only connects on first query, so a token-mode server boots fine
 * with no DATABASE_URL — as long as the pages it renders route their reads
 * through `fetchPlayer` instead of touching `db`. That is what lets the shipped
 * desktop drop the database credential entirely (Move 4).
 *
 * Env:
 *   CASSETTE_PLAYER_TOKEN  — the device bearer token (presence = token mode)
 *   CASSETTE_CLOUD_BASE    — origin that serves the token'd API + owns the DB
 *                            (defaults to production)
 */

const RAW_TOKEN = process.env.CASSETTE_PLAYER_TOKEN?.trim();

/** The device bearer token, or null when this server is the normal DB-backed web app. */
export const DESKTOP_TOKEN: string | null =
  RAW_TOKEN && RAW_TOKEN.length > 0 ? RAW_TOKEN : null;

/** Cloud origin that serves `/api/player/*` and owns the database. */
export const CLOUD_BASE: string =
  process.env.CASSETTE_CLOUD_BASE?.trim().replace(/\/$/, "") || PUBLIC_SITE_URL;

/** True when this server runs as a token-authenticated desktop client (no local DB). */
export function isTokenMode(): boolean {
  return DESKTOP_TOKEN !== null;
}

/**
 * Refuse to spend the token on a render a website asked for (BUG-774). A page
 * reached through DNS rebinding arrives with the site's own Host, and its reply
 * would otherwise carry the person's account into that site. Host only: the
 * app's window never navigates here from another site, and a cross-site
 * navigation shows the page to the person, not to the site. Outside a request
 * (nothing to check) it lets the call through.
 */
export async function assertLocalRender(): Promise<void> {
  let h: Headers;
  try {
    h = await headers();
  } catch {
    return;
  }
  if (localRequestRefusal(h, { checkOrigin: false })) {
    throw new Error("refused: not the Cassette app's own window");
  }
}

/**
 * Fetch JSON from the cloud's token'd API with the device token. Returns null on
 * 404 (missing / gated entity), throws on other non-2xx so the caller surfaces a
 * real error rather than a silently-empty page.
 */
export async function fetchPlayer<T>(path: string): Promise<T | null> {
  if (!DESKTOP_TOKEN) {
    throw new Error("fetchPlayer called outside token mode (no CASSETTE_PLAYER_TOKEN)");
  }
  await assertLocalRender();
  // Gives up after 15 s with no answer, so a page shows its error instead of
  // hanging on a dead network (BUG-782).
  const res = await fetchCloud(`${CLOUD_BASE}${path}`, {
    headers: { Authorization: `Bearer ${DESKTOP_TOKEN}` },
    // Live cloud read; the local library/hub data is unaffected and stays local.
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`player fetch ${path} -> ${res.status}`);
  }
  return (await res.json()) as T;
}
