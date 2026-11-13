/**
 * Client-side stale-while-revalidate read-cache (IndexedDB-backed, zero-dep).
 *
 * THE INVARIANT: this cache is DERIVED and DISPOSABLE. It never originates data,
 * never writes to the cloud, and on any disagreement the cloud wins — a
 * successful revalidate overwrites the entry unconditionally. It exists purely so
 * already-seen browse data (album/artist source loads) paints instantly and
 * survives a brief offline. The cloud stays the single source of truth; this is a
 * read accelerator, not a second store. (No reconciliation logic lives here, by
 * design — see SPEC "Snappy library / the lighter path".)
 *
 * Scope note: keyed per-browser (not per-user). For the single-user Cassette
 * Player that's fine; clear via clearReadCache() on logout if multi-user is added.
 */

const DB_NAME = "cassette-read-cache";
const STORE = "kv";
const DB_VERSION = 1;

type Entry<T> = { value: T; cachedAt: number };

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null); // SSR / unsupported
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null); // e.g. private-mode restrictions → degrade to no-cache
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null); // best-effort: a broken DB just means no cache
  });
  return dbPromise;
}

async function idbGet<T>(key: string): Promise<Entry<T> | null> {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as Entry<T>) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbSet<T>(key: string, value: T): Promise<void> {
  const db = await openDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ value, cachedAt: Date.now() } as Entry<T>, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Drop the whole read-cache (e.g. on logout). Best-effort. */
export async function clearReadCache(): Promise<void> {
  const db = await openDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Stale-while-revalidate read.
 *
 * 1. Serves the cached value immediately via `onData(value, "cache")` when present
 *    (this is the instant paint).
 * 2. Always revalidates: runs `fetcher` (a pure GET); on success it overwrites the
 *    cache and calls `onData(value, "fresh")` — UNLESS the fresh value is byte-equal
 *    to what was just served, to avoid a redundant re-render.
 * 3. On fetch failure the cached value stands (offline-friendly). The cloud wins
 *    whenever it is reachable.
 *
 * Returns `{ servedFromCache, ok }`. `ok` is false ONLY when there was neither a
 * cached value nor a successful fetch — the caller's cue to show an error.
 *
 * `fetcher` MUST be read-only. This layer never mutates server state.
 */
export async function swrRead<T>(
  key: string,
  fetcher: () => Promise<T>,
  onData: (value: T, source: "cache" | "fresh") => void
): Promise<{ servedFromCache: boolean; ok: boolean }> {
  const cached = await idbGet<T>(key);
  if (cached) onData(cached.value, "cache");
  try {
    const fresh = await fetcher();
    await idbSet(key, fresh);
    if (!cached || JSON.stringify(cached.value) !== JSON.stringify(fresh)) {
      onData(fresh, "fresh");
    }
    return { servedFromCache: !!cached, ok: true };
  } catch {
    return { servedFromCache: !!cached, ok: !!cached };
  }
}
