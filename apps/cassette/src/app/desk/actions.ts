"use server";

/**
 * The desk's reads for playing. Two lanes, never mixed: the deck plays the records on the Mac (a record
 * starts through the library's own songs API, owned.tsx; a playlist through playlistToPlay); a record's
 * page plays YouTube previews in the booth (recordToPlay, the album page's own preview list). Read-only,
 * through source.ts (the database on the web, the cloud inside the paired app).
 */

import { isSlug } from "@/app/(taste)/_kit/links";
import type { Playable } from "@/app/(taste)/_kit/play";
import { deskUser } from "./session";
import { deskAlbumPage, deskPlaylist } from "./source";
import type { OwnedTrack } from "./types";

export async function recordToPlay(slug: string): Promise<{ playables: Playable[]; start: number } | null> {
  const user = await deskUser();
  if (!isSlug(slug)) return null;
  const p = await deskAlbumPage(user.id, slug);
  if (!p || p.playables.length === 0) return null;
  const at = p.playables.findIndex((x) => x.trackId === p.startTrackId);
  return { playables: p.playables, start: Math.max(0, at) };
}

/** A playlist's songs on the Mac, in its order: what the deck plays when it starts from the rail. */
export async function playlistToPlay(id: string): Promise<OwnedTrack[] | null> {
  const user = await deskUser();
  const p = await deskPlaylist(user.id, id);
  return p && p.songs.length ? p.songs : null;
}
