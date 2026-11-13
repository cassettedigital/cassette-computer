"use client";

/**
 * DashboardNavOverlay — instant feedback for "enter the dashboard".
 *
 * Mounted once in Providers. When a user clicks a link into /dashboard from
 * OUTSIDE the dashboard (marketing nav, BuyDirect CTA, help back-link, etc.), it
 * paints a full-screen dashboard shell skeleton immediately — client-side, no
 * server round-trip — so the marketing page never just sits there while the
 * dynamic dashboard route resolves. It clears the instant the real dashboard
 * commits (the pathname becomes /dashboard*), handing off to the real shell
 * (whose own SidebarSkeleton + home skeleton then stream).
 *
 * Intra-dashboard navigations are intentionally ignored — those are already
 * covered by the dashboard's route-level loading.tsx.
 */

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DashboardShellSkeleton } from "./skeleton";
import styles from "./DashboardNavOverlay.module.css";

// Failsafe: if a navigation never commits (cancelled, error, blocked), don't trap
// the user under the overlay forever.
const MAX_VISIBLE_MS = 12000;

export function DashboardNavOverlay() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Arrived (or moved anywhere new) → tear the overlay down.
  useEffect(() => {
    setActive(false);
  }, [pathname]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const anchor = (e.target as Element | null)?.closest?.("a");
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href");
      if (!href || !href.startsWith("/dashboard")) return;
      // Already inside the dashboard → the route's loading.tsx handles it.
      if (pathname.startsWith("/dashboard")) return;

      setActive(true);
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname]);

  // Failsafe auto-dismiss.
  useEffect(() => {
    if (!active) {
      if (timer.current) clearTimeout(timer.current);
      return;
    }
    timer.current = setTimeout(() => setActive(false), MAX_VISIBLE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [active]);

  if (!active) return null;

  return (
    <div className={styles.overlay} role="status" aria-busy="true" aria-label="Loading your library">
      <DashboardShellSkeleton />
    </div>
  );
}
