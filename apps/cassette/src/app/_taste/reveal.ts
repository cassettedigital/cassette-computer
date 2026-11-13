"use client";

/**
 * One observer marks everything tagged data-reveal as data-shown once it scrolls into view, the same on
 * every taste page (it was written into proto/taste's shell and, value for value, into the homepage's
 * TasteHome). Nothing animates by default: a focal section reacts to data-shown in its own CSS. The
 * MutationObserver picks up nodes that mount later (a client navigation, a section that loads in), so
 * nothing is left waiting.
 */

import { useEffect, type RefObject } from "react";

export function useReveal(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          (entry.target as HTMLElement).dataset.shown = "";
          io.unobserve(entry.target);
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -6% 0px" },
    );
    root.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches("[data-reveal]:not([data-shown])")) io.observe(node);
          node.querySelectorAll("[data-reveal]:not([data-shown])").forEach((el) => io.observe(el));
        });
      }
    });
    mo.observe(root, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      io.disconnect();
    };
  }, [rootRef]);
}
