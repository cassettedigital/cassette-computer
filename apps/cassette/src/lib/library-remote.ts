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

/** Per-track outcome from the sidecar. `failed` is empty on full success. */
export type TrashResult = {
  ok: boolean;
  trashed: string[];
  failed: Array<{ subsonicTrackId: string; reason: string }>;
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
};

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
