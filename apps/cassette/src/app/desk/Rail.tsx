"use client";

/**
 * The side view: the right column, where what's selected is looked into and played from (the founder,
 * 2026-10-22: "everything should open in the right rail"; 2026-11-06: a word opens its thing in the middle,
 * anything else you click selects it, and this shows what's selected). One click on a record's, a
 * playlist's, an artist's or a station's picture shows it here; its name opens its page in the middle.
 * Here too: the picture is what's selected, so a click on it does nothing (a drag carries its songs); the
 * name opens the page. Nothing swaps what this shows on its own; its ← steps back through what it showed.
 * With nothing clicked it shows the record that's on. Its other tab is what's up next.
 *
 *   record    its cover, title, artist, facts, Play and Shuffle, its songs (a click plays from that song)
 *   playlist  the same, for a playlist: its songs in order
 *   artist    their records on the Mac, newest first (a click looks into one), Play and Shuffle all
 *   station   its art, what's on now, Tune in or Stop, then its about (with where it came from), where
 *             it's from and what it plays, its latest songs and the stations like it: the station
 *             page's own (2026-10-27)
 *
 * What you can do with the thing shown (open its page, edit it, delete it, add it to a playlist) is in
 * the ⋯ at the top, beside the tabs (2026-10-22), not in links under it.
 *
 * A YouTube preview's video sits above all of it (Player.tsx Booth) and the side view carries on
 * underneath, its pictures drawn small so a laptop's screen still has room to browse (the founder,
 * 2026-10-29); Up next is then the previews'.
 *
 * Songs here are the way into a playlist: a right click offers "Add to ...", and a song (or the cover,
 * for all of them) drags onto a playlist in the left rail.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useShell } from "@/app/dashboard/_shell/shell-context";
import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { Glyph, Pills, PlayPill, Rows, SavePill, Segmented, ShufflePill, TrackRow, useContextMenu, type MenuItem } from "@discovery/cassette-kit";
import { useRadio } from "@/app/components/radio/RadioProvider";
import { usePlayer } from "@/app/(taste)/_kit/player";
import { Art, PlaylistArt, albumCovers, trackCovers } from "./Art";
import { deletePlaylist, playlistPlayed, playlistSongs, playlistSongsNow, readPlaylistSongs } from "./playlists";
import { useAside, useDesk, type Look } from "./DeskShell";
import { useStationSave } from "./saved-stations";
import { useStationMenu } from "./station-menu";
import { Booth, PreviewUpNext, UpNext, tintCover, useStationDisc, useTint } from "./Player";
import { useQueueLines, useRadioSong, useRecordMenu, useSongsMenu, type RadioSong } from "./Shelves";
import { SONGS_MIME, dragSongs, useSongPicks } from "./picks";
import { useOwned } from "./owned";
import { ArtistView, useArtistMenu } from "./Artist";
import { MixArt, mixFacts, useMixMenu } from "./MadeForYou";
import { deskMix, useMix } from "./mixes";
import { deskAlbum, deskArtistOf, deskPlaylist, DESK, type DeskAlbum, type OwnedTrack } from "./types";
import { StationSide, useStationPage } from "@/app/components/radio/StationSide";
import { songLineOnRecord } from "@/lib/desk/song-credit";
import { offlineWords } from "./network";
import d from "./desk.module.css";

const mmss = (s: number | null | undefined) => (s == null || !Number.isFinite(s) ? null : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);
const songWord = (n: number) => `${n} ${n === 1 ? "song" : "songs"}`;
const recordWord = (n: number) => `${n} ${n === 1 ? "record" : "records"}`;
const minutesOf = (songs: OwnedTrack[]) => Math.round(songs.reduce((n, x) => n + (x.seconds ?? 0), 0) / 60);


/** The music isn't answering: said plainly, at the top of the side view (network.ts offlineWords). */
function Offline() {
  const { mac } = useDesk();
  const { head, rest } = offlineWords(mac?.name);
  return (
    <p className={d.offline} role="status">
      <Glyph name="laptop" size={16} />
      <span>
        <strong>{head}</strong>
        {rest && ` ${rest}`}
      </span>
    </p>
  );
}

/** A list of songs to look into: a click selects a song (Shift and Command, several), the play symbol on
 *  its number plays from it, a right click adds the picked songs, a drag carries them. Every list counts;
 *  a record's own counts by its track numbers and needs no covers, a playlist's or a mix's counts 1 on
 *  beside each song's cover. */
function SongRows({ songs, label, numbered, artistOf }: { songs: OwnedTrack[]; label: string; numbered?: boolean; artistOf?: string }) {
  const owned = useOwned();
  const songsMenu = useSongsMenu();
  const cm = useContextMenu();
  const picks = useSongPicks(songs);
  const menu = (i: number): MenuItem[] =>
    songsMenu(picks.take(i), {
      play: [
        { label: "Play", onSelect: () => owned.playList(songs, i), disabled: !songs[i].subsonicTrackId },
        { label: "Play from here, shuffled", onSelect: () => owned.playList(songs, i, { shuffle: true }), disabled: !songs[i].subsonicTrackId },
      ],
    });
  return (
    <div className={d.lookSongs}>
      <Rows label={label}>
        {songs.map((x, i) => {
          const on = !!x.subsonicTrackId && owned.track?.subsonicTrackId === x.subsonicTrackId;
          return (
            <TrackRow
              key={x.key}
              number={numbered ? (x.trackNo ?? i + 1) : i + 1}
              art={numbered ? undefined : <Art src={trackCovers(x, 48)} sizes="48px" size={48} />}
              title={x.title}
              // on its own record, a feature its file names ("feat. Thundercat"); in any other list, the
              // song's own artist when its file says more than the record's (lib/desk/song-credit)
              line={artistOf ? (songLineOnRecord(x.songArtist, artistOf) ?? (x.artist === artistOf ? null : x.artist)) : (x.songArtist ?? x.artist)}
              length={mmss(x.seconds)}
              playing={on}
              live={on && owned.status === "playing"}
              dim={!x.subsonicTrackId}
              label={`Play ${x.title}`}
              selected={picks.isPicked(i)}
              onSelect={picks.onSelect(i)}
              onPlay={x.subsonicTrackId ? () => (on ? owned.toggle() : owned.playList(songs, i)) : undefined}
              onContextMenu={(e) => cm.open(e, menu(i))}
              onDragStart={x.subsonicTrackId ? (e) => {
                const going = picks.take(i);
                dragSongs(e, going, going.length === 1 ? x.title : `${going.length} songs`);
              } : undefined}
            />
          );
        })}
      </Rows>
      {cm.menu}
    </div>
  );
}

/** The head every look shares: the art (what's selected: a click on it does nothing, a drag carries its
    songs), the name (the way to its page), a line, the facts, the pills. */
function LookHead({
  art,
  href,
  title,
  by,
  facts,
  pills,
  onDragArt,
  app,
  circle,
  tinted = "by",
}: {
  art: ReactNode;
  href?: string;
  title: string;
  /** which words wear the colour: the line under the name (a record's artist), or the name itself (a
      playlist, whose line is only its own note) */
  tinted?: "by" | "title";
  by?: ReactNode;
  facts?: string;
  pills?: ReactNode;
  onDragArt?: (e: DragEvent) => void;
  /** a station's mark: rounded like an app icon */
  app?: boolean;
  /** an artist: a circle */
  circle?: boolean;
}) {
  return (
    <>
      <span className={d.lookArt} data-circle={circle || undefined} data-app={app || undefined} draggable={onDragArt ? true : undefined} onDragStart={onDragArt}>
        {art}
      </span>
      <div className={d.lookText}>
        <h2 className={d.lookTitle} data-tinted={tinted === "title" || undefined}>
          {href ? <Link href={href}>{title}</Link> : title}
        </h2>
        {by && (
          <p className={d.lookBy} data-plain={tinted === "title" || undefined}>
            {by}
          </p>
        )}
        {facts && <p className={d.lookFacts}>{facts}</p>}
      </div>
      {pills}
    </>
  );
}


/* ── a record ── */

/** A record's songs as the Mac has them: the local copy first, so it's instant. */
function useRecordSongs(key: string) {
  const { recordTracks } = useOwned();
  const [got, setGot] = useState<{ key: string; songs: OwnedTrack[]; failed?: boolean } | null>(null);
  useEffect(() => {
    let gone = false;
    recordTracks(key).then(
      (songs) => !gone && setGot({ key, songs }),
      () => !gone && setGot({ key, songs: [], failed: true }),
    );
    return () => {
      gone = true;
    };
  }, [key, recordTracks]);
  return got?.key === key ? got : null;
}

function RecordLook({ a }: { a: DeskAlbum }) {
  const owned = useOwned();
  const got = useRecordSongs(a.key);
  const songs = got?.songs ?? null;
  const here = songs?.filter((x) => x.subsonicTrackId) ?? [];
  const mine = owned.track?.albumKey === a.key;
  const moving = mine && owned.status === "playing";
  const minutes = songs ? minutesOf(songs) : 0;
  const facts = [a.year, songs?.length ? songWord(songs.length) : null, minutes ? `${minutes} min` : null].filter(Boolean).join(" · ");
  const play = () => (mine ? owned.toggle() : songs ? owned.playList(songs, 0) : void owned.playRecord(a.key));
  return (
    <div className={d.look}>
      <LookHead
        art={<Art src={albumCovers(a, 600)} sizes="380px" priority />}
        href={deskAlbum(a)}
        title={a.title}
        by={<Link href={deskArtistOf(a)}>{a.artist}</Link>}
        facts={facts}
        onDragArt={songs ? (e) => dragSongs(e, songs, a.title) : undefined}
        pills={
          <Pills>
            <PlayPill state={moving ? "pause" : "play"} disabled={!!songs && here.length === 0} onClick={play} />
            <ShufflePill disabled={here.length < 2} onClick={() => owned.shuffleList(here)} />
          </Pills>
        }
      />
      {songs && songs.length > 0 && <SongRows songs={songs} label={a.title} numbered artistOf={a.artist} />}
      {songs && songs.length === 0 && !got?.failed && <p className={d.quiet}>None of its songs are in your library yet.</p>}
      {got?.failed && <p className={d.quiet}>{typeof navigator !== "undefined" && !navigator.onLine ? "This record's songs aren't saved for offline yet." : "Couldn't reach this record's songs."}</p>}
    </div>
  );
}

/* ── a playlist ── */

function PlaylistLook({ id }: { id: string }) {
  const { playlists } = useDesk();
  const owned = useOwned();
  const p = playlists.find((x) => x.id === id);
  // this window's copy at once, else the browser's kept one, then the cloud's answer behind it
  const [got, setGot] = useState<{ id: string; songs: OwnedTrack[] | null; failed?: boolean } | null>(() => {
    const now = playlistSongsNow(id);
    return now ? { id, songs: now } : null;
  });
  useEffect(() => {
    let gone = false;
    let heard = false;
    void readPlaylistSongs(id, (songs) => {
      heard = true;
      if (!gone) setGot({ id, songs });
    }).then((ok) => !ok && !heard && !gone && setGot({ id, songs: null, failed: true }));
    return () => {
      gone = true;
    };
  }, [id]);
  const songs = got?.id === id ? got.songs : null;
  const tint = useTint(p?.cover ?? null);
  if (!p) return <p className={d.quiet}>That playlist isn't here any more.</p>;
  const here = songs?.filter((x) => x.subsonicTrackId) ?? [];
  const minutes = songs ? minutesOf(songs) : 0;
  return (
    <div className={d.look} style={tint}>
      <LookHead
        art={<PlaylistArt id={p.id} name={p.name} cover={p.cover} sizes="380px" mode="visible" priority />}
        href={deskPlaylist(p.id)}
        title={p.name}
        tinted="title"
        by={p.description ?? undefined}
        facts={[songWord(songs?.length ?? p.songs), minutes ? `${minutes} min` : null].filter(Boolean).join(" · ")}
        onDragArt={(e) => e.preventDefault()}
        pills={
          <Pills>
            <PlayPill state="play" disabled={!!songs && here.length === 0} onClick={() => songs && (owned.playList(songs, 0), playlistPlayed(id))} />
            <ShufflePill disabled={here.length < 2} onClick={() => (owned.shuffleList(here), playlistPlayed(id))} />
          </Pills>
        }
      />
      {songs && songs.length > 0 && <SongRows songs={songs} label={p.name} />}
      {songs && songs.length === 0 && <p className={d.quiet}>Nothing in it yet. Drag songs onto it in the library.</p>}
      {got?.failed && <p className={d.quiet}>Couldn't reach this playlist.</p>}
    </div>
  );
}

/* ── a made-for-you playlist ── */

function MixLook({ id }: { id: string }) {
  const owned = useOwned();
  const m = useMix(id);
  if (m === undefined) return null;
  if (!m) return <p className={d.quiet}>That playlist isn't in today's.</p>;
  return (
    <div className={d.look}>
      <LookHead
        art={<MixArt m={m} sizes="380px" mode="visible" />}
        href={deskMix(m.id)}
        title={m.title}
        by={m.subtitle ?? "made for you"}
        facts={mixFacts(m)}
        onDragArt={(e) => e.preventDefault()}
        pills={
          <Pills>
            <PlayPill state="play" onClick={() => owned.playList(m.songs, 0)} />
            <ShufflePill disabled={m.songs.length < 2} onClick={() => owned.shuffleList(m.songs)} />
          </Pills>
        }
      />
      <SongRows songs={m.songs} label={m.title} />
    </div>
  );
}

/* ── a station ── */

/**
 * A station looked into: the shared station view (components/radio/StationSide), the website's right rail
 * draws the same. The desk's own here: its pictures (Art, hub-aware), Tune in through the desk's disc (it
 * knows when the Mac is offline), Save through the desk's own list, a song's click and right click the
 * desk's (its record in the middle column, or a search), a station like it shown here in the side view.
 */
function StationLook({ slug }: { slug: string }) {
  const { stations } = useDesk();
  const radio = useRadio();
  const save = useStationSave();
  const disc = useStationDisc();
  const aside = useAside();
  const on = radio.isCurrent(slug) && radio.status !== "idle";
  const heard = on ? radio.nowPlaying?.track : null;
  const page = useStationPage(slug, heard ? `${heard.artist}\u0000${heard.title}` : null);
  const song = useRadioSong();
  const cm = useContextMenu();
  const s = stations.find((x) => x.slug === slug);
  const tint = useTint(s?.image ?? null);
  if (!s) return <p className={d.quiet}>That station isn't on the dial any more.</p>;
  const tune = disc(s);
  // the stations like it as the desk has them: their marks and lines from its own list
  const similar = (page?.similar ?? []).map((x) => {
    const mine = stations.find((y) => y.slug === x.slug);
    return { slug: x.slug, name: x.name, image: mine?.image ?? null, accent: x.accent, line: mine?.kicker ?? x.sourceLabel };
  });
  return (
    <>
      <StationSide
        style={tint}
        classNames={{ look: d.look, art: d.lookArt, text: d.lookText, title: d.lookTitle }}
        station={{ slug: s.slug, name: s.name, image: s.image ?? null, accent: s.accent, kicker: s.kicker }}
        page={page}
        // tuned in, the radio's own line (it keeps itself fresh); else, or until it has one, the page's
        live={(on ? radio.nowPlaying : null) ?? page?.live ?? null}
        keys={
          <Pills>
            <PlayPill state={on ? "stop" : "play"} word={on ? "Stop" : "Tune in"} onClick={tune.onClick} />
            <SavePill saved={save.isSaved(s.slug)} onClick={() => save.toggle(s.slug)} />
          </Pills>
        }
        picture={(src, px, opts) => <Art src={src} sizes={`${px}px`} size={px < 100 ? px : undefined} priority={opts?.priority} />}
        songHit={(x) => ({ onClick: () => song.open(x), onContextMenu: (e) => cm.open(e, song.menu(x)), label: song.hint(x) })}
        similar={similar}
        stationHit={(x) => ({ onClick: () => aside.select({ kind: "station", slug: x.slug }), label: `Look into ${x.name}` })}
      />
      {cm.menu}
    </>
  );
}

/* ── the look's menu: everything you can do with what's shown, at the top (open its page, edit,
      delete, add to a playlist) ── */

function useLookMenu(look: Look | null, record: DeskAlbum | null, ask: (what: "delete-playlist") => void): MenuItem[] | null {
  const router = useRouter();
  const { playlists } = useDesk();
  const stationMenu = useStationMenu();
  const recordMenu = useRecordMenu();
  const queue = useQueueLines();
  const artistMenu = useArtistMenu(look?.kind === "artist" ? look.name : null, look?.kind === "artist" ? look.slug : null);
  const mixMenu = useMixMenu();
  const mix = useMix(look?.kind === "mix" ? look.id : "");
  if (!look) return null;
  if (look.kind === "mix") return mix ? mixMenu(mix) : null;
  if (look.kind === "record") return record ? recordMenu(record, { play: null }) : null;
  if (look.kind === "playlist") {
    const p = playlists.find((x) => x.id === look.id);
    if (!p) return null;
    return [
      ...queue(() => playlistSongs(p.id)),
      "separator",
      { label: "Open the playlist", onSelect: () => router.push(deskPlaylist(p.id)) },
      { label: "Rename…", onSelect: () => router.push(`${deskPlaylist(p.id)}?edit=1`) },
      { label: "Change the cover…", onSelect: () => router.push(`${deskPlaylist(p.id)}?cover=1`) },
      "separator",
      { label: "Delete playlist…", onSelect: () => ask("delete-playlist") },
    ];
  }
  if (look.kind === "artist") return artistMenu;
  return stationMenu(look.slug);
}

/** "Delete this playlist?", at the top of the side view, before anything goes. */
function DeletePlaylist({ id, onDone }: { id: string; onDone: () => void }) {
  const { playlists } = useDesk();
  const { showToast } = useShell();
  const aside = useAside();
  const router = useRouter();
  const p = playlists.find((x) => x.id === id);
  if (!p) return null;
  const drop = async () => {
    try {
      await deletePlaylist(p.id);
      onDone();
      aside.follow();
      if (window.location.pathname === deskPlaylist(p.id)) router.replace(`${DESK}/playlists`);
      router.refresh();
    } catch (e) {
      showToast((e as Error).message || "Couldn't delete that", { variant: "error" });
    }
  };
  return (
    <div className={d.lookConfirm} role="group" aria-label={`Delete ${p.name}?`}>
      <span>Delete {p.name}?</span>
      <button type="button" className={d.confirmYes} onClick={() => void drop()}>
        Delete
      </button>
      <button type="button" className={d.confirmNo} onClick={onDone}>
        Keep it
      </button>
    </div>
  );
}

/* ── the column ── */

const KIND_WORD: Record<Look["kind"], string> = { record: "Album", playlist: "Playlist", artist: "Artist", station: "Station", mix: "Playlist" };

export function Rail() {
  const aside = useAside();
  const owned = useOwned();
  const { shelf, resume } = useDesk();
  // what's looked into: the click, else the record that's on, else the last one played
  const playingKey = owned.track?.albumKey ?? resume?.key ?? null;
  const look: Look | null = aside.focus ?? (playingKey ? { kind: "record", key: playingKey } : null);
  const record = look?.kind === "record" ? (shelf.find((x) => x.key === look.key) ?? null) : null;
  const tint = useTint(record ? tintCover(record) : null);
  const [asking, setAsking] = useState<string | null>(null);
  const menu = useLookMenu(look, record, () => look?.kind === "playlist" && setAsking(look.id));
  const cm = useContextMenu();
  const preview = usePlayer();
  return (
    <aside className={d.aside} style={tint} aria-label="Side view" data-video={preview.track ? "" : undefined}>
      <Booth />
      <div className={d.asideHead} data-tauri-drag-region="deep">
        <Segmented<"look" | "queue">
          label="Show"
          value={aside.tab}
          onChange={(t) => t && aside.setTab(t)}
          options={[
            ["look", look ? KIND_WORD[look.kind] : "Album"],
            ["queue", "Up next"],
          ]}
        />
        <span className={d.asideKeys}>
          {/* putting the side view away is the player bar's key alone (the founder, 2026-10-27: one, not two) */}
          {aside.tab === "look" && menu && (
            <button type="button" className={d.topKey} aria-label="More" title="More" onClick={(e) => cm.open(e, menu)}>
              <Glyph name="more" size={16} />
            </button>
          )}
        </span>
        {cm.menu}
      </div>
      {asking && look?.kind === "playlist" && look.id === asking && <DeletePlaylist id={asking} onDone={() => setAsking(null)} />}
      <div className={d.asideBody}>
        {owned.reachable === false && <Offline />}
        {aside.tab === "queue" ? (
          preview.track ? <PreviewUpNext /> : <UpNext />
        ) : !look ? (
          <p className={d.quiet}>Click a record and it opens here.</p>
        ) : look.kind === "record" ? (
          record ? <RecordLook key={record.key} a={record} /> : <p className={d.quiet}>That album isn't in your library any more.</p>
        ) : look.kind === "playlist" ? (
          <PlaylistLook key={look.id} id={look.id} />
        ) : look.kind === "artist" ? (
          <ArtistView key={look.name} name={look.name} slug={look.slug} size="rail" />
        ) : look.kind === "mix" ? (
          <MixLook key={look.id} id={look.id} />
        ) : (
          <StationLook key={look.slug} slug={look.slug} />
        )}
      </div>
    </aside>
  );
}

/** A playlist in the left rail taking songs dragged out of the side view. */
export function usePlaylistDrop(to: { id: string; name: string }) {
  const { addToPlaylist } = useOwned();
  const [over, setOver] = useState(false);
  const takes = (e: DragEvent) => Array.from(e.dataTransfer.types).includes(SONGS_MIME);
  return {
    over,
    onDragEnter: (e: DragEvent) => {
      if (!takes(e)) return;
      e.preventDefault();
      setOver(true);
    },
    onDragOver: (e: DragEvent) => {
      if (!takes(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (e: DragEvent) => {
      if ((e.currentTarget as Element).contains(e.relatedTarget as Node | null)) return;
      setOver(false);
    },
    onDrop: (e: DragEvent) => {
      setOver(false);
      if (!takes(e)) return;
      e.preventDefault();
      try {
        const songs = JSON.parse(e.dataTransfer.getData(SONGS_MIME)) as OwnedTrack[];
        if (songs.length) void addToPlaylist(to, { songs });
      } catch {
        /* not ours */
      }
    },
  };
}

