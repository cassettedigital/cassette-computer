"use client";

/**
 * NavProgress — a global 2px indeterminate bar shown during any client-side App
 * Router navigation (spec §4.1 / §5.6). Mounted once in Providers.
 *
 * Next 15 exposes per-link pending state (useLinkStatus) but no global
 * navigation-start event, so we use the documented fallback: capture clicks on
 * internal anchors to start the bar, and treat a usePathname() change as
 * completion. This covers the overwhelmingly common case (clicking a link); it
 * intentionally does not try to instrument programmatic router.push or
 * back/forward, which would need framework internals.
 *
 * A link into /api/ is never a page (a download key, /api/desktop/download/..., hands over a file and the
 * page stays put), so it starts nothing; and any bar that sees no new page within a few seconds clears
 * itself (2026-11-20: after downloading the Mac app the bar slid on forever).
 */

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import styles from "./NavProgress.module.css";

/** How long the bar waits for a new page before it lets go. */
const GIVE_UP_MS = 10_000;

export function NavProgress() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);

  // A completed navigation is signalled by the pathname changing — clear the bar.
  useEffect(() => {
    setActive(false);
  }, [pathname]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      // Only plain left-clicks start a navigation we can observe.
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const anchor = (e.target as Element | null)?.closest?.("a");
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href");
      // Internal app routes only; skip hashes, mailto:, external, same-page.
      if (!href || !href.startsWith("/")) return;
      const [path] = href.split(/[?#]/);
      if (path === pathname) return;
      if (path === "/api" || path.startsWith("/api/")) return;

      // Decide once the click has finished its trip: this listener runs first (capture, on the
      // document), before a link's own handler can claim the click (the desk's tiles select on a
      // click instead of navigating), and a claimed click starts no navigation.
      window.setTimeout(() => {
        if (!e.defaultPrevented) setActive(true);
      }, 0);
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname]);

  // a navigation that never arrives (or a click that turned out not to be one) doesn't keep the bar up
  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(() => setActive(false), GIVE_UP_MS);
    return () => window.clearTimeout(t);
  }, [active]);

  if (!active) return null;

  return (
    <div className={styles.bar} role="presentation" aria-hidden="true">
      <div className={styles.fill} />
    </div>
  );
}
