"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { markScrollbarOs } from "@/lib/platform-scrollbars";
import { appOpensPages, inPanelFrame, isAppUserAgent, markAppSurface, openInApp, type PanelHears, type PanelSays } from "@/lib/app-surface";

/**
 * The page's side of the iPhone app (lib/app-surface), once the page is up:
 *
 * - The mark. The root's first-paint script marks a page as the app's before it draws. A page the browser draws
 *   itself from an error shell (a missing album or artist) never runs that script, so the site's own chrome and
 *   homepage link showed inside the app (BUG-641). This marks it again.
 * - Links. From CassetteApp/3, a tap on a link to another page of the site hands the app the address instead of
 *   moving, so each page is its own screen, with its own back, and an album or artist the person owns opens from
 *   their library (BUG-640). It listens ahead of the page's own links (capturing, on the window), so a Next link
 *   never moves the page underneath.
 *
 * And of the account window's side panel (PANEL_FRAME), where Discover shows a record's or an artist's own page:
 * an album or artist page stays in the panel; any other page of the site, however it's reached, opens in the
 * window around it; another site opens in a new tab; the page tells the window where it is (for Back and Open full page) and that Escape
 * was pressed, and when the page's own title has scrolled out of sight; and the window can move it (a record
 * picked from the shelves) or have it fetch a page ahead (a cover pointed at).
 *
 * Anywhere else it does nothing.
 */
export function AppSurface() {
  useEffect(() => {
    markScrollbarOs(); // thin scroll bars on Windows and Linux (globals.css), whatever page this is
    if (!isAppUserAgent(navigator.userAgent)) return;
    markAppSurface();
    if (!appOpensPages(navigator.userAgent)) return;
    function onClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(a instanceof HTMLAnchorElement) || a.hasAttribute("download")) return;
      if (a.target && a.target !== "_self") return;
      if (openInApp(a.href, a.textContent?.trim() || undefined)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, []);
  return <PanelSurface />;
}

/** The pages a panel keeps: a record's, an artist's and a station's (opened from Radio). */
const STAYS = /^\/(album|artist|radio)\/[^/]+\/?$/;

function tell(said: PanelSays) {
  window.parent.postMessage(said, window.location.origin);
}

function PanelSurface() {
  const router = useRouter();
  const path = usePathname();

  // where it is: on every move, and again when the page's title arrives. A page that isn't a record's, an
  // artist's or a station's (the dial, a writer, signing in) opens in the window around the panel instead, however
  // it was reached: a link, a key that moves the page itself, a redirect.
  useEffect(() => {
    if (!inPanelFrame()) return;
    if (!STAYS.test(window.location.pathname)) {
      window.top?.location.assign(window.location.href);
      return;
    }
    const say = () => tell({ cassettePanel: "at", path: window.location.pathname, title: document.title });
    say();
    const titleEl = document.querySelector("head > title");
    const watch = new MutationObserver(say);
    if (titleEl) watch.observe(titleEl, { childList: true, characterData: true, subtree: true });
    else watch.observe(document.head, { childList: true });
    // the page's own name (its h1): once it scrolls out of sight the window's bar takes it up. Read on scroll,
    // not watched, since a page moved to inside the panel draws its h1 after this runs.
    let last: boolean | null = null;
    const check = () => {
      const h1 = document.querySelector("main h1") ?? document.querySelector("h1");
      const gone = !!h1 && h1.getBoundingClientRect().bottom < 0;
      if (gone === last) return;
      last = gone;
      tell({ cassettePanel: "head", gone });
    };
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(check);
    };
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      watch.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, [path]);

  useEffect(() => {
    if (!inPanelFrame()) return;
    // another site (a store, a critic) opens in a new tab, never in the panel
    function onClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(a instanceof HTMLAnchorElement) || a.hasAttribute("download") || a.target === "_blank") return;
      let url: URL;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin === window.location.origin || !/^https?:$/.test(url.protocol)) return;
      e.preventDefault();
      e.stopPropagation();
      window.open(url.href, "_blank", "noopener");
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable)) return;
      tell({ cassettePanel: "close" });
    }
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin || e.source !== window.parent) return;
      const heard = e.data as PanelHears | null;
      // the radio's own word is the radio provider's to hear (RadioProvider), not a page to go to
      if (!heard || (heard.cassettePanel !== "go" && heard.cassettePanel !== "prefetch") || !STAYS.test(heard.path)) return;
      if (heard.cassettePanel === "go") router.push(heard.path);
      // a cover pointed at on the shelves: its whole page, ready before the click (kept five minutes)
      else if (heard.cassettePanel === "prefetch") router.prefetch(heard.path, { kind: "full" } as unknown as Parameters<typeof router.prefetch>[1]);
    }
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("message", onMessage);
    };
  }, [router]);

  return null;
}
