"use client";

/**
 * An artist, one view at two sizes: the side view's (`rail`) and the page's (`page`), the page being
 * the comfortable version of the side view (2026-10-22: "the center view, when opened, is just the
 * comfortable version of the rail view"). Both show the same picture (a circle: their photo, else their
 * newest record's cover), the same menu, the same records and songs, and the same extras:
 *
 *   records     their records on the Mac, newest first
 *   songs       every song of theirs on the Mac, in record order (the side view shows the first few)
 *   playlists   your playlists they're on
 *   a playlist  made from them: their songs, or theirs with the artists like them you have
 *
 * The menu (useArtistMenu) is the side view's ⋯ and the page's ⋯ alike: play, shuffle, edit the artist
 * (their name across their records, their photo), add them to a playlist, make one from them.
 *
 * No facts or article lines about them: tried, and dropped (the founder, 2026-10-22: "it looks lame").
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Glyph, Grid, Heading, Key, Pills, PlayPill, Rows, ShufflePill, SongTable, TrackRow, useContextMenu, WordArt, type MenuItem } from "@discovery/cassette-kit";
import { useShell } from "@/app/dashboard/_shell/shell-context";
import { swrRead } from "@/lib/read-cache";
import { Art, albumCovers, artistCovers, trackCovers } from "./Art";
import { useAside, useDesk } from "./DeskShell";
import { useArtistFollow } from "./artist-follows";
import { useEditArtist } from "./Editors";
import { useOwned } from "./owned";
import { createPlaylist, playlistSongs } from "./playlists";
import { AlbumTile, PlaylistTile, len, usePlaylistAdds, useQueueLines, useRecordMenu, useSongsMenu } from "./Shelves";
import { useSongPicks } from "./picks";
import { dragSongs } from "./drag";
import { useRemoveFromLibrary } from "./remove";
import { inRecordOrder, useSongs } from "./songs";
import { deskAlbum, deskArtist, deskArtistOf, deskPlaylist, type DeskArtistAbout, type DeskPlaylist, type OwnedTrack } from "./types";
import d from "./desk.module.css";

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const word = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/* ── what the view knows about an artist ── */

export function useAbout(slug: string | null) {
  const [about, setAbout] = useState<DeskArtistAbout | null>(null);
  useEffect(() => {
    setAbout(null);
    if (!slug) return;
    let gone = false;
    void swrRead<DeskArtistAbout | null>(
      `desk-artist-about:${slug}`,
      async () => {
        const r = await fetch(`/api/player/desk/artist-about/${encodeURIComponent(slug)}`, { credentials: "include" });
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as DeskArtistAbout;
      },
      (v) => !gone && setAbout(v),
    );
    return () => {
      gone = true;
    };
  }, [slug]);
  return about;
}

/** Your playlists with songs by them, and how many of theirs each holds (each playlist read once, kept). */
function usePlaylistsWith(name: string) {
  const { playlists } = useDesk();
  const [found, setFound] = useState<Array<{ p: DeskPlaylist; count: number }> | null>(null);
  useEffect(() => {
    let gone = false;
    void Promise.all(
      playlists.map((p) =>
        playlistSongs(p.id)
          .then((songs) => ({ p, count: songs.filter((s) => same(s.artist, name)).length }))
          .catch(() => ({ p, count: 0 })),
      ),
    ).then((all) => !gone && setFound(all.filter((x) => x.count > 0)));
    return () => {
      gone = true;
    };
  }, [playlists, name]);
  return found;
}

export function useArtist(name: string, slug: string | null) {
  const { shelf } = useDesk();
  const albums = useMemo(
    () => shelf.filter((a) => (slug ? a.artistSlug === slug : same(a.artist, name))).sort((x, y) => (y.year ?? "").localeCompare(x.year ?? "")),
    [shelf, slug, name],
  );
  const keys = useMemo(() => albums.map((a) => a.key), [albums]);
  const all = useSongs(true);
  const songs = useMemo(() => (all ? inRecordOrder(all.filter((t) => t.albumKey && keys.includes(t.albumKey)), keys) : null), [all, keys]);
  const years = albums.map((a) => a.year).filter((y): y is string => !!y).sort();
  const span = years.length ? (years[0] === years.at(-1) ? years[0] : `${years[0]}–${years.at(-1)}`) : null;
  const facts = [word(albums.length, "album"), songs ? word(songs.length, "song") : null, span].filter(Boolean).join(" · ");
  return { albums, keys, songs, all, facts };
}

/* ── the menu, the same in the side view and on the page ── */

/** A playlist made from them: their songs, or theirs and the artists like them you have, shuffled together. */
function useMakePlaylist() {
  const { addToPlaylist } = useOwned();
  const { showToast } = useShell();
  const router = useRouter();
  return async (title: string, songs: OwnedTrack[]) => {
    const mine = songs.filter((s) => s.subsonicTrackId);
    if (!mine.length) return showToast("None of their songs are in your library yet");
    try {
      const id = await createPlaylist(title);
      await addToPlaylist({ id, name: title }, { songs: mine });
      router.push(deskPlaylist(id));
      router.refresh();
    } catch (e) {
      showToast((e as Error).message || "Couldn't make that playlist", { variant: "error" });
    }
  };
}

export function useArtistMenu(name: string | null, slug: string | null, opts: { onPage?: boolean } = {}): MenuItem[] | null {
  const router = useRouter();
  const owned = useOwned();
  const editArtist = useEditArtist();
  const adds = usePlaylistAdds();
  const make = useMakePlaylist();
  const remove = useRemoveFromLibrary();
  const queue = useQueueLines();
  const { albums, keys, songs } = useArtist(name ?? "", slug);
  const follow = useArtistFollow();
  if (!name) return null;
  // an artist you own a record by you follow (board #1162): their new records come to Home; Unfollow stops only that
  const following: MenuItem[] =
    slug && keys.length
      ? [follow.follows(slug) ? { label: "Unfollow", onSelect: () => follow.set(slug, false) } : { label: "Follow", onSelect: () => follow.set(slug, true) }]
      : [];
  return [
    { label: "Play", onSelect: () => void owned.playRecords(keys), disabled: !keys.length },
    { label: "Shuffle", onSelect: () => void owned.playRecords(keys, { shuffle: true }), disabled: !keys.length },
    ...(keys.length ? queue(() => Promise.all(keys.map((k) => owned.recordTracks(k))).then((l) => l.flat())) : []),
    "separator",
    ...(opts.onPage ? [] : ([{ label: "Open the artist", onSelect: () => router.push(deskArtistOf({ artist: name, artistSlug: slug })) }] as MenuItem[])),
    ...(slug ? ([{ label: "Their page in the catalog", onSelect: () => router.push(`${deskArtist(slug)}?page=1`) }] as MenuItem[]) : []),
    { label: "Edit artist…", onSelect: () => editArtist(name, albums) },
    ...(songs ? adds({ songs }) : []),
    { label: "Make a playlist from them", onSelect: () => void make(name, songs ?? []), disabled: !songs?.length },
    ...following,
    // in your library: Hide and Delete, each asking first (the founder, 2026-10-29)
    ...(keys.length
      ? ([
          "separator",
          { label: "Hide artist…", onSelect: () => void remove.hideArtist(name, slug) },
          { label: "Delete artist…", onSelect: () => remove.deleteArtist(name, slug) },
        ] as MenuItem[])
      : []),
  ];
}

/* ── the view ── */

function Section({ shout, answer, href, children }: { shout: string; answer?: string; href?: string; children: ReactNode }) {
  return (
    <section className={d.artistSection}>
      <Heading shout={shout} answer={answer} href={href} tone="quiet" />
      {children}
    </section>
  );
}

const SIDE_SONGS = 8;
/** the page shows this many of their songs until asked for all of them */
const PAGE_SONGS = 12;

export function ArtistView({ name, slug, size }: { name: string; slug: string | null; size: "rail" | "page" }) {
  const owned = useOwned();
  const aside = useAside();
  const cm = useContextMenu();
  const recordMenu = useRecordMenu();
  const songsMenu = useSongsMenu();
  const make = useMakePlaylist();
  const { albums, keys, songs, all, facts } = useArtist(name, slug);
  const menu = useArtistMenu(name, slug, { onPage: size === "page" });
  const about = useAbout(slug);
  const lists = usePlaylistsWith(name);
  const { shelf } = useDesk();
  const page = size === "page";
  const [allSongs, setAllSongs] = useState(false);
  const mine = !!owned.track?.albumKey && keys.includes(owned.track.albumKey);
  const moving = mine && owned.status === "playing";
  const playSong = (t: OwnedTrack) => (t.albumKey ? void owned.playRecord(t.albumKey, t.title) : owned.playList([t], 0));

  // the artists like them that you have, for the playlist suggestion and the page's last row
  const alike = useMemo(() => {
    if (!about?.similar.length) return [];
    const bySlug = new Map(shelf.filter((a) => a.artistSlug).map((a) => [a.artistSlug!, a.artist]));
    return about.similar.filter((n) => bySlug.has(n.slug) && n.slug !== slug).map((n) => ({ slug: n.slug, name: bySlug.get(n.slug)! }));
  }, [about, shelf, slug]);
  const alikeSongs = useMemo(() => {
    if (!all || !alike.length) return [];
    const theirs = new Set(alike.map((a) => a.slug));
    return all.filter((t) => t.artistSlug && theirs.has(t.artistSlug));
  }, [all, alike]);

  const art = albums.length ? <Art src={artistCovers(albums, 600)} sizes={page ? "280px" : "380px"} priority /> : <WordArt name={name} accent="#6B5A44" />;
  const pills = (
    <div className={d.heroKeys}>
      <Pills>
        <PlayPill state={moving ? "pause" : "play"} disabled={!keys.length} onClick={() => (mine ? owned.toggle() : void owned.playRecords(keys))} />
        <ShufflePill disabled={!keys.length} onClick={() => void owned.playRecords(keys, { shuffle: true })} />
      </Pills>
      {page && menu && (
        <button type="button" className={d.moreKey} aria-label={`More for ${name}`} title="More" onClick={(e) => cm.open(e, menu)}>
          <Glyph name="more" size={15} />
        </button>
      )}
    </div>
  );
  const suggest = songs && songs.some((s) => s.subsonicTrackId) && (
    <div className={d.artistMake}>
      <p>
        <strong>Make a playlist from {name}.</strong> {alike.length ? `Their songs, or theirs with ${alike.slice(0, 2).map((a) => a.name).join(" and ")}${alike.length > 2 ? " and others like them" : ""} from your library.` : "Every song of theirs in your library, to shape from there."}
      </p>
      <div className={d.artistMakeKeys}>
        <Key onClick={() => void make(name, songs)}>
          <Glyph name="plus" size={13} />
          Their songs
        </Key>
        {alike.length > 0 && (
          <Key onClick={() => void make(`${name} and friends`, shuffled([...songs, ...alikeSongs]))}>
            <Glyph name="plus" size={13} />
            With artists like them
          </Key>
        )}
      </div>
    </div>
  );

  if (!page) {
    // the side view: the same things, closer together; their picture is what's selected (a click on it does
    // nothing), their name opens their page
    return (
      <div className={d.look}>
        <span className={d.lookArt} data-circle="">
          {art}
        </span>
        <div className={d.lookText}>
          <h2 className={d.lookTitle}>
            <Link href={deskArtistOf({ artist: name, artistSlug: slug })}>{name}</Link>
          </h2>
          <p className={d.lookFacts}>{facts}</p>
        </div>
        {pills}
        {songs && songs.length > 0 && <SideSongs songs={songs} name={name} slug={slug} />}
        <Section shout="Albums">
          <div className={d.lookSongs}>
            <Rows label={`${name}'s albums`}>
              {albums.map((a) => (
                <TrackRow
                  key={a.key}
                  art={<Art src={albumCovers(a, 48)} sizes="48px" size={48} />}
                  title={a.title}
                  line={a.year}
                  playing={owned.track?.albumKey === a.key}
                  live={owned.track?.albumKey === a.key && owned.status === "playing"}
                  label={`Look into ${a.title}`}
                  onClick={() => aside.select({ kind: "record", key: a.key })}
                />
              ))}
            </Rows>
          </div>
        </Section>
        {lists && lists.length > 0 && (
          <Section shout="On your playlists">
            <div className={d.lookSongs}>
              <Rows label="Playlists">
                {lists.map(({ p, count }) => (
                  <TrackRow
                    key={p.id}
                    art={p.cover ? <Art src={p.cover} sizes="48px" size={48} /> : <WordArt name={p.name} accent="#6B5A44" />}
                    title={p.name}
                    line={word(count, "song") + " of theirs"}
                    label={`Look into ${p.name}`}
                    onClick={() => aside.select({ kind: "playlist", id: p.id })}
                  />
                ))}
              </Rows>
            </div>
          </Section>
        )}
        {suggest}
        {cm.menu}
      </div>
    );
  }

  // the page: the side view, comfortable
  return (
    <div className={d.record}>
      <div className={d.recordTop}>
        <div className={d.artistFace}>{art}</div>
        <div>
          <p className={d.recordKicker}>In your library</p>
          <h1 className={d.recordTitle}>{name}</h1>
          <p className={d.recordFacts}>{facts}</p>
          {pills}
        </div>
      </div>
      <Section shout="Albums">
        <Grid min={150}>
          {albums.map((a) => (
            <AlbumTile key={a.key} a={a} line={a.year ?? ""} onMenu={(e, x) => cm.open(e, recordMenu(x))} />
          ))}
        </Grid>
      </Section>
      {songs && songs.length > 0 && (
        <section className={`${d.recordSongs} ${d.artistSection}`}>
          <Heading shout="Songs" answer={!allSongs && songs.length > PAGE_SONGS ? `${PAGE_SONGS} of ${songs.length}` : undefined} tone="quiet" />
          <SongTable
            label={`Songs by ${name}`}
            showArtist={false}
            rows={(allSongs ? songs : songs.slice(0, PAGE_SONGS)).map((t) => {
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
            onPlay={(i) => playSong(songs[i])}
            menu={(i, picked) => songsMenu(picked.map((r) => songs[r]), { play: [{ label: "Play", onSelect: () => playSong(songs[i]), disabled: !songs[i].subsonicTrackId }] })}
            dragOut={(_, picked, e) => dragSongs(e, () => picked.map((r) => songs[r]).filter((x) => !!x), { now: true })}
          />
          {!allSongs && songs.length > PAGE_SONGS && (
            <Key className={d.allSongs} onClick={() => setAllSongs(true)}>
              All {songs.length} songs
            </Key>
          )}
        </section>
      )}
      {lists && lists.length > 0 && (
        <Section shout="On your playlists">
          <Grid min={150}>
            {lists.map(({ p }) => (
              <PlaylistTile key={p.id} id={p.id} name={p.name} cover={p.cover} count={p.songs} />
            ))}
          </Grid>
        </Section>
      )}
      {suggest && <section className={d.artistSection}>{suggest}</section>}
      {alike.length > 0 && (
        <Section shout="Like them" answer="in your library">
          <div className={d.artistAlike}>
            {alike.map((a) => (
              <Link key={a.slug} href={deskArtist(a.slug)} className={d.chip}>
                {a.name}
              </Link>
            ))}
          </div>
        </Section>
      )}
      {cm.menu}
    </div>
  );
}

/** Their first songs in the side view: a click selects (Shift and Command, several), the play symbol plays. */
function SideSongs({ songs, name, slug }: { songs: OwnedTrack[]; name: string; slug: string | null }) {
  const owned = useOwned();
  const songsMenu = useSongsMenu();
  const cm = useContextMenu();
  const first = songs.slice(0, SIDE_SONGS);
  const picks = useSongPicks(first);
  return (
    <Section shout="Songs" answer={songs.length > SIDE_SONGS ? `${SIDE_SONGS} of ${songs.length}` : undefined} href={songs.length > SIDE_SONGS ? deskArtistOf({ artist: name, artistSlug: slug }) : undefined}>
      <div className={d.lookSongs}>
        <Rows label={`Songs by ${name}`}>
          {first.map((x, i) => {
            const on = !!x.subsonicTrackId && owned.track?.subsonicTrackId === x.subsonicTrackId;
            return (
              <TrackRow
                key={x.key}
                number={i + 1}
                art={<Art src={trackCovers(x, 48)} sizes="48px" size={48} />}
                title={x.title}
                line={x.album}
                length={len(x.seconds)}
                playing={on}
                live={on && owned.status === "playing"}
                dim={!x.subsonicTrackId}
                label={`Play ${x.title}`}
                selected={picks.isPicked(i)}
                onSelect={picks.onSelect(i)}
                onPlay={x.subsonicTrackId ? () => (on ? owned.toggle() : owned.playList(songs, i)) : undefined}
                onContextMenu={(e) => cm.open(e, songsMenu(picks.take(i), { play: [{ label: "Play", onSelect: () => owned.playList(songs, i), disabled: !x.subsonicTrackId }] }))}
                onDragOut={x.subsonicTrackId ? (e) => dragSongs(e, () => picks.take(i)) : undefined}
              />
            );
          })}
        </Rows>
      </div>
      {cm.menu}
    </Section>
  );
}

function shuffled<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

