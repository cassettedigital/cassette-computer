"use client";

/**
 * Search: everything on your Mac and in your dial, filtered as you type in the field at the top of the
 * page (the rail's search key and "/" or Cmd-K open it; the field drives `?q=`). Records and artists come from the shelf the window already holds; songs from the
 * Mac's song list, fetched once the first time you search (/api/player/desk/songs, which the paired
 * app sends to the cloud with its token); playlists and stations from the window's data.
 *
 * Every word you type has to be somewhere in the thing's name, its artist or its record, accents and
 * case aside. A song plays its record from that song on the Mac, as a song in a record's list does.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, type MouseEvent } from "react";
import { Glyph, Grid, Heading, SongTable, Tile, useContextMenu } from "@discovery/cassette-kit";
import { Art, artistCovers, trackCovers } from "./Art";
import { useDesk } from "./DeskShell";
import { useOwned } from "./owned";
import { useSongs } from "./songs";
import { AlbumTile, PlaylistTile, StationTile, artistCount, len, useLook, useRecordMenu, useSongsMenu } from "./Shelves";
import { DESK, deskAlbum, deskArtist, deskArtistOf, type DeskAlbum, type OwnedTrack } from "./types";
import d from "./desk.module.css";

const fold = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const matcher = (q: string) => {
  const words = fold(q).split(/\s+/).filter(Boolean);
  return (...fields: Array<string | null | undefined>) => {
    const hay = fold(fields.filter(Boolean).join(" "));
    return words.every((w) => hay.includes(w));
  };
};

const SHOW = { records: 12, artists: 8, songs: 40 };

/** The field at the top of the page: the cursor lands in it, and each letter filters the page below. */
function SearchField({ q, count }: { q: string; count?: number }) {
  const router = useRouter();
  const field = useRef<HTMLInputElement>(null);
  const typing = useRef<number | null>(null);
  useEffect(() => {
    // the cursor in the field, its words selected so typing replaces them
    const focus = () => {
      field.current?.focus();
      field.current?.select();
    };
    focus();
    window.addEventListener("desk:find", focus);
    return () => window.removeEventListener("desk:find", focus);
  }, []);
  const go = (raw: string) => {
    if (typing.current) window.clearTimeout(typing.current);
    typing.current = window.setTimeout(() => {
      const v = raw.trim();
      router.replace(v ? `${DESK}/search?q=${encodeURIComponent(v)}` : `${DESK}/search`);
    }, 120);
  };
  return (
    <div className={d.searchHead}>
      <label className={d.searchField}>
        <Glyph name="search" size={20} />
        <input
          ref={field}
          type="search"
          placeholder="Search your library"
          aria-label="Search your library"
          autoComplete="off"
          spellCheck={false}
          defaultValue={q}
          onChange={(e) => go(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              if (e.currentTarget.value) {
                e.currentTarget.value = "";
                go("");
              } else router.back();
            }
          }}
        />
        {count !== undefined && <span className={d.searchCount}>{count}</span>}
      </label>
    </div>
  );
}

export function Search() {
  const q = (useSearchParams().get("q") ?? "").trim().slice(0, 80);
  const { shelf, playlists, stations } = useDesk();
  const owned = useOwned();
  const look = useLook();
  const songs = useSongs(q.length > 0);
  const menu = useRecordMenu();
  const songsMenu = useSongsMenu();
  const cm = useContextMenu();
  const onMenu = (e: MouseEvent, a: DeskAlbum) => cm.open(e, menu(a));

  const found = useMemo(() => {
    if (!q) return null;
    const m = matcher(q);
    const recs = shelf.filter((a) => m(a.title, a.artist));
    const byArtist = new Map<string, { name: string; slug: string | null; albums: DeskAlbum[] }>();
    for (const a of shelf) {
      if (!m(a.artist)) continue;
      const e = byArtist.get(a.artist) ?? byArtist.set(a.artist, { name: a.artist, slug: a.artistSlug, albums: [] }).get(a.artist)!;
      e.albums.push(a);
    }
    return {
      records: recs,
      artists: [...byArtist.values()].sort((x, y) => y.albums.length - x.albums.length),
      songs: songs ? songs.filter((t) => m(t.title, t.artist, t.album)) : null,
      playlists: playlists.filter((p) => m(p.name, p.description)),
      stations: stations.filter((st) => m(st.name, st.network, st.kicker)),
    };
  }, [q, shelf, playlists, stations, songs]);

  if (!found) {
    return (
      <div className={d.page}>
        <SearchField q={q} />
      </div>
    );
  }
  const total = found.records.length + found.artists.length + (found.songs?.length ?? 0) + found.playlists.length + found.stations.length;
  const playSong = (t: OwnedTrack) => (t.albumKey ? void owned.playRecord(t.albumKey, t.title) : owned.playList([t], 0));
  const shownSongs = found.songs?.slice(0, SHOW.songs) ?? [];
  return (
    <div className={d.page}>
      <SearchField q={q} count={found.songs === null ? undefined : total} />
      {found.songs !== null && total === 0 && <p className={d.quiet}>Nothing in your library or on the radio matches that.</p>}

      {found.records.length > 0 && (
        <section>
          <Heading shout="Albums" answer={String(found.records.length)} href={found.records.length > SHOW.records ? `${DESK}/albums?q=${encodeURIComponent(q)}` : undefined} />
          <Grid min={150}>
            {found.records.slice(0, SHOW.records).map((a) => (
              <AlbumTile key={a.key} a={a} onMenu={onMenu} />
            ))}
          </Grid>
        </section>
      )}

      {found.artists.length > 0 && (
        <section>
          <Heading shout="Artists" answer={String(found.artists.length)} />
          <Grid min={150}>
            {found.artists.slice(0, SHOW.artists).map((x) => (
              <Tile
                key={x.name}
                shape="circle"
                art={<Art src={artistCovers(x.albums, 200)} sizes="200px" />}
                title={x.name}
                count={artistCount(x.albums)}
                href={deskArtistOf({ artist: x.name, artistSlug: x.slug })}
                {...look({ kind: "artist", name: x.name, slug: x.slug })}
              />
            ))}
          </Grid>
        </section>
      )}

      {shownSongs.length > 0 && (
        <section className={d.searchSongs}>
          <Heading shout="Songs" answer={found.songs!.length > SHOW.songs ? `${SHOW.songs} of ${found.songs!.length}` : String(found.songs!.length)} />
          <SongTable
            label="Songs"
            rows={shownSongs.map((t) => {
              const on = !!t.subsonicTrackId && owned.track?.subsonicTrackId === t.subsonicTrackId;
              return {
                key: t.key,
                title: t.title,
                art: <Art src={trackCovers(t, 36)} sizes="36px" size={36} />,
                artist: t.artist,
                artistHref: t.artistSlug ? deskArtist(t.artistSlug) : undefined,
                album: t.album,
                albumHref: t.albumKey ? deskAlbum({ key: t.albumKey, slug: t.albumSlug }) : undefined,
                length: len(t.seconds),
                playable: !!t.subsonicTrackId,
                playing: on,
                live: on && owned.status === "playing",
              };
            })}
            onPlay={(i) => playSong(shownSongs[i])}
            menu={(i, picked) => songsMenu(picked.map((x) => shownSongs[x]), { play: [{ label: "Play", onSelect: () => playSong(shownSongs[i]), disabled: !shownSongs[i].subsonicTrackId }] })}
          />
        </section>
      )}
      {found.songs === null && <p className={d.quiet}>Looking through your songs…</p>}

      {found.playlists.length > 0 && (
        <section>
          <Heading shout="Playlists" answer={String(found.playlists.length)} />
          <Grid min={150}>
            {found.playlists.map((p) => (
              <PlaylistTile key={p.id} id={p.id} name={p.name} cover={p.cover} count={p.songs} />
            ))}
          </Grid>
        </section>
      )}

      {found.stations.length > 0 && (
        <section>
          <Heading shout="Stations" answer={String(found.stations.length)} href={`${DESK}/radio`} />
          <Grid min={150}>
            {found.stations.map((st) => (
              <StationTile key={st.slug} s={st} />
            ))}
          </Grid>
        </section>
      )}
      {cm.menu}
    </div>
  );
}
