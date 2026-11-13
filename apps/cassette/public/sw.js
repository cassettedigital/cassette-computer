/*
 * Cassette service worker — cold-start relief + offline shell (Job 4).
 *
 * What it does, and ONLY this:
 *   - Immutable static assets (/_next/static/*, /fonts/*) → cache-first.
 *   - Other same-origin static files (root public images like /logo-mark.svg, which
 *     are NOT content-hashed) → stale-while-revalidate, so a re-exported asset
 *     self-heals on the next load instead of sticking until VERSION is bumped.
 *   - Same-origin page navigations → network first. The last saved copy of the page
 *     stands in only when the network can't give one: the computer is offline (after a
 *     short wait, or the server answers it with an error), or the app's server can't be
 *     reached. A server that is merely slow is waited for (v4, below).
 *
 * What it NEVER touches (so it can't break correctness or the security line):
 *   - /api/* — that's data; the cloud is the single write-truth and Job 1's
 *     IndexedDB read-cache handles reads. Never cached here.
 *   - Non-GET requests (writes) — always go to the network.
 *   - Cross-origin requests (the sidecar's local covers, the image CDN) — left to
 *     the browser; Job 2's local-cover proxy already handles offline art.
 *
 * Safety: caches are versioned and purged on activate; skipWaiting + clients.claim
 * let an updated worker take over promptly (bump VERSION to invalidate). It holds
 * no credentials and only ever caches responses that already passed the authed
 * API — it is a read accelerator, never a second source of truth.
 *
 * Privacy note: a navigation cache can hold the (single-user) dashboard shell so
 * it works offline. On a shared/multi-user browser this should be cleared on
 * logout — fine for the single-user Cassette Player today.
 *
 * The app's window only (BUG-550). The app serves this file from its own local
 * server; the website serves the same file, and there it does the opposite: it
 * deletes every page and file a browser saved under it and unregisters itself, so
 * a browser that picked it up before keeps nothing (ServiceWorkerRegister.tsx no
 * longer registers it on the website).
 */

const IN_APP = ["127.0.0.1", "localhost"].includes(self.location.hostname);

if (!IN_APP) {
  self.addEventListener("install", () => {
    self.skipWaiting();
  });
  self.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k.startsWith("cassette-")).map((k) => caches.delete(k)));
        await self.registration.unregister();
      })()
    );
  });
}

// Bump to invalidate every cache. v1 cached root public assets (e.g. /logo-mark.svg)
// cache-first forever, so a re-exported mark stayed stale in the header/footer.
// v2→v3: on a cold desktop relaunch the server can exceed NAV_TIMEOUT_MS, so the nav
// cache served a STALE page shell that referenced old CSS hashes (which then loaded
// cache-first from STATIC_CACHE) — the cover-render change looked "not applied".
// Bumping purges both caches on activate so a UI change can't be masked by a stale shell.
// v3→v4 (founder, 2026-11-12: "Application error: a client-side exception has occurred" on
// some launches): the same stale shell, now across app versions. The saved page is kept
// through every update (this file didn't change, so neither did its caches), so a slow
// cold launch after an update handed the window a page from an EARLIER version, whose code
// no longer matches the server's, and the page fell over. v4 never shows the saved copy
// just because the server is slow while the internet is there, and a worker that finds an
// older worker's saved pages on taking over reloads the window once, so a window already
// showing one of them comes back on the current version.
const VERSION = "v4";
const STATIC_CACHE = `cassette-static-${VERSION}`;
const NAV_CACHE = `cassette-nav-${VERSION}`;
const NAV_TIMEOUT_MS = 2500;

if (IN_APP) {
  self.addEventListener("install", () => {
    self.skipWaiting();
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        const old = keys.filter((k) => k !== STATIC_CACHE && k !== NAV_CACHE);
        await Promise.all(old.map((k) => caches.delete(k)));
        await self.clients.claim();
        // An older worker's saved pages were here, so a window may be showing one of
        // them (an earlier version's page): load each window again, once, from the
        // server. A first install finds nothing to clear and reloads nothing.
        if (old.some((k) => k.startsWith("cassette-nav-"))) {
          const windows = await self.clients.matchAll({ type: "window" });
          await Promise.all(windows.map((w) => w.navigate(w.url).catch(() => {})));
        }
      })()
    );
  });

  self.addEventListener("fetch", onFetch);
}

// Content-hashed (/_next/static/*) or deploy-stable (/fonts/*): safe cache-first forever.
function isImmutableAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/fonts/")
  );
}

// Same-origin static files served from a NON-hashed URL (root public assets like
// /logo-mark.svg, og images, manifest icons). These can change between deploys, so
// cache for cold-start speed but always revalidate — never cache-first-forever.
function isRevalidatableAsset(url) {
  return /\.(?:woff2?|ttf|otf|png|jpe?g|svg|ico|webp|gif|css|js)$/.test(url.pathname);
}

function onFetch(event) {
  const req = event.request;
  if (req.method !== "GET") return; // writes always hit the network
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return; // sidecar / CDN: browser handles
  if (url.pathname.startsWith("/api/")) return; // data — never cache here

  if (isImmutableAsset(url)) {
    event.respondWith(cacheFirst(req));
    return;
  }
  if (isRevalidatableAsset(url)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }
  if (req.mode === "navigate") {
    event.respondWith(networkFirstWithTimeout(req));
    return;
  }
  // Everything else: default network behavior.
}

async function cacheFirst(req) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    return hit || Response.error();
  }
}

// Serve the cached copy immediately (fast), but always refetch in the background and
// update the cache, so a changed asset (e.g. a re-exported /logo-mark.svg) is fresh on
// the next load without waiting for a VERSION bump.
async function staleWhileRevalidate(req) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => hit || Response.error());
  return hit || network;
}

// The page from the server whenever there is one to be had. The saved copy stands in
// only when the server can't be reached, or when the computer is offline and the server
// answers with an error or is still working after NAV_TIMEOUT_MS (an offline launch
// would otherwise wait on the cloud). Online, a slow server is waited for: the saved
// copy can be a page from an earlier version of the app (v4, above). With no saved
// copy the page keeps waiting for the network, as a browser would without this worker
// (BUG-550). The copy is refreshed whenever the network answers well, late or not.
async function networkFirstWithTimeout(req) {
  const cache = await caches.open(NAV_CACHE);
  const network = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  });
  network.catch(() => {}); // a late failure after the saved copy was shown is not an error
  const saved = async (fallback) => (await cache.match(req)) || fallback;
  try {
    const res = await Promise.race([
      network,
      new Promise((_, reject) =>
        setTimeout(() => {
          if (!self.navigator.onLine) reject(new Error("offline-and-slow"));
        }, NAV_TIMEOUT_MS)
      ),
    ]);
    // online, the server's own answer stands, error page and all (its Try again loads the current version)
    return res.ok || self.navigator.onLine ? res : saved(res);
  } catch {
    return saved(network);
  }
}
