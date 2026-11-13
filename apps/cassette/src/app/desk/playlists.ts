"use client";

/**
 * Editing your playlists from the desk, through the same sync API the phones and the dashboard use
 * (/api/sync/playlists: create, rename, delete; /ops: add, remove, reorder). The paired app sends
 * these to the cloud with its token. Each call throws with the server's own words on failure, so the
 * page can say what went wrong and put things back.
 */

import { swrRead } from "@/lib/read-cache";
import { playlistToPlay } from "./actions";
import type { OwnedTrack } from "./types";

function uuid(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

async function call(url: string, method: string, body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(j.message ?? j.error ?? `Couldn't save that (${res.status})`);
  }
}

/**
 * This playlist started playing: the cloud keeps the date, and your playlists sort by the one last
 * played on any device (One Home). Best effort: a missed report only leaves the list's order as it was.
 */
export function playlistPlayed(id: string): void {
  void fetch(`/api/sync/playlists/${id}/played`, { method: "POST", credentials: "include" }).catch(() => {});
}

/** A new, empty playlist; its id. */
export async function createPlaylist(name: string): Promise<string> {
  const id = uuid();
  await call("/api/sync/playlists", "POST", { id, name: name.trim().slice(0, 200) || "New playlist" });
  return id;
}

export const renamePlaylist = (id: string, name: string) => call(`/api/sync/playlists/${id}`, "PUT", { name: name.trim().slice(0, 200) });

export const deletePlaylist = (id: string) => call(`/api/sync/playlists/${id}`, "DELETE");

/** A new cover: the picker's pick (a drawn family, stored as the family alone). */
export const setPlaylistCover = (id: string, url: string) => call(`/api/sync/playlists/${id}`, "PUT", { cover_image_url: url });

export const removeFromPlaylist = (id: string, itemIds: string[]) =>
  call(`/api/sync/playlists/${id}/ops`, "POST", { ops: itemIds.map((item_id) => ({ op: "remove", item_id })) });

export const reorderPlaylist = (id: string, moves: Array<{ itemId: string; position: number }>) =>
  call(`/api/sync/playlists/${id}/ops`, "POST", { ops: moves.map((m) => ({ op: "reorder", item_id: m.itemId, position: m.position })) });

/**
 * Where a song moved to `at` in `list` (already in its new order) should sit: halfway between its
 * neighbours. When they leave no room (equal positions), every song is renumbered in order.
 */
export function positionsAfterMove<T extends { key: string; position?: number }>(list: T[], at: number): Array<{ itemId: string; position: number }> {
  const prev = list[at - 1]?.position;
  const next = list[at + 1]?.position;
  const me = list[at];
  if (prev != null && next != null && prev < next) return [{ itemId: me.key, position: (prev + next) / 2 }];
  if (prev != null && next == null) return [{ itemId: me.key, position: prev + 1024 }];
  if (prev == null && next != null) return [{ itemId: me.key, position: next - 1024 }];
  return list.map((x, i) => ({ itemId: x.key, position: (i + 1) * 1024 })).filter((m, i) => list[i].position !== m.position);
}

/* ── a playlist's songs, read fast: this window's memory, else the browser's kept copy, refreshed from
      the cloud behind it (the same lib/read-cache the song list uses) ── */

const playlistKept = new Map<string, OwnedTrack[]>();

/** The songs as this window last saw them, at once; null when it hasn't read this playlist yet. */
export const playlistSongsNow = (id: string) => playlistKept.get(id) ?? null;

/** A playlist's songs on the Mac, in order: `onSongs` hears the kept copy first, then any change. */
export async function readPlaylistSongs(id: string, onSongs: (songs: OwnedTrack[]) => void): Promise<boolean> {
  const { ok } = await swrRead<OwnedTrack[]>(
    `desk-playlist:${id}`,
    async () => (await playlistToPlay(id)) ?? [],
    (songs) => {
      playlistKept.set(id, songs);
      onSongs(songs);
    },
  );
  return ok;
}

/** A playlist's songs once, the quickest way there is (for a play key). */
export function playlistSongs(id: string): Promise<OwnedTrack[]> {
  const now = playlistSongsNow(id);
  if (now) return Promise.resolve(now);
  return new Promise((resolve, reject) => {
    let done = false;
    void readPlaylistSongs(id, (songs) => {
      if (done) return;
      done = true;
      resolve(songs);
    }).then((ok) => !ok && !done && reject(new Error("playlist unavailable")));
  });
}
