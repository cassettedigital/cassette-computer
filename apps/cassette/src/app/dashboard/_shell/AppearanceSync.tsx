"use client";

/**
 * AppearanceSync — makes the chosen skin follow the user across devices.
 *
 * The account (users.theme_id / icon_id) is the source of truth for a signed-in
 * user. This mounts in the dashboard auth gate with the account values (already
 * loaded by getVerifiedSessionUser — no extra query) and, on load, reconciles
 * the local cache to them: if you picked Marine on another device, it applies
 * here. A same-device pick is already in localStorage, so it's a no-op (no
 * flicker). Renders nothing.
 *
 * Same-device instant apply + the cross-device WRITE both live in
 * lib/appearance.ts (saveTheme/saveIcon → localStorage + live DOM + PATCH
 * /api/account/appearance); this is only the READ-back on a fresh load.
 */

import { useEffect } from "react";
import { reconcileFromAccount } from "@/lib/appearance";

export function AppearanceSync({ theme, icon }: { theme: string; icon: string }) {
  useEffect(() => {
    reconcileFromAccount(theme, icon);
  }, [theme, icon]);
  return null;
}
