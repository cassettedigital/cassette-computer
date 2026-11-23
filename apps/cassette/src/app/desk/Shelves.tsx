"use client";

/**
 * The library's own pages, drawn for a computer from the player kit (@discovery/cassette-kit): the
 * phone's parts and words where they carry over, and the desktop's own conventions where a pointer and
 * a keyboard do better than a finger. A record's own page is the web's album page (the taste
 * click-through), not a kit page: the founder's rule is one page per record.
 *
 * A click on a record looks into it in the side view (Player's Rail); a double click opens its page.
 *
 *   Home       On repeat as quick cards (many at once, one click back in), then shelves with paddles
 *   Albums     a grid or a list (a table you can sort by its headings), a right-click menu on every record
 *   Artists    a grid, each artist wearing their newest record
 *   Playlists  a grid; a playlist is the phone's header over a song table (select, double-click, Enter)
 *   Radio      what's on now across your stations, a section rail to jump with, the dial in two columns
 *   Devices    the Mac as the hub: a map of what it serves and to whom, and a device's records beside it
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { LayoutGrid, List } from "lucide-react";
import { useCoverAccent } from "@/app/_taste/colour";
import { RadioDial } from "@/app/components/radio/RadioDial";
import type { RadioNowPlaying } from "@/lib/radio/types";
import { useOwned } from "./owned";
import { PlaylistCoverPicker } from "@/app/dashboard/library/components/PlaylistCoverPicker";
import { choosePhoneAlbums, setPhonesGet, type PhonesGet } from "./phones";
import { createPlaylist, deletePlaylist, playlistPlayed, playlistSongs, setPlaylistCover, positionsAfterMove, removeFromPlaylist, renamePlaylist, reorderPlaylist } from "./playlists";
import type { HomeRow } from "@/lib/home/types";
import { Sleeve } from "@/app/_taste/Sleeve";
import { useSavedSongs } from "./saved-songs";
import { useHome, useOnMac } from "./home";
import { AllShelvesRow, FeatureCard, ReachRow } from "./Reach";
import { useShell } from "@/app/dashboard/_shell/shell-context";
import { askToConfirm } from "@/lib/ask";
import { dragRecord, dragSongs, useDragOver, type DragMusic } from "./drag";
import { inRecordOrder, loadSongs, songsOfRecordNow, useSongs } from "./songs";
import { SIDECAR_SAME_ORIGIN } from "@/lib/hub-origin";
import { revealInLibrary, revealLibrary } from "@/lib/library-remote";
import { computerWordsForUserAgent } from "@/lib/computer-words";
import { useOnline } from "./network";
import { collectInputFiles, pickMusicInApp, startIngest, useLibraryIngest } from "@/lib/library-ingest";
import { useCheckForNewMusic } from "@/lib/check-new-music";
import { MusicFolders } from "@/app/components/MusicFolders";
import { ripDoneCount } from "@/lib/rip-status";
import {
  Glyph,
  Grid,
  Heading,
  Hero,
  Key,
  Pills,
  PlayDisc,
  PlayPill,
  QuickCard,
  Segmented,
  ShelfSection,
  ShufflePill,
  SongTable,
  Stat,
  Stats,
  Tile,
  useContextMenu,
  WordArt,
  type MenuItem,
} from "@discovery/cassette-kit";
import { Art, PlaylistArt, albumCovers, artistCovers, trackCovers } from "./Art";
import { MixTile } from "./MadeForYou";
import { useMadeForYou } from "./mixes";
import { useAside, useDesk, type Look } from "./DeskShell";
import { useSavedStations } from "./saved-stations";
import { useRemoveFromLibrary } from "./remove";
import { useStationMenu } from "./station-menu";
import { useEditRecord } from "./Editors";
import { tintCover, useRecordDisc, useStartRecord, useStationDisc, useTint } from "./Player";
import { shareLines } from "./share";
import { DESK, deskAlbum, deskRecordPage, deskArtist, deskArtistOf, deskPlaylist, type DeskAlbum, type DeskData, type DeskDevice, type DeskDevices, type DeskHeld, type DeskPlaylistPage, type DeskRecordPage, type DeskStation, type OwnedTrack } from "./types";
import { PageBar, usePageBar } from "./PageBar";
import { useAbout } from "./Artist";
import { DiscArt, reading, useDisc } from "./disc";
import { useNotMain } from "./ThisComputer";
import { FIRST_ROW, showsFirstRun } from "./first-run";
import { importStatus } from "@/lib/import-status";
import { coverArtURL } from "@/lib/playback-remote";
import { HubPicture } from "@/app/components/HubPicture";
import d from "./desk.module.css";

/** The playlist with no cover of its own: the neutral record tint (CoverTint's fallback). */
const NEUTRAL = "#6B5A44";
export const songs = (n: number) => `${n} ${n === 1 ? "song" : "songs"}`;
export const records = (n: number) => `${n} ${n === 1 ? "album" : "albums"}`;

/** An artist tile's count (the founder, 2026-11-07): how many of their albums you have, as a number on
    the picture, only when there are several. No line under the name: the years read as when a band
    stopped (Coldplay "2000–2008"), and a count on every tile said nothing for the many with one album. */
export const artistCount = (albums: readonly unknown[]) => (albums.length > 1 ? { value: albums.length, label: records(albums.length) } : undefined);
const key = (t: string) => t.replace(/^[\s"“”'‘’(\[{<¡¿.]+/, "").replace(/^the\s+/i, "");
export const len = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : null);

/** A page's title: the phone's large title in the shout, a count in the quiet answer, a control at the end. */
export function PageHead({ title, trail }: { title: string; trail?: ReactNode }) {
  // the tools come first in the row (drawn on the right): when both don't fit, the title is what gives
  // way, hidden whole rather than cut to "AL…" (the rail already says where you are)
  return (
    <div className={d.pageHead}>
      {trail && <span className={d.pageTools}>{trail}</span>}
      <Heading as="h1" shout={title} tone="quiet" />
    </div>
  );
}

/**
 * "Play Next" and "Add to Queue" for a menu, the phone's two queue verbs, in its words (the founder,
 * 2026-10-29: the Mac takes them from the phone). For songs, an album by its key, or anything whose songs
 * have to be fetched first (an artist, a playlist).
 */
export function useQueueLines() {
  const owned = useOwned();
  return (what: OwnedTrack[] | { record: string } | (() => Promise<OwnedTrack[]>)): MenuItem[] => {
    const load = async () => (Array.isArray(what) ? what : typeof what === "function" ? await what() : await owned.recordTracks(what.record));
    return [
      { label: "Play Next", onSelect: () => void load().then(owned.playNext) },
      { label: "Add to Queue", onSelect: () => void load().then(owned.addToQueue) },
    ];
  };
}

/**
 * Putting music on a playlist, from a menu or a drop (drag.tsx): onto one you have (owned.tsx's add, which
 * leaves out the songs already on it), or onto a new one named after what's going on it: the album, the
 * song, the album or the artist several songs share.
 */
export function useAddToPlaylist() {
  const { playlists, shelf } = useDesk();
  const { addToPlaylist } = useOwned();
  const { showToast } = useShell();
  const router = useRouter();
  const nameFor = (what: DragMusic): string => {
    if ("record" in what) return shelf.find((a) => a.key === what.record)?.title ?? "New playlist";
    const [first] = what.songs;
    if (!first) return "New playlist";
    if (what.songs.length === 1) return first.title;
    if (what.songs.every((x) => x.album && x.album === first.album)) return first.album;
    if (what.songs.every((x) => x.artist && x.artist === first.artist)) return first.artist;
    return "New playlist";
  };
  const toNew = async (what: DragMusic) => {
    const name = nameFor(what);
    try {
      const id = await createPlaylist(name);
      await addToPlaylist({ id, name }, what);
      router.refresh();
    } catch (e) {
      showToast((e as Error).message, { variant: "error" });
    }
  };
  const toPlaylist = (id: string, what: DragMusic) => {
    const p = playlists.find((x) => x.id === id);
    if (p) void addToPlaylist(p, what);
  };
  return { playlists, toNew, toPlaylist };
}

/**
 * "Add to playlist" for a menu: one line that opens your playlists beside it (the kit's submenu), a new one
 * first, less the one you're in (the founder's wife, 2026-11-21: every playlist listed in the menu itself
 * made it long, and it only ever showed eight).
 */
export function usePlaylistAdds() {
  const { playlists, toNew, toPlaylist } = useAddToPlaylist();
  return (what: DragMusic, except?: string): MenuItem[] => {
    const to = playlists.filter((p) => p.id !== except);
    return [
      "separator",
      {
        label: "Add to playlist",
        submenu: [
          { label: "New playlist", onSelect: () => void toNew(what) },
          ...(to.length ? (["separator", ...to.map((p): MenuItem => ({ label: p.name, onSelect: () => toPlaylist(p.id, what) }))] as MenuItem[]) : []),
        ],
      },
    ];
  };
}

/** What the computer's own file window is called here: Show in Finder, Show in File Explorer. */
function revealWord(): string {
  return computerWordsForUserAgent(typeof navigator === "undefined" ? "" : navigator.userAgent).reveal;
}

/**
 * Show in Finder (Show in File Explorer on Windows) for a record or a song, from its right-click menu (the
 * founder, 2026-11-20: after adding music there was no way to see where it went). A record shows its
 * folder, a song its file. Only in the app, on the computer the music lives on: the website can't reach
 * the computer, and a second computer's copies came from the main one.
 */
function useShowInFiles() {
  const notMain = useNotMain();
  const { showToast } = useShell();
  return (target: { record: string } | { song: OwnedTrack }): MenuItem[] => {
    if (!SIDECAR_SAME_ORIGIN || notMain) return [];
    const isSong = "song" in target;
    const show = async () => {
      const songs = isSong ? [target.song] : (songsOfRecordNow(target.record) ?? (await loadSongs().catch(() => [] as OwnedTrack[])).filter((x) => x.albumKey === target.record));
      const id = songs.find((x) => x.subsonicTrackId)?.subsonicTrackId;
      if (!id || !(await revealInLibrary(id, isSong ? "song" : "record"))) showToast("Couldn't find that on this computer.", { variant: "error" });
    };
    return [{ label: revealWord(), onSelect: () => void show(), disabled: isSong && !target.song.subsonicTrackId }];
  };
}

/**
 * An album's menu, the same wherever the album shows (it was four menus, D-C5): its tile, the side view's
 * "…", its page's "…" and the sidebar. `here` says what changes with the place: `play`, the first lines
 * (a tile's Play by default; the sidebar's Play, Pause or Resume; none beside the side view's and the page's
 * pills), and `onPage`, on its own page, where "Go to the album" gives way to its page in the catalog. Then
 * Hide and Delete, each asking first (the founder, 2026-10-29), for an album in your library.
 */
export function useRecordMenu() {
  const router = useRouter();
  const st = useStartRecord();
  const adds = usePlaylistAdds();
  const editRecord = useEditRecord();
  const remove = useRemoveFromLibrary();
  const queue = useQueueLines();
  const showInFiles = useShowInFiles();
  const { shelf } = useDesk();
  return (a: Pick<DeskAlbum, "key" | "slug" | "artist" | "artistSlug">, here: { play?: MenuItem[] | null; onPage?: boolean } = {}): MenuItem[] => {
    const full = shelf.find((x) => x.key === a.key);
    const play: MenuItem[] = here.play === undefined ? [{ label: "Play", onSelect: () => void st.start(a.key) }] : (here.play ?? []);
    return [
      ...play,
      ...queue({ record: a.key }),
      "separator",
      ...(here.onPage ? [] : ([{ label: "Go to the album", onSelect: () => router.push(deskAlbum(a)) }] as MenuItem[])),
      { label: "Go to the artist", onSelect: () => router.push(deskArtistOf(a)) },
      ...(here.onPage && a.slug ? ([{ label: "Its page in the catalog", onSelect: () => router.push(deskRecordPage(a.slug!)) }] as MenuItem[]) : []),
      ...(full ? ([{ label: "Edit album…", onSelect: () => editRecord(full) }] as MenuItem[]) : []),
      ...adds({ record: a.key }),
      ...(full
        ? ([
            "separator",
            ...showInFiles({ record: full.key }),
            { label: "Hide album…", onSelect: () => void remove.hideAlbum(full) },
            { label: "Delete album…", onSelect: () => remove.deleteAlbum(full) },
          ] as MenuItem[])
        : []),
    ];
  };
}

/**
 * A song's right-click menu, the same wherever the song shows (the founder, 2026-10-27): the bar, the
 * full window, the side view's lists, every page's lists. Only its first lines change with the place,
 * how to play the song from there (`play`), and the song already playing has none. Then Copy Link and
 * Share… (desk/share.ts), where it's from, a place's own line (`extra`: a playlist's Remove), and the
 * playlists it can go on (`except` the one it's on).
 */
export function useSongMenu() {
  const router = useRouter();
  const adds = usePlaylistAdds();
  const queue = useQueueLines();
  const showInFiles = useShowInFiles();
  const { showToast } = useShell();
  const keep = useSavedSongs();
  return (t: OwnedTrack, at: { play?: MenuItem[]; extra?: MenuItem[]; except?: string } = {}): MenuItem[] => {
    const record = t.albumKey ? deskAlbum({ key: t.albumKey, slug: t.albumSlug }) : t.albumSlug ? deskAlbum(t.albumSlug) : null;
    const lead = [...(at.play ?? []), ...(t.subsonicTrackId ? queue([t]) : [])];
    // Saved songs (board #1162): a song of yours to come back to, pinned first in Playlists
    const save: MenuItem[] = t.cassetteLocalId
      ? [keep.isSaved(t) ? { label: "Remove from Saved songs", onSelect: () => keep.set([t], false) } : { label: "Save", onSelect: () => keep.set([t], true) }]
      : [];
    return [
      ...(lead.length ? [...lead, "separator" as const] : []),
      ...shareLines(t, showToast),
      "separator",
      { label: "Go to the album", onSelect: () => record && router.push(record), disabled: !record },
      { label: "Go to the artist", onSelect: () => router.push(deskArtistOf(t)), disabled: !t.artist && !t.artistSlug },
      ...showInFiles({ song: t }),
      ...(at.extra?.length ? ["separator" as const, ...at.extra] : []),
      ...save,
      ...adds({ songs: [t] }, at.except),
    ];
  };
}

/**
 * The right-click menu for the songs picked in a list: one song's own menu (useSongMenu), or for several,
 * what a group of songs can do: the queue's two verbs, a place's own line (`extra`: a playlist's Remove),
 * and the playlists they can go on.
 */
export function useSongsMenu() {
  const songMenu = useSongMenu();
  const adds = usePlaylistAdds();
  const queue = useQueueLines();
  const keep = useSavedSongs();
  return (list: OwnedTrack[], at: { play?: MenuItem[]; extra?: MenuItem[]; except?: string } = {}): MenuItem[] => {
    if (list.length === 1) return songMenu(list[0], at);
    const mine = list.filter((x) => x.subsonicTrackId);
    const unsaved = list.filter((x) => x.cassetteLocalId && !keep.isSaved(x));
    const save: MenuItem[] = list.some((x) => x.cassetteLocalId)
      ? [unsaved.length ? { label: "Save", onSelect: () => keep.set(unsaved, true) } : { label: "Remove from Saved songs", onSelect: () => keep.set(list, false) }]
      : [];
    return [
      { caption: `${list.length} songs` },
      ...(mine.length ? queue(mine) : []),
      ...(at.extra?.length ? ["separator" as const, ...at.extra] : []),
      ...save,
      ...adds({ songs: mine }, at.except),
    ];
  };
}

/** A song heard on the radio, as the station named it, with its record on Cassette when we have it. */
export type RadioSong = { title: string; artist: string; match?: RadioNowPlaying["match"] };

/**
 * A song heard on the radio, looked up on Cassette (the founder, 2026-10-28: "how do I go see it on
 * Cassette, now?"). A click goes to its record's page, or looks for it when we don't have the record;
 * a right click offers its record, its artist, a search, and the song's name to copy. One shape for
 * the station's log and the player bar, so a station's songs work the same wherever they show.
 */
export function useRadioSong() {
  const router = useRouter();
  const { showToast } = useShell();
  const search = (s: RadioSong) => `${DESK}/search?q=${encodeURIComponent(`${s.artist} ${s.title}`.slice(0, 80))}`;
  const open = (s: RadioSong) => router.push(s.match ? deskRecordPage(s.match.albumSlug) : search(s));
  const menu = (s: RadioSong): MenuItem[] => {
    const m = s.match;
    return [
      ...(m
        ? [
            { label: "Go to the album", onSelect: () => router.push(deskRecordPage(m.albumSlug)) },
            { label: "Go to the artist", onSelect: () => router.push(m.artistSlug ? deskArtist(m.artistSlug) : deskArtistOf({ artist: m.artistName, artistSlug: null })) },
            "separator" as const,
          ]
        : []),
      { label: "Look for it on Cassette", onSelect: () => router.push(search(s)) },
      {
        label: "Copy Song and Artist",
        onSelect: () => {
          void navigator.clipboard?.writeText(`${s.title} - ${s.artist}`).then(
            () => showToast("Copied"),
            () => {},
          );
        },
      },
    ];
  };
  return { open, menu, hint: (s: RadioSong) => (s.match ? `See ${s.match.title} on Cassette` : `Look for ${s.title} on Cassette`) };
}

/**
 * The click rule (the founder, 2026-11-06): a word opens its thing in the middle; anything else selects
 * it, and the side view shows what's selected; only a play symbol plays. One click on a thing's picture (a
 * record, a playlist, an artist, a station) selects it and the page stays put; one click on its name goes
 * to its page (the kit's Tile and QuickCard tell the two apart). No double click plays: the play symbol
 * does, so a click never changes what's on.
 */
export function useLook() {
  const aside = useAside();
  return (look: Look) => ({
    selected: aside.showing(look),
    onSelect: (e: MouseEvent) => {
      e.preventDefault();
      aside.select(look);
    },
  });
}

/** Play a set of records from your library in order: an artist's, a shelf's (its play disc). */
export function usePlayAlbums() {
  const owned = useOwned();
  return (albums: DeskAlbum[]) => void owned.playRecords(albums.map((a) => a.key));
}

export function AlbumTile({ a, line, onMenu }: { a: DeskAlbum; line?: string | null; onMenu?: (e: MouseEvent, a: DeskAlbum) => void }) {
  const disc = useRecordDisc();
  const look = useLook();
  const { track, status } = useOwned();
  return (
    <Tile
      disc="corner"
      art={<Art src={albumCovers(a, 200)} sizes="200px" />}
      title={a.title}
      line={line === undefined ? a.artist : line}
      href={deskAlbum(a)}
      {...look({ kind: "record", key: a.key })}
      play={disc(a)}
      playing={track?.albumKey === a.key && status === "playing"}
      onContextMenu={onMenu ? (e) => onMenu(e, a) : undefined}
      onMore={onMenu ? (e) => onMenu(e, a) : undefined}
      onDragOut={(e) => dragRecord(e, a)}
    />
  );
}

function StationArt({ s }: { s: Pick<DeskStation, "name" | "image" | "accent"> }) {
  return s.image ? <Art src={s.image} sizes="200px" /> : <WordArt name={s.name} accent={s.accent} />;
}

export function StationTile({ s, foot }: { s: DeskStation; foot?: ReactNode }) {
  const disc = useStationDisc();
  const look = useLook();
  const tune = disc(s);
  return <Tile shape="app" disc="corner" art={<StationArt s={s} />} title={s.name} line={foot ?? s.kicker} play={tune} {...look({ kind: "station", slug: s.slug })} />;
}

/**
 * Why a station is in Home's Radio row, said in its foot (the founder, 2026-11-07): saved by you; the
 * records of yours it sounds like, as "Like your" and their covers; or, on its turn on the dial, its
 * usual line. Every foot is the same height, so the row never grows.
 */
function StationFoot({ s, saved, like }: { s: DeskStation; saved: boolean; like: DeskAlbum[] }) {
  if (saved) {
    return (
      <span className={d.stFoot}>
        <Glyph name="check" size={13} />
        <span>Saved</span>
      </span>
    );
  }
  if (like.length) {
    return (
      <span className={d.stFoot}>
        <span className={d.stFootWord}>Like your</span>
        <span className={d.stFootCovers}>
          {like.map((a) => (
            <span key={a.key} className={d.stFootCover}>
              <Art src={albumCovers(a, 44)} sizes="22px" size={22} />
            </span>
          ))}
        </span>
        <span className={d.srOnly}>{like.map((a) => a.title).join(", ")}</span>
      </span>
    );
  }
  return (
    <span className={d.stFoot}>
      <span className={d.stFootLine}>{s.kicker}</span>
    </span>
  );
}

export function PlaylistTile({ id, name, cover, count }: { id: string; name: string; cover: string | null; count: number }) {
  const look = useLook();
  // songs or an album dragged onto it go on it (drag.tsx)
  const dropping = useDragOver(id);
  const { playList } = useOwned();
  const { showToast } = useShell();
  const [busy, setBusy] = useState(false);
  // a playlist plays from its tile, as a record does: its songs from this window or the kept copy
  const play = async () => {
    setBusy(true);
    try {
      const list = await playlistSongs(id);
      if (list.some((x) => x.subsonicTrackId)) {
        playList(list, 0);
        playlistPlayed(id);
      } else showToast("None of this playlist's songs are in your library yet");
    } catch {
      showToast("Couldn't reach that playlist");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Tile
      disc="corner"
      art={<PlaylistArt id={id} name={name} cover={cover} sizes="200px" mode="hover" />}
      title={name}
      line={songs(count)}
      href={deskPlaylist(id)}
      play={count > 0 ? { state: "play", label: `Play ${name}`, busy, onClick: () => void play() } : null}
      {...look({ kind: "playlist", id })}
      dropTarget={id}
      dropping={dropping}
    />
  );
}

/* ── Home ── */

/** A record as a quick card, washed in its own colour under the pointer. */
function QuickRecord({ a, on, live, onPlay, onMenu }: { a: DeskAlbum; on: boolean; live: boolean; onPlay: () => void; onMenu: (e: MouseEvent, a: DeskAlbum) => void }) {
  const tint = useCoverAccent(tintCover(a));
  const look = useLook();
  return (
    <QuickCard
      art={<Art src={albumCovers(a, 64)} sizes="64px" size={64} />}
      title={a.title}
      line={a.artist}
      href={deskAlbum(a)}
      {...look({ kind: "record", key: a.key })}
      playing={on}
      live={live}
      onPlay={onPlay}
      tint={tint}
      onContextMenu={(e) => onMenu(e, a)}
    />
  );
}

/** What the music pickers offer (the first-run Home's and the add card's). */
const MUSIC_FILES = ".flac,.mp3,audio/flac,audio/mpeg";

/**
 * Home before there's any music (lib first-run.ts; the founder, 2026-11-18: the old "Nothing in your library yet"
 * said what the page already showed and sent you to Devices to do anything). Adding is the page: drop
 * folders anywhere on the window or put a CD in, said once ("Rip it or drop it", the homepage's own line),
 * with one key. While something goes in, the add card takes the words' place (as Devices draws it, the
 * disc beside it), and the records land in a row of empty sleeves. The radio is under it, so there's
 * something to play in the first minute. A second computer takes no drop-ins (its music comes from the
 * main one, HereStrip above says so): it gets what has arrived and the radio.
 */
function FirstRun() {
  const data = useDesk();
  const ingest = useLibraryIngest();
  const disc = useDisc();
  const notMain = useNotMain();
  const pick = useRef<HTMLInputElement>(null);
  const landed = data.shelf.slice(0, FIRST_ROW);
  const stations = data.stations.slice(0, 12);
  const quiet = ingest.phase === "idle" && !(disc.shown && disc.status);
  return (
    <div className={d.page}>
      <h1 className={d.srOnly}>Home</h1>
      {notMain ? (
        landed.length > 0 && (
          <ShelfSection shout="On this computer">
            {landed.map((a) => (
              <AlbumTile key={a.key} a={a} />
            ))}
          </ShelfSection>
        )
      ) : (
        <section className={d.firstRun} aria-labelledby="first-run-head">
          {quiet ? (
            <div className={d.firstWords}>
              <h2 id="first-run-head" className={d.firstHead}>
                Rip it
                <br />
                or drop it.
              </h2>
              <p className={d.firstLine}>Drag folders of music anywhere on this window, or put a CD in the drive.</p>
              <div className={d.firstKeys}>
                <Key tone="fill" onClick={() => pickMusicInApp() || pick.current?.click()}>
                  Choose music
                </Key>
              </div>
              <input
                ref={pick}
                type="file"
                accept={MUSIC_FILES}
                multiple
                hidden
                onChange={(e) => {
                  const files = collectInputFiles(e.target.files);
                  if (files.length) void startIngest(files);
                  e.target.value = "";
                }}
              />
            </div>
          ) : (
            <>
              <h2 id="first-run-head" className={d.srOnly}>
                Adding music
              </h2>
              <AddMusicRow />
            </>
          )}
          <ol className={d.firstSlots} aria-label="Your records">
            {Array.from({ length: FIRST_ROW }, (_, i) => {
              const a = landed[i];
              if (a) return <AlbumTile key={a.key} a={a} />;
              const next = i === landed.length;
              return (
                <li key={`slot-${i}`} className={d.firstSlot}>
                  <span className={d.firstSleeve}>{next && <Glyph name="plus" size={26} />}</span>
                  {next && <span className={d.firstSlotWords}>{landed.length ? "The next one lands here" : "Your first record lands here"}</span>}
                </li>
              );
            })}
          </ol>
        </section>
      )}
      {stations.length > 0 && (
        <ShelfSection shout={notMain ? "Radio" : "Or put the radio on"} href={`${DESK}/radio`}>
          {stations.map((s) => (
            <StationTile key={s.slug} s={s} />
          ))}
        </ShelfSection>
      )}
    </div>
  );
}

/**
 * Home, as the cloud makes it for every device (home.ts, lib/home; One Home, founder 2026-10-28):
 * the rows in the cloud's order and under its names, each drawn from what's on this Mac and hidden
 * when nothing of it is. Resume leads, as on the phone.
 */
export function Home() {
  const data = useDesk();
  const aside = useAside();
  const home = useHome();
  const onMac = useOnMac();
  const { track, status, toggle, playList } = useOwned();
  const { showToast } = useShell();
  const st = useStartRecord();
  const menu = useRecordMenu();
  const cm = useContextMenu();
  const look = useLook();
  const onMenu = (e: MouseEvent, a: DeskAlbum) => cm.open(e, menu(a));
  const playOrToggle = (a: DeskAlbum, song?: string) => (track?.albumKey === a.key ? toggle() : void st.start(a.key, song));
  const stationOf = useMemo(() => new Map(data.stations.map((s) => [s.slug, s])), [data.stations]);
  const savedStations = useSavedStations();
  if (showsFirstRun(data.shelf.length)) return <FirstRun />;
  if (!home || !onMac) {
    return (
      <div className={d.page}>
        <h1 className={d.srOnly}>Home</h1>
      </div>
    );
  }
  const playPlaylist = async (id: string) => {
    try {
      const list = await playlistSongs(id);
      if (!list.some((x) => x.subsonicTrackId)) return showToast("None of this playlist's songs are in your library yet");
      playList(list, 0);
      playlistPlayed(id);
    } catch {
      showToast("Couldn't reach that playlist");
    }
  };
  const rowOf = (row: HomeRow): ReactNode => {
    switch (row.kind) {
      case "resume": {
        const a = row.record ? onMac.record(row.record) : null;
        const p = row.playlist ? data.playlists.find((x) => x.id === row.playlist) : null;
        // Resume leads Home as one wide card, not a lone quick card in a row of three (founder, 2026-10-28)
        if (p) {
          return (
            <section key={row.id}>
              <Heading shout={row.shout} />
              <FeatureCard
                size="wide"
                art={<PlaylistArt id={p.id} name={p.name} cover={p.cover} sizes="168px" mode="visible" />}
                glow={p.cover ? <Art src={p.cover} sizes="64px" size={64} /> : undefined}
                tint={p.cover}
                href={deskPlaylist(p.id)}
                onLook={() => aside.select({ kind: "playlist", id: p.id })}
                title={p.name}
                line={songs(p.songs)}
                play={{ state: "play", word: "Resume", onClick: () => void playPlaylist(p.id) }}
              />
            </section>
          );
        }
        if (!a) return null;
        const song = row.song ? onMac.song(row.song)?.title : undefined;
        const moving = track?.albumKey === a.key && status === "playing";
        return (
          <section key={row.id}>
            <Heading shout={row.shout} />
            <FeatureCard
              size="wide"
              art={<Art src={albumCovers(a, 300)} sizes="168px" />}
              glow={<Art src={albumCovers(a, 64)} sizes="64px" size={64} />}
              tint={tintCover(a)}
              href={deskAlbum(a)}
              onLook={() => aside.select({ kind: "record", key: a.key })}
              title={a.title}
              by={a.artist}
              play={{ state: moving ? "pause" : "play", word: moving ? undefined : "Resume", onClick: () => playOrToggle(a, song) }}
              onContextMenu={(e) => onMenu(e, a)}
            />
          </section>
        );
      }
      case "records": {
        const albums = onMac.records(row.records);
        if (!albums.length) return null;
        // On repeat keeps the Mac's quick cards; the rest are shelves
        if (row.id === "on-repeat") {
          return (
            <section key={row.id}>
              <Heading shout={row.shout} answer={row.answer || undefined} />
              <ol className={d.quickGrid}>
                {albums.slice(0, 6).map((a) => (
                  <QuickRecord key={a.key} a={a} on={track?.albumKey === a.key} live={track?.albumKey === a.key && status === "playing"} onPlay={() => playOrToggle(a)} onMenu={onMenu} />
                ))}
              </ol>
            </section>
          );
        }
        return (
          <ShelfSection key={row.id} shout={row.shout} answer={row.answer || undefined} href={row.id === "recently-added" ? `${DESK}/albums` : undefined}>
            {albums.map((a) => (
              <AlbumTile key={a.key} a={a} onMenu={onMenu} />
            ))}
          </ShelfSection>
        );
      }
      case "mixes": {
        const mixes = row.mixes.map(onMac.mix).filter((m): m is NonNullable<typeof m> => !!m);
        if (!mixes.length) return null;
        return (
          <ShelfSection key={row.id} shout={row.shout} answer={row.answer || undefined} href={`${DESK}/playlists`}>
            {mixes.map((m) => (
              <MixTile key={m.id} m={m} />
            ))}
          </ShelfSection>
        );
      }
      case "playlists":
        if (!row.playlists.length) return null;
        return (
          <ShelfSection key={row.id} shout={row.shout} answer={row.answer || undefined} href={`${DESK}/playlists`}>
            {row.playlists.map((p) => (
              <PlaylistTile key={p.id} id={p.id} name={p.name} cover={p.cover} count={p.songs} />
            ))}
          </ShelfSection>
        );
      case "stations": {
        const stations = row.stations.map((slug) => stationOf.get(slug)).filter((s): s is DeskStation => !!s);
        if (!stations.length) return null;
        // the records each suggested station sounds like, as this computer holds them
        const likeOf = (slug: string) => (row.like?.[slug] ?? []).map((r) => onMac.record(r)).filter((a): a is DeskAlbum => !!a);
        return (
          <ShelfSection key={row.id} shout={row.shout} answer={row.answer || undefined} href={`${DESK}/radio`}>
            {stations.map((s) => (
              <StationTile key={s.slug} s={s} foot={<StationFoot s={s} saved={savedStations.includes(s.slug)} like={likeOf(s.slug)} />} />
            ))}
          </ShelfSection>
        );
      }
      case "reach":
        return <ReachRow key={row.id} shelf={row.shelf} />;
      case "artists": {
        const artists = row.artists.map((x) => ({ x, albums: onMac.artist(x) })).filter(({ albums }) => albums.length > 0);
        if (!artists.length) return null;
        return (
          <ShelfSection key={row.id} shout={row.shout} answer={row.answer || undefined} href={`${DESK}/artists`}>
            {artists.map(({ x, albums }) => {
              const to = deskArtistOf({ artist: albums[0].artist, artistSlug: albums[0].artistSlug });
              return (
                <Tile
                  key={x.key}
                  shape="circle"
                  art={<Art src={artistCovers(albums, 200)} sizes="200px" />}
                  title={albums[0].artist}
                  count={artistCount(albums)}
                  href={to}
                  {...look({ kind: "artist", name: albums[0].artist, slug: albums[0].artistSlug })}
                />
              );
            })}
          </ShelfSection>
        );
      }
      case "all-shelves":
        return <AllShelvesRow key={row.id} />;
      case "new":
        // new from the artists you follow: catalog records, not yours, so each opens its page (its Preview and Buy are
        // there); nothing here plays (board #1162)
        if (!row.records.length) return null;
        return (
          <ShelfSection key={row.id} shout={row.shout} answer={row.answer || undefined}>
            {row.records.map((r) => (
              <Tile key={r.id} art={<Sleeve src={r.cover} title={r.title} sizes="200px" />} title={r.title} line={r.artist} href={`${DESK}/album/${r.slug}`} />
            ))}
          </ShelfSection>
        );
    }
  };
  return (
    <div className={d.page}>
      <h1 className={d.srOnly}>Home</h1>
      {home.rows.map(rowOf)}
      {cm.menu}
    </div>
  );
}

/* ── the A to Z: letter sections, and an index down the page's edge to jump with ── */

const LETTERS = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
const letterOf = (t: string) => {
  const f = key(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").charAt(0).toUpperCase();
  return /[A-Z]/.test(f) ? f : "#";
};
function byLetter<T>(list: T[], name: (x: T) => string): Array<[string, T[]]> {
  const m = new Map<string, T[]>();
  for (const x of list) {
    const l = letterOf(name(x));
    (m.get(l) ?? m.set(l, []).get(l)!).push(x);
  }
  return LETTERS.filter((l) => m.has(l)).map((l) => [l, m.get(l)!]);
}
const letterId = (scope: string, l: string) => `${scope}-${l === "#" ? "num" : l}`;

function LetterIndex({ scope, have }: { scope: string; have: string[] }) {
  return (
    <nav className={d.az} aria-label="Jump to a letter">
      {LETTERS.map((l) =>
        have.includes(l) ? (
          <button key={l} type="button" onClick={() => document.getElementById(letterId(scope, l))?.scrollIntoView({ block: "start", behavior: "smooth" })}>
            {l}
          </button>
        ) : (
          <span key={l} aria-hidden="true">
            {l}
          </span>
        ),
      )}
    </nav>
  );
}

/* ── Albums: a grid (with its size) or a list ── */

type Sort = "added" | "title" | "artist" | "year";
const SORT_LABEL: Record<Sort, string> = { added: "Added", title: "Title", artist: "Artist", year: "Year" };
type View = "grid" | "list";
const VIEW_KEY = "desk-taste-albums-view";
const SIZE_KEY = "desk-taste-albums-size";

function useStored<T extends string | number>(k: string, initial: T, read: (v: string) => T | null): [T, (v: T) => void] {
  const [v, setV] = useState<T>(initial);
  useEffect(() => {
    try {
      const got = localStorage.getItem(k);
      const parsed = got == null ? null : read(got);
      if (parsed != null) setV(parsed);
    } catch {}
  }, [k]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (x: T) => {
    setV(x);
    try {
      localStorage.setItem(k, String(x));
    } catch {}
  };
  return [v, set];
}

export function Albums({ q }: { q: string }) {
  const { shelf } = useDesk();
  const router = useRouter();
  const disc = useRecordDisc();
  const aside = useAside();
  const menu = useRecordMenu();
  const cm = useContextMenu();
  const [sort, setSort] = useState<Sort>("added");
  const [view, setView] = useStored<View>(VIEW_KEY, "grid", (v) => (v === "list" || v === "grid" ? v : null));
  const [size, setSize] = useStored<number>(SIZE_KEY, 168, (v) => (Number(v) >= 120 && Number(v) <= 260 ? Number(v) : null));
  const list = useMemo(() => {
    const needle = q.toLowerCase();
    const hits = needle ? shelf.filter((a) => a.title.toLowerCase().includes(needle) || a.artist.toLowerCase().includes(needle)) : shelf;
    const by = (f: (a: DeskAlbum) => string) => (x: DeskAlbum, y: DeskAlbum) => f(x).localeCompare(f(y), "en", { sensitivity: "base" });
    const sorted = [...hits];
    if (sort === "added") sorted.sort((x, y) => (y.added ?? "").localeCompare(x.added ?? ""));
    if (sort === "title") sorted.sort(by((a) => key(a.title)));
    if (sort === "artist") sorted.sort(by((a) => `${key(a.artist)} ${a.year ?? ""}`));
    if (sort === "year") sorted.sort((x, y) => (y.year ?? "").localeCompare(x.year ?? ""));
    return sorted;
  }, [shelf, q, sort]);
  // sorted by a name, the grid falls into letters; by date, into years (added) or decades
  const groups = useMemo<Array<[string, DeskAlbum[]]> | null>(() => {
    if (sort === "title") return byLetter(list, (a) => a.title);
    if (sort === "artist") return byLetter(list, (a) => a.artist);
    if (sort === "year") {
      const m = new Map<string, DeskAlbum[]>();
      for (const a of list) {
        const g = a.year ? `${a.year.slice(0, 3)}0s` : "Undated";
        (m.get(g) ?? m.set(g, []).get(g)!).push(a);
      }
      return [...m.entries()];
    }
    return null;
  }, [list, sort]);
  const lettered = sort === "title" || sort === "artist";
  const onMenu = (e: MouseEvent, a: DeskAlbum) => cm.open(e, menu(a));
  const tile = (a: DeskAlbum) => <AlbumTile key={a.key} a={a} line={sort === "year" ? `${a.year ?? "–"} · ${a.artist}` : a.artist} onMenu={onMenu} />;
  return (
    <div className={d.page}>
      <PageHead
        title={q ? `“${q}”` : "Albums"}
        trail={
          <div className={d.headTools}>
            <Segmented<Sort> label="Sort" value={sort} onChange={(v) => v && setSort(v)} options={(Object.keys(SORT_LABEL) as Sort[]).map((x) => [x, SORT_LABEL[x]])} />
            {view === "grid" && (
              <label className={d.sizer} title="Cover size">
                <span className={d.sizerSmall} aria-hidden="true" />
                <input type="range" min={120} max={260} step={4} value={size} onChange={(e) => setSize(Number(e.target.value))} aria-label="Cover size" />
                <span className={d.sizerBig} aria-hidden="true" />
              </label>
            )}
            <Segmented<View>
              label="View"
              value={view}
              onChange={(v) => v && setView(v)}
              options={[
                ["grid", "Grid", <LayoutGrid key="g" size={15} strokeWidth={2} aria-hidden="true" />],
                ["list", "List", <List key="l" size={15} strokeWidth={2} aria-hidden="true" />],
              ]}
            />
          </div>
        }
      />
      {q && (
        <p className={d.quiet}>
          <Link href={`${DESK}/albums`} className={d.plainLink}>
            Show all albums
          </Link>
        </p>
      )}
      {view === "grid" ? (
        <div className={lettered ? d.withIndex : undefined}>
          <div>
            {groups ? (
              groups.map(([g, as]) => (
                <section key={g} id={lettered ? letterId("albums", g) : undefined} className={d.group}>
                  <h2 className={d.groupHead}>{g}</h2>
                  <Grid min={size}>{as.map(tile)}</Grid>
                </section>
              ))
            ) : (
              <Grid min={size}>{list.map(tile)}</Grid>
            )}
          </div>
          {lettered && groups && <LetterIndex scope="albums" have={groups.map(([g]) => g)} />}
        </div>
      ) : (
        <div className={d.albumTable} role="grid" aria-label="Albums">
          <div className={d.atHead} role="row">
            <span />
            {(["title", "artist", "year", "added"] as Sort[]).map((c) => (
              <button key={c} type="button" role="columnheader" aria-sort={sort === c ? (c === "title" || c === "artist" ? "ascending" : "descending") : "none"} onClick={() => setSort(c)}>
                {SORT_LABEL[c]}
                {sort === c && <Glyph name="chevronRight" size={11} className={d.sortMark} />}
              </button>
            ))}
            <span />
          </div>
          {list.map((a) => {
            const play = disc(a);
            return (
              <div
                key={a.key}
                role="row"
                className={d.atRow}
                data-selected={aside.showing({ kind: "record", key: a.key }) || undefined}
                onClick={(e) => !(e.target as Element).closest("a, button") && aside.select({ kind: "record", key: a.key })}
                onContextMenu={(e) => onMenu(e, a)}
              >
                <span className={d.atArt}>
                  <Art src={albumCovers(a, 44)} sizes="44px" size={44} />
                </span>
                <Link href={deskAlbum(a)} className={d.atTitle} role="gridcell">
                  {a.title}
                </Link>
                <span role="gridcell" className={d.atCell}>
                  <Link href={deskArtistOf(a)} className={d.atLink}>
                    {a.artist}
                  </Link>
                </span>
                <span role="gridcell" className={d.atCell}>
                  {a.year ?? "–"}
                </span>
                <span role="gridcell" className={d.atCell}>
                  {a.added ? new Date(a.added).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "–"}
                </span>
                <span className={d.atPlay}>
                  <PlayDisc {...play} />
                </span>
              </div>
            );
          })}
        </div>
      )}
      {cm.menu}
      {list.length === 0 && (
        <p className={d.quiet}>
          Nothing in your library matches “{q}”.{" "}
          <button type="button" className={d.plainButton} onClick={() => router.push(`${DESK}/albums`)}>
            Show all
          </button>
        </p>
      )}
    </div>
  );
}

/* ── Artists: no photos (the founder: ours aren't good enough yet), so each holds a fan of up to three
      of their records, the phone's way for an artist without a picture, and how many when several ── */

type ArtistSort = "name" | "most" | "newest";
const ARTIST_SORT: Record<ArtistSort, string> = { name: "Name", most: "Most albums", newest: "Newest" };


export function Artists() {
  const { shelf } = useDesk();
  const look = useLook();
  const [sort, setSort] = useState<ArtistSort>("name");
  const artists = useMemo(() => {
    const m = new Map<string, { name: string; slug: string | null; albums: DeskAlbum[] }>();
    for (const a of shelf) {
      const e = m.get(a.artist) ?? m.set(a.artist, { name: a.artist, slug: a.artistSlug, albums: [] }).get(a.artist)!;
      e.albums.push(a);
    }
    const all = [...m.values()].map((e) => {
      const albums = e.albums.sort((x, y) => (y.year ?? "").localeCompare(x.year ?? ""));
      const added = albums.map((a) => a.added ?? "").sort().at(-1) ?? "";
      return { ...e, albums, added };
    });
    const byName = (x: { name: string }, y: { name: string }) => key(x.name).localeCompare(key(y.name), "en", { sensitivity: "base" });
    if (sort === "most") return all.sort((x, y) => y.albums.length - x.albums.length || byName(x, y));
    if (sort === "newest") return all.sort((x, y) => y.added.localeCompare(x.added));
    return all.sort(byName);
  }, [shelf, sort]);
  const groups = sort === "name" ? byLetter(artists, (x) => x.name) : null;
  const tile = (x: (typeof artists)[number]) => (
    <Tile
      key={x.name}
      shape="circle"
      art={<Art src={artistCovers(x.albums, 200)} sizes="200px" />}
      title={x.name}
      count={artistCount(x.albums)}
      href={deskArtistOf({ artist: x.name, artistSlug: x.slug })}
      {...look({ kind: "artist", name: x.name, slug: x.slug })}
    />
  );
  return (
    <div className={d.page}>
      <PageHead
        title="Artists"
        trail={<Segmented<ArtistSort> label="Sort" value={sort} onChange={(v) => v && setSort(v)} options={(Object.keys(ARTIST_SORT) as ArtistSort[]).map((x) => [x, ARTIST_SORT[x]])} />}
      />
      {groups ? (
        <div className={d.withIndex}>
          <div>
            {groups.map(([l, list]) => (
              <section key={l} id={letterId("artists", l)} className={d.group}>
                <h2 className={d.groupHead}>{l}</h2>
                <Grid min={168}>{list.map(tile)}</Grid>
              </section>
            ))}
          </div>
          <LetterIndex scope="artists" have={groups.map(([l]) => l)} />
        </div>
      ) : (
        <Grid min={168}>{artists.map(tile)}</Grid>
      )}
    </div>
  );
}

/* ── Playlists ── */

/**
 * Deleting a playlist, from its page's menu or the side view's: asked first the way every delete in the app
 * asks (lib/ask: the computer's own alert, as Delete album… does), then gone here and on the phones. Its songs
 * stay in the library. True when it went.
 */
export function useDeletePlaylist() {
  const { showToast } = useShell();
  const router = useRouter();
  return async (p: { id: string; name: string }): Promise<boolean> => {
    const yes = await askToConfirm(`Delete the playlist "${p.name}"?\n\nIt goes from your playlists here and on your phones. Its songs stay in your library.`, { ok: "Delete" });
    if (!yes) return false;
    try {
      await deletePlaylist(p.id);
    } catch (e) {
      showToast((e as Error).message || "Couldn't delete that playlist", { variant: "error" });
      return false;
    }
    showToast(`Deleted ${p.name}`);
    if (window.location.pathname === deskPlaylist(p.id)) router.replace(`${DESK}/playlists`);
    router.refresh();
    return true;
  };
}

export function Playlists() {
  const { playlists } = useDesk();
  const keep = useSavedSongs();
  const made = useMadeForYou();
  const router = useRouter();
  const { showToast } = useShell();
  const [making, setMaking] = useState(false);
  // a new playlist opens at once with its name ready to type, as a Mac's Music does
  const make = async () => {
    setMaking(true);
    try {
      const id = await createPlaylist("New playlist");
      router.push(`${deskPlaylist(id)}?edit=1`);
      router.refresh();
    } catch (e) {
      showToast((e as Error).message, { variant: "error" });
    } finally {
      setMaking(false);
    }
  };
  return (
    <div className={d.page}>
      <PageHead
        title="Playlists"
        trail={
          <Key onClick={make} disabled={making}>
            <Glyph name="plus" size={13} />
            New playlist
          </Key>
        }
      />
      {/* yours first, with no label: playlists here are yours unless said otherwise (the founder,
          2026-11-06); the ones we make for you are the extra, underneath and named */}
      {playlists.length === 0 && !keep.ids.length ? (
        <ListsEmpty make={make} making={making} />
      ) : (
        <Grid min={168}>
          {/* Saved songs, pinned first (board #1162): the songs of yours you saved */}
          {keep.ids.length > 0 && (
            <Tile
              art={<WordArt name="Saved songs" accent="#6B5A44" />}
              title="Saved songs"
              line={`${keep.ids.length} ${keep.ids.length === 1 ? "song" : "songs"}`}
              href={`${DESK}/saved`}
            />
          )}
          {playlists.map((p) => (
            <PlaylistTile key={p.id} id={p.id} name={p.name} cover={p.cover} count={p.songs} />
          ))}
        </Grid>
      )}
      {made && made.length > 0 && (
        <section className={d.madeSection}>
          <Heading shout="Made" answer="for you" tone="quiet" />
          <Grid min={168}>
            {made.map((m) => (
              <MixTile key={m.id} m={m} />
            ))}
          </Grid>
        </section>
      )}
    </div>
  );
}

/**
 * Playlists before there are any: what one is and the three ways to fill one, said once (the founder's wife,
 * 2026-11-21: nothing said how they work). The card itself takes songs or an album dragged onto it and starts
 * a playlist with them, as the sidebar's "New playlist" does during a drag (drag.tsx).
 */
function ListsEmpty({ make, making }: { make: () => void; making: boolean }) {
  const dropping = useDragOver("new");
  return (
    <section className={d.listsEmpty} data-drop-playlist="new" data-drop={dropping || undefined} aria-labelledby="lists-empty-head">
      <h2 id="lists-empty-head" className={d.listsEmptyHead}>
        Make a playlist
      </h2>
      <p className={d.firstLine}>Your own run of songs, from any of your albums, in the order you like. It plays here and on your phones.</p>
      <ul className={d.listsEmptyWays}>
        <li>
          <b>New playlist</b> starts an empty one for you to name.
        </li>
        <li>
          <b>Right-click</b> a song or an album, then choose Add to playlist.
        </li>
        <li>
          <b>Drag</b> songs or an album onto a playlist in the sidebar, or onto this card to start a new one with them.
        </li>
      </ul>
      <div className={d.firstKeys}>
        <Key tone="fill" onClick={make} disabled={making}>
          <Glyph name="plus" size={13} />
          New playlist
        </Key>
      </div>
    </section>
  );
}

export function PlaylistPage({ p }: { p: DeskPlaylistPage }) {
  const owned = useOwned();
  const queue = useQueueLines();
  const router = useRouter();
  const params = useSearchParams();
  const { showToast } = useShell();
  const songsMenu = useSongsMenu();
  const pm = useContextMenu();
  // the page's own copy, so an edit shows at once; the server's answer replaces it after a refresh
  const [cover, setCover] = useState(p.cover);
  useEffect(() => setCover(p.cover), [p.cover]);
  const tint = useTint(cover);
  const [list, setList] = useState(p.songs);
  useEffect(() => setList(p.songs), [p.songs]);
  const [name, setName] = useState(p.name);
  useEffect(() => setName(p.name), [p.name]);
  const [editing, setEditing] = useState(params.get("edit") === "1");
  // a menu's "Rename" asks by the address (?edit=1), here or arriving from elsewhere
  const askedRename = params.get("edit") === "1";
  useEffect(() => {
    if (askedRename) setEditing(true);
  }, [askedRename]);
  const deleteIt = useDeletePlaylist();
  const dropping = useDragOver(p.id);
  const field = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    if (!editing) return;
    cancelled.current = false;
    requestAnimationFrame(() => (field.current?.focus(), field.current?.select()));
  }, [editing]);

  const fail = (e: unknown, undo: () => void) => {
    undo();
    showToast((e as Error).message || "Couldn't save that", { variant: "error" });
  };
  // the picker opens from its cover, and from a menu's "Change the cover" (?cover=1, here or arriving
  // from elsewhere): it follows the address each time, and closing it takes the ask off the address
  const asked = params.get("cover") === "1";
  const [picking, setPicking] = useState(asked);
  useEffect(() => {
    if (asked) setPicking(true);
  }, [asked]);
  const pickCover = (open: boolean) => {
    setPicking(open);
    if (!open && asked) router.replace(deskPlaylist(p.id));
  };
  const chooseCover = async (url: string) => {
    const before = cover;
    setCover(url);
    try {
      await setPlaylistCover(p.id, url);
      router.refresh();
    } catch (e) {
      fail(e, () => setCover(before));
    }
  };
  const saveName = async () => {
    if (cancelled.current) return;
    const next = (field.current?.value ?? name).trim();
    setEditing(false);
    if (params.get("edit")) router.replace(deskPlaylist(p.id));
    if (!next || next === p.name) return;
    setName(next);
    try {
      await renamePlaylist(p.id, next);
      router.refresh();
    } catch (e) {
      fail(e, () => setName(p.name));
    }
  };
  // the picked songs out (one, or several picked with Shift and Command)
  const remove = async (rows: number[]) => {
    const gone = rows.map((i) => list[i]).filter((x): x is OwnedTrack => !!x);
    if (!gone.length) return;
    const before = list;
    const out = new Set(gone.map((x) => x.key));
    setList(list.filter((x) => !out.has(x.key)));
    try {
      await removeFromPlaylist(p.id, gone.map((x) => x.key));
      showToast(gone.length === 1 ? `Removed ${gone[0].title}` : `Removed ${gone.length} songs`);
      router.refresh();
    } catch (e) {
      fail(e, () => setList(before));
    }
  };
  const move = async (from: number, to: number) => {
    const before = list;
    const next = [...list];
    const [it] = next.splice(from, 1);
    const at = to > from ? to - 1 : to;
    next.splice(at, 0, it);
    const moves = positionsAfterMove(next, at);
    const byKey = new Map(moves.map((m) => [m.itemId, m.position]));
    setList(next.map((x) => (byKey.has(x.key) ? { ...x, position: byKey.get(x.key) } : x)));
    try {
      await reorderPlaylist(p.id, moves);
    } catch (e) {
      fail(e, () => setList(before));
    }
  };

  // the Mac plays them in the playlist's order; a song that isn't on this Mac is dimmed and skipped
  const onMac = list.filter((x) => x.subsonicTrackId).length;
  const mine = !!owned.track?.subsonicTrackId && list.some((x) => x.subsonicTrackId === owned.track!.subsonicTrackId);
  const moving = mine && owned.status === "playing";
  const bar = usePageBar<HTMLDivElement>();
  const minutes = Math.round(list.reduce((n, x) => n + (x.seconds ?? 0), 0) / 60);
  const meta = [songs(list.length), minutes ? `${minutes} min` : null].filter(Boolean).join(" · ");
  const title = editing ? (
    <input
      ref={field}
      className={d.nameField}
      defaultValue={name}
      aria-label="Playlist name"
      maxLength={200}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") void saveName();
        if (e.key === "Escape") {
          cancelled.current = true;
          setEditing(false);
          if (params.get("edit")) router.replace(deskPlaylist(p.id));
        }
      }}
      onBlur={() => void saveName()}
    />
  ) : (
    <span className={d.nameText} onDoubleClick={() => setEditing(true)} title="Double-click to rename">
      {name}
    </span>
  );
  const playPills = (
    <Pills>
      <PlayPill state={moving ? "pause" : "play"} disabled={onMac === 0} onClick={() => (mine ? owned.toggle() : (owned.playList(list, 0), playlistPlayed(p.id)))} />
      <ShufflePill disabled={onMac < 2} onClick={() => (owned.shuffleList(list), playlistPlayed(p.id))} />
    </Pills>
  );
  return (
    <div className={d.page} style={tint}>
      <PageBar shown={bar.shown} art={<PlaylistArt id={p.id} name={p.name} cover={cover} sizes="44px" mode="hover" />} title={name}>
        {playPills}
      </PageBar>
      <Hero
        kind="playlist"
        art={
          // the cover is the way to a new one: the drawn covers, each moving as it would here
          <PlaylistCoverPicker
            playlistId={p.id}
            playlistName={p.name}
            current={cover}
            onCoverChosen={(url) => void chooseCover(url)}
            triggerClassName={d.coverPickKey}
            isOpen={picking}
            onOpenChange={pickCover}
            trigger={
              <span className={d.coverPick}>
                <PlaylistArt id={p.id} name={p.name} cover={cover} sizes="240px" mode="visible" priority />
                <span className={d.coverPickHint}>Change cover</span>
              </span>
            }
          />
        }
        title={title}
        answer={p.description ?? undefined}
        meta={meta}
      >
        <div className={d.heroKeys} ref={bar.ref}>
          {playPills}
          <button
            type="button"
            className={d.moreKey}
            aria-label="More for this playlist"
            onClick={(e) =>
              pm.open(e, [
                ...queue(list),
                "separator",
                { label: "Rename…", onSelect: () => setEditing(true) },
                { label: "Change the cover…", onSelect: () => pickCover(true) },
                "separator",
                { label: "Delete playlist…", onSelect: () => void deleteIt({ id: p.id, name }) },
              ])
            }
          >
            <Glyph name="more" size={15} />
          </button>
        </div>
      </Hero>
      {list.length === 0 && (
        // takes music dragged onto it, as its row in the sidebar does
        <p className={d.listEmpty} data-drop-playlist={p.id} data-drop={dropping || undefined}>
          Nothing on it yet. Right-click a song or an album and choose Add to playlist, or drag songs or an album here.
        </p>
      )}
      <SongTable
        label={name}
        rows={list.map((x) => {
          const on = !!x.subsonicTrackId && owned.track?.subsonicTrackId === x.subsonicTrackId;
          return {
            key: x.key,
            title: x.title,
            art: <Art src={trackCovers(x, 36)} sizes="36px" size={36} />,
            artist: x.artist,
            artistHref: x.artistSlug ? deskArtist(x.artistSlug) : undefined,
            album: x.album,
            albumHref: x.albumSlug ? deskAlbum(x.albumSlug) : undefined,
            length: len(x.seconds),
            playable: !!x.subsonicTrackId,
            playing: on,
            live: on && owned.status === "playing",
          };
        })}
        onPlay={(i) => (owned.playList(list, i), playlistPlayed(p.id))}
        onMove={(from, to) => void move(from, to)}
        dragOut={(_, picked, e) => dragSongs(e, () => picked.map((r) => list[r]).filter((x): x is OwnedTrack => !!x), { now: true })}
        onDelete={(_, picked) => void remove(picked)}
        menu={(i, picked) =>
          songsMenu(
            picked.map((r) => list[r]),
            {
              play: [{ label: "Play", onSelect: () => (owned.playList(list, i), playlistPlayed(p.id)) }],
              extra: [{ label: picked.length === 1 ? "Remove from this playlist" : `Remove ${picked.length} songs from this playlist`, onSelect: () => void remove(picked) }],
              except: p.id,
            },
          )
        }
      />
      {pm.menu}
    </div>
  );
}

/* ── Radio: the page's body is components/radio/RadioDial, the same page the website's account window draws ── */

export function Radio() {
  const online = useOnline();
  const { stations } = useDesk();
  const saved = useSavedStations();
  const disc = useStationDisc();
  // a click on a station looks into it in the side view (what it plays, what's on); its play disc tunes
  // in; a right click is the station's menu (station-menu.ts)
  const look = useLook();
  const cm = useContextMenu();
  const stationMenu = useStationMenu();
  return (
    <div className={d.page}>
      <PageHead title="Radio" />
      {!online && <p className={d.quiet}>Radio needs the internet.</p>}
      <RadioDial
        stations={stations}
        saved={saved}
        disc={disc}
        look={(slug) => look({ kind: "station", slug })}
        menuFor={(slug) => (e: MouseEvent) => cm.open(e, stationMenu(slug))}
      />
      {cm.menu}
    </div>
  );
}

/* ── Devices: the Mac is the hub. A map of what it serves and to whom, then one device in detail.
      Read-only: nothing here syncs, removes or rips; those stay on each device's own page. ── */

const LIGHT_WORD = { live: "Connected", idle: "Seen today", offline: "Away" } as const;

/* The map: rings around the computer (the founder, 2026-11-07, from round 2: "rings around the computer
   looks awesome"). Every device stays on the map; its ring says when it was last seen (today, this
   month, longer) and it draws smaller and quieter the further out it sits. No lines: distance is the
   whole message. Laid out on a fixed 640 x 360 plan that scales with the column. */
const PLAN = { w: 640, h: 360, x: 96, y: 180 };
const RINGS = [
  { r: 165, word: "Today", span: [-55, 39], one: 0 },
  { r: 320, word: "This month", span: [-25, 14], one: -14 },
  { r: 470, word: "Longer", span: [-16, 8], one: 4 },
] as const;
const DAY = 86_400_000;

/** Which ring a device sits on: 0 seen today (or connected), 1 within a month, 2 longer. */
function ringOf(dev: DeskDevice): 0 | 1 | 2 {
  if (dev.light !== "offline") return 0;
  const at = dev.seenAt ? Date.parse(dev.seenAt) : NaN;
  if (Number.isNaN(at)) return dev.stale ? 2 : 1;
  return Date.now() - at <= 31 * DAY ? 1 : 2;
}

/** When a device was last seen, in a word or two: now, today, yesterday, 10 days, 7 weeks, 3 months. */
function seenWords(dev: DeskDevice): string {
  if (dev.light === "live") return "now";
  const at = dev.seenAt ? Date.parse(dev.seenAt) : NaN;
  if (Number.isNaN(at)) return dev.light === "idle" ? "today" : "away";
  const days = Math.floor((Date.now() - at) / DAY);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days`;
  if (days < 70) return `${Math.round(days / 7)} weeks`;
  return `${Math.round(days / 30)} months`;
}

const onRing = (r: number, deg: number) => ({ x: PLAN.x + r * Math.cos((deg * Math.PI) / 180), y: PLAN.y + r * Math.sin((deg * Math.PI) / 180) });
const pct = (p: { x: number; y: number }): CSSProperties => ({ left: `${(p.x / PLAN.w) * 100}%`, top: `${(p.y / PLAN.h) * 100}%` });

function RingNode({ dev, ring, hub, selected, onSelect, onMenu, line }: { dev: DeskDevice; ring: 0 | 1 | 2 | "hub"; hub?: boolean; selected: boolean; onSelect: () => void; onMenu?: (e: MouseEvent) => void; line: string }) {
  return (
    <button type="button" className={d.ringNode} data-ring={ring} aria-pressed={selected} onClick={onSelect} onContextMenu={onMenu}>
      <span className={d.ringTile}>
        <Glyph name={dev.glyph} size={hub ? 26 : ring === 0 ? 22 : ring === 1 ? 16 : 13} />
        {(hub || ring === 0) && <i className={d.nodeLight} data-light={dev.light} aria-hidden="true" />}
      </span>
      <span className={d.ringName}>{dev.name}</span>
      <span className={d.ringWhen}>{line}</span>
    </button>
  );
}

function DeviceMap({ devices, selected, onSelect, onHubMenu }: { devices: DeskDevices; selected: string; onSelect: (id: string) => void; onHubMenu?: (e: MouseEvent) => void }) {
  // each ring's devices, newest seen first (the read already sorts them so), spread over the ring's room
  const placed = useMemo(() => {
    const by: DeskDevice[][] = [[], [], []];
    for (const p of devices.phones) by[ringOf(p)].push(p);
    return by.flatMap((list, i) => {
      const { r, span, one } = RINGS[i];
      return list.map((p, k) => {
        const deg = list.length === 1 ? one : span[0] + ((span[1] - span[0]) * k) / (list.length - 1);
        return { p, ring: i as 0 | 1 | 2, pos: onRing(r, deg) };
      });
    });
  }, [devices.phones]);
  return (
    <div className={d.rings}>
      <svg className={d.ringsArt} viewBox={`0 0 ${PLAN.w} ${PLAN.h}`} aria-hidden="true">
        {RINGS.map(({ r }, i) => {
          // as much of the ring as stays inside the plan, top to bottom
          const a = Math.min(70, (Math.asin(Math.min(1, (PLAN.h / 2 - 12) / r)) * 180) / Math.PI);
          const s0 = onRing(r, -a);
          const s1 = onRing(r, a);
          return <path key={r} className={d.ringLine} data-ring={i} d={`M${s0.x} ${s0.y} A${r} ${r} 0 0 1 ${s1.x} ${s1.y}`} />;
        })}
      </svg>
      {RINGS.map(({ r, word }) => {
        const a = Math.min(70, (Math.asin(Math.min(1, (PLAN.h / 2 - 12) / r)) * 180) / Math.PI);
        const end = onRing(r, a);
        return (
          <span key={word} className={d.ringWord} style={pct({ x: end.x + 8, y: end.y - 6 })} aria-hidden="true">
            {word}
          </span>
        );
      })}
      {devices.mac && (
        <span className={d.ringAt} style={pct(PLAN)}>
          <RingNode dev={devices.mac} ring="hub" hub selected={selected === "mac"} onSelect={() => onSelect("mac")} onMenu={onHubMenu} line="serving" />
          <span className={d.ringStat}>
            {devices.albumTotal} albums · {devices.songs.toLocaleString()} songs
          </span>
        </span>
      )}
      {placed.map(({ p, ring, pos }) => (
        <span key={p.id} className={d.ringAt} style={pct(pos)}>
          <RingNode dev={p} ring={ring} selected={selected === p.id} onSelect={() => onSelect(p.id)} line={seenWords(p)} />
        </span>
      ))}
    </div>
  );
}

/** A phone's choosing (BUG-898): its picture chooses or un-chooses the record for the phone, its name still opens it. */
type Choosing = { chosen: Set<string>; onPick: (key: string) => void; line: (a: DeskHeld, on: boolean) => ReactNode };

function HeldGrid({ list, choosing }: { list: DeskHeld[]; choosing?: Choosing }) {
  const look = useLook();
  const { shelf } = useDesk();
  if (list.length === 0) return <p className={d.quiet}>None.</p>;
  return (
    <Grid min={128}>
      {list.map((a) => {
        // one that's in your library too selects like any other (its picture), its name opens it
        const mine = a.slug ? shelf.find((x) => x.slug === a.slug) : undefined;
        const art = <Art src={a.covers ?? a.cover} sizes="150px" />;
        const href = a.slug ? deskAlbum(a.slug) : undefined;
        if (choosing) {
          const on = choosing.chosen.has(a.key);
          return <Tile key={a.key} art={art} title={a.title} line={choosing.line(a, on)} href={href} selected={on} onSelect={() => choosing.onPick(a.key)} />;
        }
        return <Tile key={a.key} art={art} title={a.title} line={a.artist} href={href} {...(mine ? look({ kind: "record", key: mine.key }) : {})} />;
      })}
    </Grid>
  );
}

type Held = "on" | "off" | "kept";

function DeviceDetail({ dev, devices }: { dev: DeskDevice; devices: DeskDevices }) {
  const { shelf } = useDesk();
  const [show, setShow] = useState<Held>("on");
  // what the phones get (the account's one switch) and what's chosen for this one (BUG-898), shown at once and
  // put back if the cloud doesn't take it
  const [scope, setScope] = useState<PhonesGet>(devices.scope ?? "everything");
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(dev.chosen ?? []));
  const [sentBack, setSentBack] = useState<Set<string>>(() => new Set());
  const [trouble, setTrouble] = useState<string | null>(null);
  useEffect(() => {
    setShow("on");
    setChosen(new Set(dev.chosen ?? []));
    setSentBack(new Set());
    setTrouble(null);
  }, [dev.id, dev.chosen]);
  useEffect(() => setScope(devices.scope ?? "everything"), [devices.scope]);
  const only = scope === "selective";
  const switchScope = async (next: PhonesGet) => {
    if (next === scope) return;
    const was = scope;
    setScope(next);
    setTrouble(null);
    // Going to "what you choose": every phone keeps what it has (each one's albums are chosen for it first),
    // since removals are live and an album not chosen would come off at the next pass.
    let kept = next !== "selective";
    if (!kept) {
      kept = true;
      for (const p of devices.phones) {
        const keys = p.held.map((a) => a.key);
        for (let i = 0; i < keys.length && kept; i += 500) kept = await choosePhoneAlbums(p.id, keys.slice(i, i + 500), true);
        if (!kept) break;
      }
      if (kept) setChosen((now) => new Set([...now, ...dev.held.map((a) => a.key)]));
    }
    if (!kept || !(await setPhonesGet(next))) {
      setScope(was);
      setTrouble("That didn't save. Try again.");
    }
  };
  const flip = (key: string, on: boolean) =>
    setChosen((now) => {
      const next = new Set(now);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  const pick = async (key: string) => {
    const on = !chosen.has(key);
    flip(key, on);
    setTrouble(null);
    if (!(await choosePhoneAlbums(dev.id, [key], on))) {
      flip(key, !on);
      setTrouble("That didn't save. Try again.");
    }
  };
  const sendBack = async (key: string) => {
    setSentBack((now) => new Set(now).add(key));
    flip(key, true);
    setTrouble(null);
    if (!(await choosePhoneAlbums(dev.id, [key], true))) {
      setSentBack((now) => {
        const next = new Set(now);
        next.delete(key);
        return next;
      });
      flip(key, false);
      setTrouble("That didn't save. Try again.");
    }
  };
  const keptOff = dev.keptOff.filter((a) => !sentBack.has(a.key));
  const total = devices.albumTotal || shelf.length;
  const notOn = useMemo(() => {
    const have = new Set(dev.held.flatMap((h) => [h.key, h.slug]).filter(Boolean));
    return shelf
      .filter((a) => !have.has(a.key) && !(a.slug && have.has(a.slug)))
      .map((a): DeskHeld => ({ key: a.key, title: a.title, artist: a.artist, slug: a.slug, cover: a.catalogCoverSmall, covers: albumCovers(a, 150) }));
  }, [dev.held, shelf]);
  const share = dev.albums != null && total ? Math.min(1, dev.albums / total) : 0;
  return (
    <section className={d.detail} aria-label={dev.name}>
      <Heading shout={dev.name} answer={(dev.name.toLowerCase() === dev.kind.toLowerCase() ? LIGHT_WORD[dev.light] : dev.kind).toLowerCase()} tone="quiet" />
      <Stats size="small">
        <Stat label="Albums on it" value={dev.albums != null ? `${dev.albums} of ${total}` : "–"} />
        <Stat label="Status" value={dev.seen === "Active" ? "Connected now" : dev.seen} />
        {only && <Stat label="Chosen" value={String(chosen.size)} />}
        {keptOff.length > 0 && <Stat label="Kept off" value={String(keptOff.length)} />}
      </Stats>
      <div className={d.coverage} aria-hidden="true">
        <i style={{ transform: `scaleX(${share})` }} />
      </div>
      <div className={d.detailTools}>
        {/* one switch for every phone on the account, so it says so */}
        <span className={d.toolGroup}>
          <span className={d.toolWord} aria-hidden="true">Phones get</span>
          <Segmented<PhonesGet>
            label="Phones get"
            value={scope}
            onChange={(v) => v && void switchScope(v)}
            options={[
              ["everything", "Everything"],
              ["selective", "What you choose"],
            ]}
          />
        </span>
        <Segmented<Held>
          label="Show"
          value={show}
          onChange={(v) => v && setShow(v)}
          options={[
            ["on", `On it · ${dev.held.length}`],
            ["off", `Not on it · ${notOn.length}`],
            ...(keptOff.length ? ([["kept", `Kept off · ${keptOff.length}`]] as Array<[Held, string]>) : []),
          ]}
        />
      </div>
      {trouble ? (
        <p className={d.quiet} role="status">{trouble}</p>
      ) : only && chosen.size === 0 && show !== "off" ? (
        <p className={d.quiet}>Nothing is chosen for {dev.name}, so it gets nothing new. Choose albums under Not on it.</p>
      ) : only && show === "off" ? (
        <p className={d.quiet}>Tap a cover to send it to {dev.name}. Tap it again to cancel.</p>
      ) : only && show === "on" ? (
        <p className={d.quiet}>Tap a cover to let it go: it comes off {dev.name}. Tap it again to keep it.</p>
      ) : show === "kept" ? (
        <p className={d.quiet}>Taken off {dev.name} on the phone. Tap a cover to send it back.</p>
      ) : null}
      <HeldGrid
        list={show === "on" ? dev.held : show === "off" ? notOn : keptOff}
        choosing={
          show === "kept"
            ? { chosen: new Set(), onPick: (key) => void sendBack(key), line: (a) => a.artist }
            : only && show === "off"
              ? { chosen, onPick: (key) => void pick(key), line: (a, on) => (on ? "On its way" : a.artist) }
              : only && show === "on"
                ? { chosen, onPick: (key) => void pick(key), line: (a, on) => (on ? a.artist : "Comes off") }
                : undefined
        }
      />
    </section>
  );
}

/** A row of covers that always fills: as many as the width holds, one row, cut cleanly (the founder,
    2026-10-31: grids never trail off half full). The heading's › opens the rest. */
function OneRow({ min, children }: { min: number; children: ReactNode[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(children.length);
  useLayoutEffect(() => {
    const grid = ref.current?.firstElementChild as HTMLElement | null;
    if (!grid) return;
    // the kit's Grid lays out auto-fill columns: the tracks it made are how many fit
    const read = () => setCols(Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length));
    read();
    const ro = new ResizeObserver(read);
    ro.observe(grid);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref}>
      <Grid min={min}>{children.slice(0, cols)}</Grid>
    </div>
  );
}

function MacDetail({ devices }: { devices: DeskDevices }) {
  const { shelf, mac } = useDesk();
  const menu = useRecordMenu();
  const cm = useContextMenu();
  const notMain = useNotMain();
  const { showToast } = useShell();
  const added = useMemo(() => [...shelf].filter((a) => a.added).sort((x, y) => (y.added! > x.added! ? 1 : -1)).slice(0, 16), [shelf]);
  const reachable = devices.phones.filter((p) => p.light === "live").length;
  if (!devices.mac) return null;
  return (
    <section className={d.detail} aria-label={devices.mac.name}>
      {/* the computer is the hub: what it holds and who's connected (never "in sync": with itself?) */}
      {/* the music folder itself, one click away in the computer's own file window (the founder, 2026-11-20),
          in the app on the computer the music lives on */}
      <div className={d.detailHead}>
        <Heading shout={mac?.name ?? devices.mac.name} answer="this computer" tone="quiet" />
        {SIDECAR_SAME_ORIGIN && !notMain && (
          <Key
            onClick={() => void revealLibrary().then((ok) => !ok && showToast("Couldn't open your music folder.", { variant: "error" }))}
            title="Your music folder"
          >
            {revealWord()}
          </Key>
        )}
      </div>
      <Stats size="small">
        <Stat label="Albums" value={String(devices.albumTotal || shelf.length)} />
        <Stat label="Songs" value={devices.songs.toLocaleString()} />
        <Stat label="Last sync" value={devices.mac.lastSync ?? mac?.synced ?? "–"} />
        <Stat label="Connected now" value={`${reachable} of ${devices.phones.length}`} />
      </Stats>
      {/* where the music lives (#1163): the Cassette folder, Check for new music, the folders Cassette reads */}
      <div className={d.macFolders}>
        <MusicFolders notify={showToast} reveal={false} />
      </div>
      <Heading shout="Newest" answer="in your library" href={`${DESK}/albums`} />
      <OneRow min={128}>
        {added.map((a) => (
          <AlbumTile key={a.key} a={a} onMenu={(e, x) => cm.open(e, menu(x))} />
        ))}
      </OneRow>
      {cm.menu}
    </section>
  );
}

/** Adding music, first on the page: a drop anywhere in the window (or Choose…) goes straight to your
    computer's music folder, never the cloud, and the card shows it going in. Beside it, while a disc is
    in, the disc at the same height (nothing jumps while it rips); its page has the rest. */
function AddMusicRow() {
  const ingest = useLibraryIngest();
  const disc = useDisc();
  const router = useRouter();
  const pick = useRef<HTMLInputElement>(null);
  const s = disc.status;
  const busy = ingest.phase === "uploading" || ingest.phase === "identifying";
  // the same words as the note at the window's foot and the sidebar's Devices line (lib/import-status)
  const imp = importStatus(ingest);
  const pct = imp?.progress === null || !imp ? null : Math.round(imp.progress * 100);
  const total = s?.trackCount ?? s?.tracks?.length ?? 0;
  const done = s ? ripDoneCount(s) : 0;
  return (
    <div className={d.addRow} data-two={(disc.shown && !!s) || undefined}>
      <div className={d.addCard}>
        {/* drawn as a key, so it is one: the same as Choose… (the founder, 2026-11-20: it looked pressable and wasn't) */}
        <button type="button" className={d.addPlus} onClick={() => pickMusicInApp() || pick.current?.click()} disabled={busy} aria-label="Choose music to add" title="Choose music to add">
          <Glyph name="plus" size={17} />
        </button>
        {ingest.phase === "idle" ? (
          <span className={d.addWords}>
            <span className={d.addTitle}>Add music</span>
            <span className={d.addLine}>Drop folders anywhere</span>
          </span>
        ) : (
          <span className={d.addWords}>
            <span className={d.addTitle}>
              {imp?.verb ?? "Adding"} {imp && imp.what !== "your music" ? `“${imp.what}”` : "music"}
            </span>
            <span className={d.addLine}>{imp?.line ?? ""}</span>
            {/* one bar from the first song to the last lookup: it counts the copy, then the lookups, and runs
                while there's nothing to count yet; never sits full while the work goes on */}
            {busy && (
              <span className={d.addBar} data-run={pct === null || undefined} aria-hidden="true">
                <i style={{ width: `${pct ?? 0}%` }} />
              </span>
            )}
            {/* the records as the computer finds them, each lit once MusicBrainz knows it */}
            {!!imp?.albums.length && (
              <span className={d.addFound} aria-label={`Found ${imp.albums.map((a) => a.album).join(", ")}`}>
                {imp.albums.map((a) => {
                  const src = a.trackId ? coverArtURL(a.trackId, 80) : null;
                  return (
                    <span key={`${a.artist}|${a.album}`} className={d.addFoundArt} data-found={a.found || undefined} title={`${a.album} · ${a.artist}`}>
                      {src && <HubPicture src={src} alt="" />}
                    </span>
                  );
                })}
              </span>
            )}
          </span>
        )}
        <Key onClick={() => pickMusicInApp() || pick.current?.click()} disabled={busy}>
          Choose…
        </Key>
        <input
          ref={pick}
          type="file"
          accept={MUSIC_FILES}
          multiple
          hidden
          onChange={(e) => {
            const files = collectInputFiles(e.target.files);
            if (files.length) void startIngest(files);
            e.target.value = "";
          }}
        />
      </div>
      {disc.shown && s && (
        <div className={d.addCard} data-moving={disc.moving || undefined}>
          <button type="button" className={d.addDiscArt} onClick={() => router.push(`${DESK}/disc`)} aria-label={`Open ${s.album ?? "the disc"}`}>
            <DiscArt cover={disc.cover} sizes="72px" spin={reading(s)} />
            {disc.moving && <span className={d.discRing} style={{ "--done": `${total ? Math.round((done / total) * 100) : 0}%` } as CSSProperties} aria-hidden="true" />}
          </button>
          <button type="button" className={d.addWords} onClick={() => router.push(`${DESK}/disc`)}>
            <span className={d.addKick}>{disc.moving ? `Ripping ${done} of ${total}` : s.state === "done" ? "In your library" : reading(s) ? "Reading…" : "Disc in"}</span>
            <span className={d.addTitle}>{s.album?.trim() || "Audio CD"}</span>
            <span className={d.addLine}>{s.albumArtist ?? ""}</span>
          </button>
          {disc.sure && !s.alreadyInLibrary && (
            <Key tone="fill" onClick={disc.rip} disabled={disc.busy}>
              Rip
            </Key>
          )}
          {s.discPresent && !disc.moving && s.state !== "detecting" && (
            <Key onClick={disc.eject} disabled={disc.busy} aria-label="Eject" title="Eject">
              <Glyph name="eject" size={13} />
            </Key>
          )}
        </div>
      )}
    </div>
  );
}

export function Devices({ devices }: { devices: DeskDevices | null }) {
  const [selected, setSelected] = useState("mac");
  const pick = devices?.phones.find((p) => p.id === selected) ?? null;
  const { showToast } = useShell();
  const check = useCheckForNewMusic(showToast);
  const hubMenu = useContextMenu();
  // the computer's right-click (the founder, 2026-11-23): look for new music now, in every folder
  const onHubMenu = (e: MouseEvent) =>
    hubMenu.open(e, [
      {
        label: check.checking ? "Checking for new music…" : "Check for new music",
        disabled: check.checking,
        onSelect: () => {
          showToast("Checking for new music…");
          void check.run();
        },
      },
      { label: computerWordsForUserAgent(navigator.userAgent).openFolder, onSelect: () => void revealLibrary() },
    ]);
  return (
    <div className={d.page}>
      <PageHead title="Devices" />
      <AddMusicRow />
      {!devices ? (
        <p className={d.quiet}>No devices yet.</p>
      ) : (
        <>
          <DeviceMap devices={devices} selected={selected} onSelect={setSelected} onHubMenu={onHubMenu} />
          {hubMenu.menu}
          {pick ? <DeviceDetail dev={pick} devices={devices} /> : <MacDetail devices={devices} />}
        </>
      )}
    </div>
  );
}

/* ── a record on your Mac, as a page: the player and nothing else (Q5), drawn the way every record,
      playlist and mix page is (the kit's Hero: the cover lit by its own colour, the name, the keys right
      under it), the songs below, and a slim bar that keeps the keys in reach once the head scrolls away.
      The press lives on the record's page in the catalog ("Its page in the catalog" in the "…" menu) ── */

export function OwnedRecord({ r }: { r: DeskRecordPage }) {
  const owned = useOwned();
  const recordMenu = useRecordMenu();
  const songsMenu = useSongsMenu();
  const a = r.album;
  const editRecord = useEditRecord();
  const rm = useContextMenu();
  const bar = usePageBar<HTMLDivElement>();
  const tint = useTint(tintCover(a));
  const { shelf } = useDesk();
  const about = useAbout(a.artistSlug);
  const moreBy = useMemo(() => shelf.filter((x) => x.artist === a.artist && x.key !== a.key).sort((x, y) => (y.year ?? "").localeCompare(x.year ?? "")), [shelf, a.artist, a.key]);
  const beside = useMemo(() => {
    const like = new Set(about?.similar.map((x) => x.slug) ?? []);
    return like.size ? shelf.filter((x) => x.key !== a.key && x.artist !== a.artist && x.artistSlug && like.has(x.artistSlug)) : [];
  }, [about, shelf, a.key, a.artist]);
  const onMac = r.songs.filter((x) => x.subsonicTrackId).length;
  const mine = owned.track?.albumKey === a.key || (!!owned.track?.subsonicTrackId && r.songs.some((x) => x.subsonicTrackId === owned.track!.subsonicTrackId));
  const moving = mine && owned.status === "playing";
  const play = (i: number) => owned.playList(r.songs, i);
  const facts = [a.year, songs(r.songs.length), r.minutes ? `${r.minutes} min` : null, onMac < r.songs.length ? `${onMac} in your library` : null].filter(Boolean).join(" · ");
  const keys = (
    <>
      <Pills>
        <PlayPill state={moving ? "pause" : "play"} disabled={onMac === 0} onClick={() => (mine ? owned.toggle() : play(0))} />
        <ShufflePill disabled={onMac < 2} onClick={() => owned.shuffleList(r.songs)} />
      </Pills>
      <button type="button" className={d.moreKey} aria-label="More for this album" title="More" onClick={(e) => rm.open(e, recordMenu(a, { play: null, onPage: true }))}>
        <Glyph name="more" size={15} />
      </button>
    </>
  );
  return (
    <div className={`${d.page} ${d.albumPage}`} style={tint}>
      <PageBar shown={bar.shown} art={<Art src={albumCovers(a, 120)} sizes="44px" size={44} />} title={a.title} by={a.artist}>
        {keys}
      </PageBar>
      <Hero
        art={
          // the cover is the way into the record's editor (its cover search first), as it was in the old library
          <button type="button" className={d.coverPickKey} onClick={() => editRecord(a)} aria-label="Edit this album">
            <span className={d.coverPick}>
              <Art src={albumCovers(a, 600)} sizes="240px" priority />
              <span className={d.coverPickHint}>Edit</span>
            </span>
          </button>
        }
        title={a.title}
        answer={<Link href={deskArtistOf(a)}>{a.artist}</Link>}
        meta={facts}
      >
        <div className={d.heroKeys} ref={bar.ref}>
          {keys}
        </div>
      </Hero>
      {rm.menu}
      <SongTable
        label={a.title}
        look="record"
        showAlbum={false}
        // the artist column only when the songs aren't all the album's (a compilation, a guest)
        showArtist={r.songs.some((x) => x.artist !== a.artist)}
        rows={r.songs.map((x) => {
          const on = !!x.subsonicTrackId && owned.track?.subsonicTrackId === x.subsonicTrackId;
          return {
            key: x.key,
            title: x.title,
            artist: x.artist,
            length: len(x.seconds),
            playable: !!x.subsonicTrackId,
            playing: on,
            live: on && owned.status === "playing",
          };
        })}
        onPlay={play}
        menu={(i, picked) => songsMenu(picked.map((x) => r.songs[x]), { play: [{ label: "Play", onSelect: () => play(i), disabled: !r.songs[i].subsonicTrackId }] })}
        dragOut={(_, picked, e) => dragSongs(e, () => picked.map((x) => r.songs[x]).filter((x): x is OwnedTrack => !!x), { now: true })}
      />
      {/* well below the last song, for whoever scrolls on (the founder, 2026-10-31: let what they came
          for breathe): the artist's other albums in your library, then yours by the artists like them */}
      {moreBy.length > 0 && (
        <section className={d.albumMore} aria-label={`More by ${a.artist}`}>
          <Heading shout="More by" answer={a.artist} />
          <OneRow min={150}>
            {moreBy.map((x) => (
              <AlbumTile key={x.key} a={x} line={x.year ?? null} onMenu={(e, y) => rm.open(e, recordMenu(y))} />
            ))}
          </OneRow>
        </section>
      )}
      {beside.length > 0 && (
        <section className={d.albumMore} aria-label="Sits beside it">
          <Heading shout="Sits beside it" answer="in your library" />
          <OneRow min={150}>
            {beside.map((x) => (
              <AlbumTile key={x.key} a={x} onMenu={(e, y) => rm.open(e, recordMenu(y))} />
            ))}
          </OneRow>
        </section>
      )}
    </div>
  );
}

/* ── an artist on your Mac, as a page: their records here, every song of theirs you have, played by the
      Mac, then the way on to their page ── */

/**
 * A record on your Mac drawn from what the window already holds, for when the cloud can't be reached
 * and this record was never opened here (BUG-542): the shelf's record and the Mac's song list (kept in
 * the browser), in their order, played by the Mac. No press: that lives in the cloud.
 */
export function RecordFromMac({ albumKey }: { albumKey: string }) {
  const { shelf } = useDesk();
  const all = useSongs(true);
  const album = shelf.find((a) => a.key === albumKey);
  const r = useMemo<DeskRecordPage | null>(() => {
    if (!album || !all) return null;
    const songs = inRecordOrder(all.filter((t) => t.albumKey === albumKey), [albumKey]);
    return { album, songs, minutes: Math.round(songs.reduce((n, x) => n + (x.seconds ?? 0), 0) / 60), press: null };
  }, [album, all, albumKey]);
  if (!album) return <div className={d.lost}><p className={d.lostHead}>This album isn't in your library.</p></div>;
  if (!r) return <div className={d.record} />;
  return <OwnedRecord r={r} />;
}
