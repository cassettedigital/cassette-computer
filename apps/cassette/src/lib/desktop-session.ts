import "server-only";

/**
 * Token-mode identity loader — the desktop half of the device-token session.
 *
 * A paired desktop server runs with a per-device bearer and NO DATABASE_URL, so
 * its auth layer is the DB-less stub (auth() → null). This module fetches the
 * paired account's real identity from the cloud over that token, via the same
 * device token the album/artist pages use (lib/offline-copies askCloud, which also keeps a copy of
 * each good answer for when the cloud doesn't answer, BUG-542). The root layout turns it
 * into a client session; the dashboard gate turns it into an AuthedUser.
 *
 * Token-mode ONLY — `askCloud` throws without a token, so callers must gate
 * on `isTokenMode()` before calling `loadDashboardShell`. On the web this file
 * is never reached.
 */

import { cache } from "react";
import { askCloud } from "@/lib/offline-copies";
import type { DashboardRailData } from "@/lib/player-answers";

/**
 * The identity payload from GET /api/player/dashboard-shell. `emailVerified`
 * arrives as a JSON ISO string (or null) because it crosses the wire.
 */
export type DashboardShell = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  username: string | null;
  isAdmin: boolean;
  isCreator: boolean;
  /** whether the account menu offers Studio, by the Studio door's own rule (api/player/dashboard-shell); absent from an older cloud */
  studio?: boolean;
  /** whether the account has bought an album here, for the menu's Purchases (api/player/dashboard-shell); absent from an older cloud */
  hasPurchases?: boolean;
  avatarPreset: string;
  emailVerified: string | null;
  themeId: string;
  iconId: string;
  isBetaTester: boolean;
};

/**
 * The paired account's identity over the device token (BUG-542). A reply is used and kept on this Mac;
 * a refusal (401/403: a revoked or foreign token) is signed out and drops every kept copy; no reply
 * (offline, a timeout, a server error) carries on as the account from the kept copy, so the app still
 * opens on the music on this Mac. Null only when signed out, or offline with nothing kept yet.
 * Read once per request (the root layout and the gates all ask).
 */
const shellAnswer = cache(() => askCloud<DashboardShell>("/api/player/dashboard-shell"));

export async function loadDashboardShell(): Promise<DashboardShell | null> {
  return (await shellAnswer()).value;
}

/** True when this request's identity came from the kept copy because the cloud didn't answer. */
export async function shellIsOffline(): Promise<boolean> {
  return (await shellAnswer()).offline;
}

/**
 * The paired account's dashboard rail (playlists / devices / counts / flags) over the device token,
 * with the same kept copy for when the cloud doesn't answer. Null on a refusal or with nothing kept,
 * so <SidebarData> degrades to an empty rail rather than throwing a 500 through the layout.
 * Token-mode ONLY.
 */
export async function loadDashboardRail(): Promise<DashboardRailData | null> {
  try {
    return (await askCloud<DashboardRailData>("/api/player/dashboard-rail")).value;
  } catch {
    return null;
  }
}
