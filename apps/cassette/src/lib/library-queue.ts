/**
 * Queue-until-home (SPEC drag-and-drop, J3) — when no Cassette Player is reachable
 * (away from home / app closed), hold dropped audio CLIENT-SIDE in IndexedDB and
 * replay it the moment the Player returns. NEVER the cloud: personal audio stays
 * on the user's machines per the storage model — IndexedDB is a local, disposable
 * outbox, not a second store. Bounded by a hard byte cap (browser storage is
 * finite); overflow is refused with a clear count, never silently dropped.
 */

import { uploadLibraryFile, triggerLibraryIngest } from "@/lib/library-remote";

const DB_NAME = "cassette-upload-queue";
const STORE = "queue";
const DB_VERSION = 1;
const MAX_QUEUE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB local-outbox cap

type QueuedItem = {
  id: string;
  relPath: string;
  blob: Blob;
  bytes: number;
  queuedAt: number;
};

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

async function idbAll(): Promise<QueuedItem[]> {
  const db = await openDB();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as QueuedItem[]) ?? []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

async function idbPut(item: QueuedItem): Promise<void> {
  const db = await openDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function idbDelete(id: string): Promise<void> {
  const db = await openDB();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `q-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  }
}

/** Hold files in the local outbox. Respects the byte cap; returns how many were
 *  queued vs skipped (cap exceeded). */
export async function queueUploads(
  files: { relPath: string; file: File }[]
): Promise<{ queued: number; skipped: number }> {
  const existing = await idbAll();
  let total = existing.reduce((sum, it) => sum + it.bytes, 0);
  let queued = 0;
  let skipped = 0;
  for (const { relPath, file } of files) {
    if (total + file.size > MAX_QUEUE_BYTES) {
      skipped++;
      continue;
    }
    await idbPut({ id: newId(), relPath, blob: file, bytes: file.size, queuedAt: Date.now() });
    total += file.size;
    queued++;
  }
  return { queued, skipped };
}

/** Number of items waiting in the local outbox. */
export async function queuedCount(): Promise<number> {
  return (await idbAll()).length;
}

/**
 * Try to drain the outbox to the Player. If the Player is unreachable, nothing is
 * removed (stays queued for next time). A file the Player REJECTS (bad
 * magic/type) is dropped — it would never succeed. Triggers one ingest after a
 * successful drain.
 */
export async function flushQueue(): Promise<{
  flushed: number;
  dropped: number;
  remaining: number;
  reachable: boolean;
}> {
  const items = await idbAll();
  if (items.length === 0) return { flushed: 0, dropped: 0, remaining: 0, reachable: true };
  let flushed = 0;
  let dropped = 0;
  for (const item of items) {
    const r = await uploadLibraryFile(item.relPath, item.blob);
    if (!r.reachable) {
      return { flushed, dropped, remaining: items.length - flushed - dropped, reachable: false };
    }
    await idbDelete(item.id); // reachable → resolved either way (uploaded or rejected)
    if (r.ok) flushed++;
    else dropped++;
  }
  if (flushed > 0) await triggerLibraryIngest();
  return { flushed, dropped, remaining: 0, reachable: true };
}
