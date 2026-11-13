"use client";

/**
 * Hide and Delete for an album or an artist in your library: one implementation, used by the old library's
 * rail and by the Mac app's album and artist menus (the founder, 2026-10-29: in the "…" menu, with a yes or
 * no first, on the computer only; the phone keeps "Remove from This Phone", which only takes it off the
 * phone).
 *
 * Hide is reversible: POST /api/sync/library/remove takes the album's or artist's rows out of the library
 * (the files stay on the computer, and the phones drop it).
 *
 * Delete: preview what goes, ask, begin (the rows leave the library with a tombstone, so no sync brings them
 * back), move the files to the Trash through the computer (lib/library-remote), then finalize. When the
 * computer doesn't answer, the album stays out of the library with its files where they were, and the
 * person is offered another try.
 */

import { askToConfirm } from "@/lib/ask";
import { trashLibraryFiles, type TrashTrack } from "@/lib/library-remote";

export type LibraryTarget = {
  scope: "album" | "artist";
  /** the library's group key for the album or the artist */
  groupKey: string;
  /** the artist as the library shows it */
  artistName: string;
  /** the album's title (album scope) */
  albumName?: string | null;
};

/** How the page says what happened: its toast. */
export type Notify = (message: string, variant?: "success" | "error") => void;

const post = (url: string, body: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });

async function failMessage(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => null)) as { message?: string } | null;
  return data?.message ?? `${fallback} (${res.status})`;
}

const UNREACHABLE = "Couldn't reach Cassette. Try again.";

/** Hide it. True once the cloud has it; a failure is told through `notify`. Callers ask first where they should. */
export async function hideFromLibrary(t: LibraryTarget, notify: Notify): Promise<boolean> {
  try {
    const res = await post("/api/sync/library/remove", { scope: t.scope, group_key: t.groupKey });
    if (!res.ok) {
      notify(await failMessage(res, "Couldn't hide that"), "error");
      return false;
    }
    notify(t.scope === "album" ? "Album hidden." : "Artist hidden.", "success");
    return true;
  } catch {
    notify(UNREACHABLE, "error");
    return false;
  }
}

/**
 * Delete it, after a yes: the album (or every album by the artist) leaves the library and its files go to the
 * Trash. `onRemoved` runs as soon as it has left the library (before the files move), so the page can drop it.
 */
export async function deleteFromLibrary(t: LibraryTarget, notify: Notify, onRemoved: () => void): Promise<void> {
  const body = {
    scope: t.scope,
    group_key: t.groupKey,
    artist_name: t.artistName,
    ...(t.scope === "album" ? { album_name: t.albumName } : {}),
  };

  // 1. what will go, for the question (never changes anything; the question still works without it)
  let list = "";
  try {
    const res = await post("/api/sync/library/delete", { ...body, phase: "preview" });
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as { count?: number; tracks?: Array<{ title: string }> } | null;
      const tracks = data?.tracks ?? [];
      const count = data?.count ?? tracks.length;
      if (count === 0) {
        notify("Nothing to delete: it's already gone.", "error");
        return;
      }
      const shown = tracks.slice(0, 12).map((x) => `• ${x.title}`).join("\n");
      const more = count > 12 ? `\n…and ${count - 12} more` : "";
      list = `${count} song${count === 1 ? "" : "s"} will be removed:\n\n${shown}${more}\n\n`;
    }
  } catch {
    /* ask without the list */
  }
  const head = t.scope === "album" ? `Delete "${t.albumName ?? "this album"}"?` : `Delete ${t.artistName} and all their albums from your library?`;
  const yes = await askToConfirm(
    `${head}\n\n${list}This removes it from your library and moves its files to the Trash, where you can still restore them.`,
    { ok: "Delete" },
  );
  if (!yes) return;

  // 2. it leaves the library now, with a tombstone; the answer lists the files to move
  notify(t.scope === "album" ? "Removing album…" : "Removing artist…");
  let trashables: TrashTrack[] = [];
  try {
    const res = await post("/api/sync/library/delete", { ...body, phase: "begin" });
    if (!res.ok) {
      notify(await failMessage(res, "Couldn't delete that"), "error");
      return;
    }
    const data = (await res.json().catch(() => null)) as { trashables?: TrashTrack[] } | null;
    trashables = data?.trashables ?? [];
  } catch {
    notify(UNREACHABLE, "error");
    return;
  }
  onRemoved();

  // 3 and 4: the files to the Trash, then finalize; or hold, with another try
  const done = t.scope === "album" ? "Album deleted." : "Artist deleted.";
  const trashThenFinalize = async (items: TrashTrack[]): Promise<void> => {
    const result = await trashLibraryFiles(items);
    if (result !== null && result.failed.length === 0) {
      try {
        const res = await post("/api/sync/library/delete", { ...body, phase: "finalize" });
        if (!res.ok) {
          // the files are in the Trash and the tombstone holds, so it can't come back
          notify(`Files moved to the Trash, but the cleanup failed (${res.status}). It won't come back.`, "error");
          return;
        }
      } catch {
        notify("Files moved to the Trash, but the cleanup couldn't reach Cassette. It won't come back.", "error");
        return;
      }
      notify(`${done} Files moved to the Trash.`, "success");
      return;
    }
    const failed =
      result === null
        ? items
        : result.failed.map(
            (f) => items.find((x) => x.subsonicTrackId === f.subsonicTrackId) ?? { subsonicTrackId: f.subsonicTrackId, albumArtist: "", album: "", title: "" },
          );
    const n = failed.length;
    const noun = n === 1 ? "file" : "files";
    notify(
      result === null
        ? "Removed from your library. Your computer didn't answer, so its files are where they were."
        : `Removed from your library. ${n} ${noun} couldn't be moved to the Trash.`,
      "error",
    );
    const again =
      result === null
        ? "Your computer didn't answer. Try moving the files to the Trash again?"
        : `${n} ${noun} couldn't be moved to the Trash. Try again?`;
    if (await askToConfirm(again, { ok: "Try again" })) await trashThenFinalize(failed);
  };
  await trashThenFinalize(trashables);
}
