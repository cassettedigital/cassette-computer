/**
 * Library destructive actions (web lane) — the dashboard asks the local Cassette
 * Player sidecar to move an album/artist's audio files to the macOS Trash AFTER
 * the cloud DB delete succeeds. The browser never touches the filesystem; only
 * the sidecar (co-located on the Mac) can resolve real paths and trash files.
 *
 * Fail-soft by contract: an unreachable sidecar returns null so the caller can
 * report "removed from your library, but files weren't moved" honestly — the DB
 * delete already succeeded and the tombstone prevents resurrection.
 */

// The hub, where this page can reach one (lib/hub-origin); on the website in a regular browser every
// call below fails soft without a request.
import { hubFetch } from "@/lib/hub-origin";

/**
 * A track whose file the sidecar should move to the Trash. `subsonicTrackId` is
 * required (the sidecar resolves the real path via Navidrome getSong); the rest
 * are fallback hints used only if getSong can't resolve a path.
 */
export type TrashTrack = {
  subsonicTrackId: string;
  albumArtist: string;
  album: string;
  title: string;
  trackNumber?: number;
};

/** Per-track outcome from the sidecar. `failed` is empty on full success. `kept` are songs in a folder
 *  Cassette reads where it is (board #1163): they leave the library and their files stay put. An older hub
 *  sends no `kept`. */
export type TrashResult = {
  ok: boolean;
  trashed: string[];
  failed: Array<{ subsonicTrackId: string; reason: string }>;
  kept?: string[];
};

/**
 * Ask the local Player to move the given tracks' files to the macOS Trash.
 * Returns the per-track result, or null if the sidecar is unreachable
 * (fail-soft — never throws). An empty input is a no-op success.
 */
export async function trashLibraryFiles(
  tracks: TrashTrack[]
): Promise<TrashResult | null> {
  if (tracks.length === 0) return { ok: true, trashed: [], failed: [] };
  try {
    const r = await hubFetch(`/api/library/trash`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tracks }),
    });
    if (!r.ok) {
      console.debug("[library-trash] →", r.status);
      return null;
    }
    return (await r.json()) as TrashResult;
  } catch (err) {
    console.debug("[library-trash] unreachable (fail-soft):", err);
    return null;
  }
}

/** Per-file upload outcome. `reachable: false` means the local Player couldn't be
 *  reached at all (route to the no-Mac fork, J3) — distinct from a per-file reject. */
export type UploadOutcome = {
  ok: boolean;
  path: string;
  reachable: boolean;
  error?: string;
};

/**
 * Stream ONE dropped file to the local Player (web-drop door, J2). `relPath`
 * preserves the dropped folder structure (e.g. "Album/01 - Track.flac") in the
 * query — the sidecar sanitizes + path-traversal-guards it and validates the
 * bytes (magic + size). The raw file is the request body. Never throws: an
 * unreachable Player returns `{ reachable: false }` so the caller can route to J3.
 * Audio lands on the Mac only — never the cloud.
 */
export async function uploadLibraryFile(
  relPath: string,
  file: Blob
): Promise<UploadOutcome> {
  try {
    const r = await hubFetch(
      `/api/library/upload?path=${encodeURIComponent(relPath)}`,
      { method: "POST", body: file }
    );
    const data = (await r.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    return { ok: r.ok && data.ok === true, path: relPath, reachable: true, error: data.error };
  } catch {
    return { ok: false, path: relPath, reachable: false, error: "Player not reachable" };
  }
}

/** Outcome of a cover replace. Same `reachable`-vs-per-request-reject split as
 *  UploadOutcome — the UI needs to tell "Player unreachable" apart from
 *  "reachable, but the image was rejected" (bad format, too large, etc). */
export type ReplaceCoverOutcome = {
  ok: boolean;
  reachable: boolean;
  error?: string;
};

/**
 * Replace an album's local folder cover — the ONE path that's allowed to
 * overwrite an existing cover.*, gated on this being an explicit user click
 * (see replaceFolderCover in the sidecar's cover-art.go). `trackId` anchors
 * the album: the sidecar resolves it to a file path and replaces that
 * track's containing album directory's cover, same album-identification the
 * GET cover proxy (coverArtURL) already uses. `image` should already be
 * cropped to a square client-side (see CoverCropper) — the sidecar
 * re-normalizes it regardless, this just avoids sending an oversized upload.
 * Never throws: an unreachable Player returns `{ reachable: false }`.
 */
export async function replaceAlbumCover(
  trackId: string,
  image: Blob
): Promise<ReplaceCoverOutcome> {
  try {
    const r = await hubFetch(
      `/api/library/cover/replace?trackId=${encodeURIComponent(trackId)}`,
      { method: "POST", body: image }
    );
    const data = (await r.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    return { ok: r.ok && data.ok === true, reachable: true, error: data.error };
  } catch {
    return { ok: false, reachable: false, error: "Player not reachable" };
  }
}

/**
 * Replace an artist's local folder photo — one directory level up from an
 * album cover (see replaceArtistFolderPhoto in the sidecar's cover-art.go).
 * `trackId` anchors the artist the same way replaceAlbumCover anchors an
 * album: the sidecar resolves it to a file path and walks up to that track's
 * artist directory. Best-effort/secondary to the R2+DB override — a personal
 * photo still renders on web even if this local mirror fails or the sidecar
 * is unreachable. Never throws: an unreachable Player returns
 * `{ reachable: false }`.
 */
export async function replaceArtistPhoto(
  trackId: string,
  image: Blob
): Promise<ReplaceCoverOutcome> {
  try {
    const r = await hubFetch(
      `/api/library/artist-photo/replace?trackId=${encodeURIComponent(trackId)}`,
      { method: "POST", body: image }
    );
    const data = (await r.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
    };
    return { ok: r.ok && data.ok === true, reachable: true, error: data.error };
  } catch {
    return { ok: false, reachable: false, error: "Player not reachable" };
  }
}

/** Ask the local Player to ingest now (after a batch of uploads). Best-effort. */
export async function triggerLibraryIngest(): Promise<boolean> {
  try {
    const r = await hubFetch(`/api/library/ingest`, { method: "POST" });
    return r.ok;
  } catch {
    return false;
  }
}

/** Live ingest progress the sidecar exposes on its (CORS-wrapped) rip status.
 *  `total` = tracks in the current ingest pass; `identified` = how many resolved
 *  a MusicBrainz id; `count` = tracks synced on the last completed pass. */
export type SidecarIngest = {
  state: "idle" | "scanning" | "working" | "done" | "error";
  total?: number;
  identified?: number;
  count?: number;
  at?: string;
  /** The live report (hubs from 0.5.51): reading the new files, looking each song up, saving. */
  stage?: "scanning" | "lookingUp" | "saving" | "done" | "error";
  /** songs looked up so far in this pass (found or not), out of `total` */
  checked?: number;
  /** the records this add brings in, first seen first, with one song's id for its cover */
  albums?: IngestAlbum[];
};

/** A record an add is bringing in, as the hub saw it: `found` once MusicBrainz knew one of its songs. */
export type IngestAlbum = { album: string; artist: string; trackId: string; found: boolean };

/** Poll the local Player's ingest progress (the `ingest` field on the rip status).
 *  Null if unreachable or not yet exposed — callers degrade to a working spinner. */
export async function fetchIngestStatus(): Promise<SidecarIngest | null> {
  try {
    const r = await hubFetch(`/api/rip/status.json`);
    if (!r.ok) return null;
    const data = (await r.json().catch(() => null)) as { ingest?: SidecarIngest } | null;
    return data?.ingest ?? null;
  } catch {
    return null;
  }
}

/** Where the library lives + how big it is + the live build — for the Mac device
 *  page. `musicDir` is an absolute path; `storageBytes` the folder footprint. */
export type LibraryInfo = {
  musicDir: string;
  storageBytes: number;
  version: string;
};

/** Ask the local Player where the library is, its size, and its build. Null if
 *  unreachable (the page shows "connecting…" / dimmed stats). */
export async function fetchLibraryInfo(): Promise<LibraryInfo | null> {
  try {
    const r = await hubFetch(`/api/library/info`);
    if (!r.ok) return null;
    const d = (await r.json().catch(() => null)) as Partial<LibraryInfo> | null;
    if (!d || typeof d.musicDir !== "string") return null;
    return { musicDir: d.musicDir, storageBytes: d.storageBytes ?? 0, version: d.version ?? "" };
  } catch {
    return null;
  }
}

/** Open the library folder in Finder (the local Player runs `open <musicDir>`). */
export async function revealLibrary(): Promise<boolean> {
  try {
    const r = await hubFetch(`/api/library/reveal`, { method: "POST" });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Show one song in the computer's own file window (Finder, File Explorer): `song` selects its file,
 * `record` its record's folder. The hub finds the file by the id it plays it by and only ever reveals
 * something inside the music folder (sidecar library-info.go handleLibraryReveal).
 */
export async function revealInLibrary(songId: string, what: "song" | "record"): Promise<boolean> {
  try {
    const r = await hubFetch(`/api/library/reveal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ songId, what }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/** One of the library's folders, as the hub sees it right now. `here: false` is a drive that's unplugged or a
 *  network drive that's asleep: away, never emptied. */
export type HubFolder = { path: string; here: boolean; network?: boolean };

/** A move of the Cassette folder under way (or just failed). */
export type FolderMove = {
  from: string;
  to: string;
  phase: "copying" | "switching" | "error";
  doneBytes: number;
  totalBytes: number;
  error?: string;
};

/** Where the music lives (board #1163): the Cassette folder, where adds and rips land and the only one the hub
 *  writes into, and the folders Cassette reads where they are. `movedFrom` is an old Cassette folder a finished
 *  move left in place for the person to put away. */
export type LibraryFolders = {
  cassette: HubFolder;
  linked: HubFolder[];
  move?: FolderMove;
  movedFrom?: string;
};

/** The library's folders from the hub. Null when the hub isn't reachable, or is older than this feature. */
export async function fetchLibraryFolders(): Promise<LibraryFolders | null> {
  try {
    const r = await hubFetch(`/api/library/folders`);
    if (!r.ok) return null;
    const d = (await r.json().catch(() => null)) as (Partial<LibraryFolders> & { ok?: boolean }) | null;
    if (!d?.cassette || typeof d.cassette.path !== "string") return null;
    return { cassette: d.cassette, linked: d.linked ?? [], move: d.move, movedFrom: d.movedFrom };
  } catch {
    return null;
  }
}

/** A folder change's answer: `error` is already in words for the person. */
export type FolderChange = { ok: boolean; error?: string };

async function folderCall(route: "add" | "remove" | "move", path: string): Promise<FolderChange> {
  try {
    const r = await hubFetch(`/api/library/folders/${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    const d = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string };
    if (r.ok && d.ok) return { ok: true };
    return { ok: false, error: d.message ?? d.error ?? "Cassette couldn't do that." };
  } catch {
    return { ok: false, error: "Your computer didn't answer. Is Cassette open on it?" };
  }
}

/** Read a folder where it is. Nothing in it is ever moved or written to. */
export const addReadFolder = (path: string) => folderCall("add", path);
/** Stop reading a folder. Its files stay exactly where they are. */
export const removeReadFolder = (path: string) => folderCall("remove", path);
/** Move the Cassette folder into (or to) `path`. Progress shows on fetchLibraryFolders. */
export const moveMusicFolder = (path: string) => folderCall("move", path);
