/**
 * Who gets the desk, and who may download the apps: the one place both are answered (the page
 * infrastructure audit, step 2e). Pure, so it is tested on its own (access.test.ts): callers hand in the
 * account they have already read, and nothing here reads the session or the database.
 *
 * The desk rule gives two answers (mayEnterDesk: the desk's pages and its cloud routes; libraryRetiredFor:
 * the old library sends them to the desk). While the desk was the beta's they differed on a local dev
 * server; now that every account gets it they agree everywhere.
 */

import { deskPathFor, type LibraryWhere } from "./retired-library";

/** The part of an account these answers read (users.is_beta_tester). */
export type DeskAccount = { isBetaTester: boolean };

/**
 * Every account gets the desk (Q1, the founder 2026-11-06: "we're moving everything to our newer, cleaner
 * system"). It was the beta's alone; new accounts start off the beta, so invited newcomers landed in the old
 * library, where Discover, Mixtape and the menu bar break inside the app (BUG-783). The beta box still gates
 * the beta's other things; the account stays in the signature so a later rule can read it again.
 */
export function getsDesk(_account: DeskAccount): boolean {
  return true;
}

/** May open the desk's pages and cloud routes: anyone who gets the desk, or anyone signed in on a local dev server. */
export function mayEnterDesk(account: DeskAccount, nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
  return getsDesk(account) || nodeEnv !== "production";
}

/** The old library is retired for them: its pages the desk has replaced send them to the desk. Same on a dev server. */
export function libraryRetiredFor(account: DeskAccount): boolean {
  return getsDesk(account);
}

/**
 * Where a request for an old library page goes on the desk, or null to show the page. `requested` is the
 * address with its query; `?old=1` keeps the old page, for looking at it on purpose. `where` is the desktop
 * app or the website (the account pages move to the desk only in the app, retired-library.ts).
 */
export function retiredLibraryTarget(requested: string, where: LibraryWhere = "app"): string | null {
  const q = requested.indexOf("?");
  const pathname = q < 0 ? requested : requested.slice(0, q);
  if (q >= 0 && new URLSearchParams(requested.slice(q)).get("old") === "1") return null;
  return deskPathFor(pathname, where);
}

/**
 * The dashboard layout's answer: where this account's request goes instead, or null to show it. No
 * account (signed out, unverified) is left to the dashboard's own gate; no address (the middleware didn't
 * hand one over) shows the page.
 */
export function retiredLibraryRedirect(account: DeskAccount | null, requested: string | null, where: LibraryWhere = "app"): string | null {
  if (!account || !requested || !libraryRetiredFor(account)) return null;
  return retiredLibraryTarget(requested, where);
}

/** Flip to true to open the apps' downloads to everyone, signed in or not (post-alpha). */
export const DOWNLOAD_PUBLIC = false;

/**
 * May download the apps that are out (config/release.ts says which): every signed-in account. The founder's
 * call (2026-10-30): access to the apps is decided at account creation, which is invite-only, so anyone let
 * in may use any app we've made available. A separate question from the desk.
 */
export function mayGetApps(account: { id: string } | null, open: boolean = DOWNLOAD_PUBLIC): boolean {
  if (open) return true;
  return account !== null;
}
