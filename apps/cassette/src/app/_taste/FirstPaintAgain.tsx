"use client";

import { useLayoutEffect } from "react";
import { reapplyFirstPaint } from "@/lib/first-paint";

/**
 * Draws nothing. On a missing page the browser draws the page itself from an error shell, so the root
 * layout's first-paint scripts (the saved skin, light or dark, the diagnostics opt-out) never ran; this puts
 * them on as soon as the page is up. On any page where they did run it does nothing (lib/first-paint.ts, BUG-713).
 */
export function FirstPaintAgain() {
  useLayoutEffect(() => {
    let store: Storage | null = null;
    try {
      store = window.localStorage;
    } catch {
      store = null;
    }
    reapplyFirstPaint(window, document.documentElement, store);
  }, []);
  return null;
}
