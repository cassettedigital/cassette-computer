"use client";

/**
 * FollowAccountLook: the account's skin on every signed-in page, not only the library. The dashboard and
 * the desk are handed the account's skin by the server (AppearanceSync); every other page (the artist and
 * album pages, the homepage, search) only had this browser's own saved copy, so a skin changed on another
 * device never reached them (the founder, 2026-11-06: picked green in the app, went back to orange, and
 * the website stayed green). Once per page load, signed in, this asks the account and reconciles: a
 * same-device pick is already in localStorage, so it changes nothing. Renders nothing.
 *
 * Not in token mode (the desktop's own local server has no database; the desk there is handed the skin),
 * and not on the dashboard or the desk, which already have it from the server.
 */

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { reconcileFromAccount } from "@/lib/appearance";

export function FollowAccountLook({ off = false }: { off?: boolean }) {
  const { status } = useSession();
  const path = usePathname();
  const asked = useRef(false);
  const handed = path?.startsWith("/dashboard") || path?.startsWith("/desk");

  useEffect(() => {
    if (off || handed || status !== "authenticated" || asked.current) return;
    asked.current = true;
    const ctl = new AbortController();
    fetch("/api/account/appearance", { credentials: "include", cache: "no-store", signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((a: { theme_id: string | null; icon_id: string | null } | null) => {
        if (a?.theme_id) reconcileFromAccount(a.theme_id, a.icon_id);
      })
      .catch(() => {
        /* offline or signed out meanwhile: this browser's own copy stands */
      });
    return () => ctl.abort();
  }, [off, handed, status]);

  return null;
}
