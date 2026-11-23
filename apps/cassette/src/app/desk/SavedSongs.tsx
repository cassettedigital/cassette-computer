"use client";

/**
 * Saved songs (the founder, 2026-11-23, board #1162): the songs of yours you saved, newest save first, played from your
 * computer like any list here. It opens from its tile, first in Playlists. A saved song that is no longer on the Mac
 * waits quietly until it is back. Songs you saved but don't own are not here: they wait in Saved for later on
 * Discover, where previews play (nothing in your library plays YouTube).
 */

import { useMemo } from "react";
import { SongTable, useContextMenu } from "@discovery/cassette-kit";
import { Art, trackCovers } from "./Art";
import { useOwned } from "./owned";
import { dragSongs } from "./drag";
import { useSavedSongs } from "./saved-songs";
import { PageHead, len, useSongsMenu } from "./Shelves";
import { useSongs } from "./songs";
import { deskAlbum } from "./types";
import d from "./desk.module.css";

export function SavedSongs() {
  const keep = useSavedSongs();
  const all = useSongs(true);
  const owned = useOwned();
  const songsMenu = useSongsMenu();
  const cm = useContextMenu();
  const songs = useMemo(() => {
    if (!all) return null;
    const byId = new Map(all.flatMap((t) => (t.cassetteLocalId ? [[t.cassetteLocalId, t] as const] : [])));
    return keep.ids.map((id) => byId.get(id)).filter((t): t is NonNullable<typeof t> => !!t);
  }, [all, keep.ids]);
  const playAt = (i: number) => songs && owned.playList(songs, i);

  return (
    <div className={d.page}>
      <PageHead title="Saved songs" />
      {songs && songs.length === 0 && <p className={d.quiet}>Songs of yours you save show here. Right-click a song and choose Save.</p>}
      {songs && songs.length > 0 && (
        <SongTable
          label="Saved songs"
          rows={songs.map((t) => {
            const on = !!t.subsonicTrackId && owned.track?.subsonicTrackId === t.subsonicTrackId;
            return {
              key: t.key,
              title: t.title,
              art: <Art src={trackCovers(t, 36)} sizes="36px" size={36} />,
              artist: t.artist,
              album: t.album,
              albumHref: t.albumKey ? deskAlbum({ key: t.albumKey, slug: t.albumSlug }) : undefined,
              length: len(t.seconds),
              playable: !!t.subsonicTrackId,
              playing: on,
              live: on && owned.status === "playing",
            };
          })}
          onPlay={playAt}
          menu={(i, picked) => songsMenu(picked.map((r) => songs[r]), { play: [{ label: "Play", onSelect: () => playAt(i), disabled: !songs[i].subsonicTrackId }] })}
          dragOut={(_, picked, e) => dragSongs(e, () => picked.map((r) => songs[r]).filter((x) => !!x), { now: true })}
        />
      )}
      {cm.menu}
    </div>
  );
}
