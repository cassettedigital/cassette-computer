"use client";

/**
 * A jump within the page (a link to "#somewhere" on the page it's on: the radio dial's section keys, a guide's
 * contents, the footer's way back to the top) scrolls there and leaves Back alone.
 *
 * Left to the browser, each such jump adds a step to the history that Next's router didn't make, and the
 * router ignores going back onto a step it didn't make: the address changes and the page stays. Tap a section
 * of the radio dial, open a station, go Back (or swipe back in Safari) and nothing happened (the founder,
 * 2026-11-17). Here the jump rewrites the page's own step instead (Next keeps its record in it), so Back
 * always leaves the page for the one before.
 *
 * One listener for every page (mounted in the root layout), so no link has to remember; a link that handles
 * its own click (preventDefault) is left to it, as is any click that asks for a new tab or a download.
 */

import { useEffect } from "react";

export function InPageLinks() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(a instanceof HTMLAnchorElement) || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const href = a.getAttribute("href") ?? "";
      if (!href.includes("#")) return;
      const url = new URL(a.href, window.location.href);
      const here = window.location;
      if (url.origin !== here.origin || url.pathname !== here.pathname || url.search !== here.search) return;
      const id = decodeURIComponent(url.hash.slice(1));
      const to = id ? document.getElementById(id) : null;
      // "#" and "#top" with nothing of that name mean the top of the page, as they do to the browser
      const top = !to && (id === "" || id.toLowerCase() === "top");
      if (!to && !top) return;
      e.preventDefault();
      const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
      if (to) to.scrollIntoView({ behavior, block: "start" });
      else window.scrollTo({ top: 0, behavior });
      // the page's own step, with the router's record kept, now at this place on the page
      window.history.replaceState(window.history.state, "", url.hash || here.pathname + here.search);
    };
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, []);
  return null;
}
