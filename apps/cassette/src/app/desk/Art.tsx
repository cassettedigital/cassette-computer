"use client";

/**
 * A cover's picture, from a list of places to find it, best first: the next one is tried when one
 * fails. A cloud picture is drawn by AlbumCover at the image ladder's sizes
 * (docs/reference/CASSETTE_IMAGES.md), falling back to the stored address should the ladder not answer;
 * the Mac's own pictures come from its hub as they are, at the ladder size the hub makes. Fills its box.
 *
 * The desk's records come in the one order (albumCovers / trackCovers -> lib/covers/album-tier): in the
 * desktop app the cover in the record's own folder first (the hub serves it from the disk, instant and there
 * with no signal; a person's pick is written into that folder), then their pick, then the catalog's; on the
 * website their pick first. The Mac's own pictures are drawn by HubPicture.
 */

import { useMemo, useState, useSyncExternalStore } from "react";
import { WordArt } from "@discovery/cassette-kit";
import { AlbumCover } from "@/app/components/AlbumCover";
import { HubPicture, isHubPicture } from "@/app/components/HubPicture";
import { coverOrder } from "@/lib/covers/album-tier";
import { LiveCover } from "@/app/components/LiveCover";
import { drawnPickFamily, isDrawnPlaylistCover } from "@/lib/covers/playlist";
import { artistPhotoURL, coverArtURL, SIDECAR_SAME_ORIGIN } from "@/lib/playback-remote";
import { getLocalCoverEpoch, subscribeLocalCoverEpoch } from "@/lib/local-cover-epoch";
import { useMacReachable } from "./owned";
import type { DeskAlbum, OwnedTrack } from "./types";

type Src = string | null | undefined;

/** The pixels to ask the hub for a box `px` wide: twice it, for a sharp screen. coverArtURL rounds it to
 *  the image ladder's own size, so every box on one size asks by the same address. */
const hubPx = (px: number) => px * 2;

/** A record as the cover lists read it: the version of its folder cover is optional (an address without
 *  one is still right, only kept an hour instead of for good). */
type CoverRecord = Pick<DeskAlbum, "localTrackId" | "overrideCover" | "catalogCover" | "catalogCoverSmall"> & { localCoverVersion?: string | null };

/** Where a record's cover is, best first, for a box about `px` wide. The Mac's own carries the folder
 *  cover's version (cv=), so the window keeps it until the picture changes (BUG-920). */
export function albumCovers(a: CoverRecord, px: number): string[] {
  const local = a.localTrackId ? coverArtURL(a.localTrackId, hubPx(px), undefined, a.localCoverVersion) : null;
  const catalog = px > 160 ? [a.catalogCover, a.catalogCoverSmall] : [a.catalogCoverSmall, a.catalogCover];
  return coverOrder({ local, override: a.overrideCover, catalog }); // the one order (lib/covers/album-tier)
}

/**
 * An artist's picture, best first: their photo from their folder on the Mac (the one the photo pencil
 * sets), else the cover of their newest record (`albums` newest first). Drawn in a circle wherever an
 * artist stands (a grid, the side view, their page): the shape says "artist", whatever is inside it
 * (2026-10-22: a fan of covers here and a photo there read as two different ideas).
 */
export function artistCovers(albums: CoverRecord[], px: number): string[] {
  const trackId = albums.find((a) => a.localTrackId)?.localTrackId ?? null;
  const photo = trackId ? artistPhotoURL(trackId, hubPx(px)) : null;
  return [photo, ...(albums[0] ? albumCovers(albums[0], px) : [])].filter((u): u is string => !!u);
}

/** Where a song's record cover is, best first. */
export function trackCovers(t: Pick<OwnedTrack, "subsonicTrackId" | "coverOverride" | "cover" | "coverVersion">, px: number): string[] {
  const local = t.subsonicTrackId ? coverArtURL(t.subsonicTrackId, hubPx(px), undefined, t.coverVersion) : null;
  return coverOrder({ local, override: t.coverOverride, catalog: t.cover });
}

/** the Mac's own pictures (served by its sidecar): a record's folder cover, an artist's folder photo */
const isLocal = isHubPicture;

export function Art({
  src,
  fallback,
  sizes,
  size,
  priority,
}: {
  src: Src | Src[];
  fallback?: Src;
  sizes: string;
  size?: number;
  priority?: boolean;
}) {
  // the Mac's own covers: refetched when a cover is replaced in its folder (the shared epoch, BUG-106),
  // and skipped in a browser that can't reach the Mac (the web, away from it: each would be a failed
  // request before the next picture). The paired app keeps them: a missed answer there is a blip.
  const epoch = useSyncExternalStore(subscribeLocalCoverEpoch, getLocalCoverEpoch, () => 0);
  const reachable = useMacReachable();
  const skipLocal = reachable === false && !SIDECAR_SAME_ORIGIN;
  const list = useMemo(
    () =>
      [...new Set([...(Array.isArray(src) ? src : [src]), fallback].filter((u): u is string => !!u))]
        .filter((u) => !(skipLocal && isLocal(u)))
        .map((u) => (epoch && isLocal(u) && !/[?&]v=/.test(u) ? `${u}&v=${epoch}` : u)),
    [src, fallback, skipLocal, epoch],
  );
  const key = list.join("|");
  // back to the first place when the list itself changes (set while drawing, not in an effect: an
  // effect's first run would undo a failure already seen on mounting)
  const [at, setAt] = useState(0);
  const [was, setWas] = useState(key);
  if (was !== key) {
    setWas(key);
    setAt(0);
  }
  const url = list[at] ?? null;
  if (!url) return null;
  const onError = () => setAt((n) => n + 1);
  if (!isLocal(url)) return <AlbumCover key={url} bare imageUrl={url} title="" sizes={sizes} size={size} priority={priority} onError={onError} />;
  return <HubPicture src={url} priority={priority} onError={onError} />;
}

/**
 * A playlist's cover: a drawn one moves (LiveCover, the dashboard's own): `visible` while it's on
 * screen (the playlist page, the side view), `hover` under the pointer (a tile). Anything else is a
 * still, as any cover is.
 */
export function PlaylistArt({ id, name, cover, sizes, mode, priority }: { id: string; name: string; cover: string | null; sizes: string; mode: "visible" | "hover"; priority?: boolean }) {
  if (!cover) return <WordArt name={name} accent="#6B5A44" />;
  const still = <Art src={cover} sizes={sizes} priority={priority} />;
  if (!isDrawnPlaylistCover(cover)) return still;
  return (
    <LiveCover id={id} name={name} family={drawnPickFamily(cover)} mode={mode} minLiveSize={96}>
      {still}
    </LiveCover>
  );
}
