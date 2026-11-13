"use client";

import { useEffect } from "react";

/**
 * The offline helper (public/sw.js: cold-start relief and the offline shell) belongs to the Cassette
 * app's window only. On the website it turned a slow page into the browser's own error page and kept
 * signed-in pages on the device after sign-out (BUG-550), so here it is taken down: any copy a browser
 * registered before is unregistered and its saved pages are deleted. The worker does the same to itself
 * when it is served from anywhere but the app's local address.
 *
 * PRODUCTION ONLY: in dev the worker would fight Next's HMR (stale chunks). Best-effort either way: a
 * failed registration just means no offline copy, never a broken page.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (!("__TAURI__" in window)) {
      navigator.serviceWorker
        .getRegistrations()
        .then((all) => all.forEach((r) => void r.unregister()))
        .catch(() => {});
      if ("caches" in window) {
        caches
          .keys()
          .then((keys) => keys.filter((k) => k.startsWith("cassette-")).forEach((k) => void caches.delete(k)))
          .catch(() => {});
      }
      return;
    }
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* best-effort: no SW just means no cold-start/offline cache */
      });
    };
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);
  return null;
}
