import "server-only";

/**
 * Where the desk's pages get their data. On the web (and the dev server) the server has the database
 * and reads it directly (data.ts). The paired desktop app has no database (token mode: it carries a
 * device token instead), so there the same reads come from the cloud's desk routes
 * (/api/player/desk/*), which run those same loaders for the token's account. One shape either way.
 *
 * Rehearsal: with DESK_REHEARSE_CLOUD=1 a local dev server takes the cloud path too, asking its own
 * routes with the visitor's session cookie, so the paired app's path can be walked in Cassette Dev
 * before anything is deployed. Never on a deployed site.
 *
 * Browser-side reads (starting a record, the shell's player, the radio) need nothing here: the paired
 * app already sends every /api call to the cloud with its token (next.config rewrites).
 *
 * The database side is web.ts, one seam: the open-source copy of the computer app keeps only the cloud path.
 */

import { cache } from "react";
import { headers } from "next/headers";
import type { AlbumLoad } from "@/app/(taste)/album/[slug]/types";
import type { ArtistLoad } from "@/app/(taste)/artist/_lib/types";
import { toBase64Url } from "@/lib/dashboard/library-group-keys";
import { withoutLd } from "@/lib/desk/without-ld";
import { isTokenMode } from "@/lib/player-client";
import { askCloud, withCopy } from "@/lib/offline-copies";
import { loadAlbumPage, loadArtistPage, loadDesk, loadDevices, loadPlaylist, loadRecord, ownedBySlug } from "./web";
import type { DeskData, DeskDevices, DeskPlaylistPage, DeskRecordPage } from "./types";

type AlbumPage = Omit<AlbumLoad, "jsonLd">;
type ArtistPage = Omit<ArtistLoad, "jsonLd">;

const rehearsing = () => process.env.DESK_REHEARSE_CLOUD === "1" && process.env.NODE_ENV !== "production";
/** The cloud path: the paired app, or a rehearsal of it. */
export const viaCloud = () => isTokenMode() || rehearsing();
/** Rehearsal only: act as if the cloud didn't answer, to walk the offline desk. */
const pretendOffline = () => rehearsing() && process.env.DESK_REHEARSE_OFFLINE === "1";

/** The page needs the cloud, it didn't answer, and there's no copy of it on this Mac yet. */
export class NotKeptOffline extends Error {
  constructor(path: string) {
    super(`not kept offline: ${path}`);
  }
}

/**
 * A desk route's JSON, settled against the copy kept on this Mac (lib/offline-copies, BUG-542): the
 * reply when the cloud answers (and the copy refreshed), the copy when it doesn't, null on a 404. In the
 * paired app the request goes over the device token; in a rehearsal, to this server with your session.
 */
async function remote<T>(path: string): Promise<{ value: T | null; offline: boolean }> {
  const out = isTokenMode()
    ? await askCloud<T>(path)
    : await withCopy<T>(`rehearsal:${path}`, async () => {
        if (pretendOffline()) return { status: null, value: null };
        const h = await headers();
        const res = await fetch(`http://${h.get("host")}${path}`, { headers: { cookie: h.get("cookie") ?? "" }, cache: "no-store" });
        return { status: res.status, value: res.ok ? ((await res.json()) as T) : null };
      });
  if (out.heard === "unreachable" && !out.value) throw new NotKeptOffline(path);
  if (out.heard === "refused") throw new Error(`desk ${path}: the cloud refused this Mac's token`);
  return out;
}

export const deskWindow = cache(async (userId: string, name: string | null): Promise<DeskData> => {
  if (!viaCloud()) return loadDesk(userId, name);
  const d = await remote<DeskData>("/api/player/desk");
  if (!d.value) throw new Error("desk window: not found");
  return d.offline ? { ...d.value, offline: true } : d.value;
});

/** A record on the Mac by its group key, or by a catalog slug when that record is on the Mac. */
export const deskRecord = cache(async (userId: string, by: "key" | "slug", value: string): Promise<DeskRecordPage | null> => {
  if (viaCloud()) {
    const q = by === "key" ? `key=${toBase64Url(value)}` : `slug=${encodeURIComponent(value)}`;
    return (await remote<DeskRecordPage>(`/api/player/desk/record?${q}`)).value;
  }
  const key = by === "key" ? value : await ownedBySlug(userId, value);
  return key ? loadRecord(userId, key) : null;
});

export const deskPlaylist = cache(async (userId: string, id: string): Promise<DeskPlaylistPage | null> =>
  viaCloud() ? (await remote<DeskPlaylistPage>(`/api/player/desk/playlists/${encodeURIComponent(id)}`)).value : loadPlaylist(userId, id),
);

export const deskDevices = cache(async (userId: string): Promise<DeskDevices | null> =>
  viaCloud() ? (await remote<DeskDevices>("/api/player/desk/devices")).value : loadDevices(userId),
);

// The desk hands these straight to client bodies, so the public page's structured data stays behind (BUG-815).
export const deskAlbumPage = cache(async (userId: string, slug: string): Promise<AlbumPage | null> =>
  viaCloud() ? (await remote<AlbumPage>(`/api/player/desk/album/${encodeURIComponent(slug)}`)).value : withoutLd(await loadAlbumPage(slug, userId)),
);

export const deskArtistPage = cache(async (userId: string, slug: string): Promise<ArtistPage | null> =>
  viaCloud() ? (await remote<ArtistPage>(`/api/player/desk/artist/${encodeURIComponent(slug)}`)).value : withoutLd(await loadArtistPage(slug, userId)),
);
