"use client";

/**
 * The deck's player: the records on the Mac, played by the Mac. This is the desk's view of the one
 * player the dashboard already drives (dashboard/_shell/shell-context): the window is a remote control,
 * the hub plays the files, and every second or so the shell reads back what the hub is really doing
 * (the song, playing or paused, where in it). Nothing here keeps its own idea of what's playing.
 *
 * What this adds is the desk's shape on top: a song carries its record's key, slug and artist page (the
 * shell's songs don't), so the deck can link back and a cover's disc can tell it's the record on. Those
 * are remembered for the songs the desk started; a song the hub was already playing finds its record
 * on the shelf by name.
 *
 * One sound at a time (lib/audio-lane): the shell announces the "hub" lane when it plays, which stops a
 * preview and the radio, and pauses the hub when either of them starts.
 *
 * The time: the shell hears the hub's position about once a second; the deck's scrubber walks it on in
 * between, a quarter second at a time, so it moves smoothly and snaps back to the hub's word each read.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useShell, type ShellTrack } from "@/app/dashboard/_shell/shell-context";
import { toBase64Url } from "@/lib/dashboard/library-group-keys";
import { swrRead } from "@/lib/read-cache";
import { inRecordOrder, loadSongs, songOfNow, songsOfRecordNow } from "./songs";
import type { DeskAlbum, OwnedTrack } from "./types";

export type Owned = {
  track: OwnedTrack | null;
  queue: OwnedTrack[];
  status: "playing" | "paused";
  /** the Mac answered (true), didn't (false), or hasn't been asked yet (null) */
  reachable: boolean | null;
  /** the record being fetched to start, by key */
  pending: string | null;
  /** play a list from a song, in order (shuffle turns off); `shuffle: true` starts there and mixes up the rest */
  playList: (list: OwnedTrack[], index?: number, opts?: { shuffle?: boolean }) => void;
  /** the Shuffle key: a random song first, the rest mixed, shuffle on */
  shuffleList: (list: OwnedTrack[]) => void;
  /** the phone's queue verbs (shell-context): right after the song playing, or at the end of what's coming */
  playNext: (list: OwnedTrack[]) => void;
  addToQueue: (list: OwnedTrack[]) => void;
  /** start a record on the Mac by its key, optionally on a named song */
  playRecord: (key: string, song?: string) => Promise<void>;
  /** a record's songs as the Mac has them (the local copy first), by its key */
  recordTracks: (key: string) => Promise<OwnedTrack[]>;
  /** play several records on the Mac in the order given (an artist's), or shuffled */
  playRecords: (keys: string[], opts?: { shuffle?: boolean }) => Promise<void>;
  /** add songs, or a whole record by its key, to one of your playlists */
  addToPlaylist: (to: { id: string; name: string }, what: { songs: OwnedTrack[] } | { record: string }) => Promise<void>;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  /** the Mac's player's own loudness, 0 to 1 */
  volume: number;
  setVolume: (v: number) => void;
  /** the shuffle switch acts on what's playing, as on the phone; repeat changes what the Mac does at the end */
  shuffle: boolean;
  toggleShuffle: () => void;
  repeat: "off" | "all" | "one";
  cycleRepeat: () => void;
};

const mmss = (s: number | null) => (s == null ? undefined : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);

/** A desk song as the shared player shell takes it. */
export const toShell = (t: OwnedTrack): ShellTrack => ({
  title: t.title,
  artist: t.artist,
  album: t.album,
  durationSeconds: t.seconds,
  duration: mmss(t.seconds),
  cassetteLocalId: t.cassetteLocalId ?? undefined,
  subsonicTrackId: t.subsonicTrackId ?? undefined,
  albumCoverUrl: t.cover,
  albumCoverOverrideUrl: t.coverOverride,
});

const norm = (s: string | undefined | null) => (s ?? "").trim().toLowerCase();

function createClock() {
  let value = 0;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(v: number) {
      if (v === value) return;
      value = v;
      for (const s of subs) s();
    },
    subscribe(cb: () => void) {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
  };
}

const Ctx = createContext<Owned | null>(null);
const ClockCtx = createContext<ReturnType<typeof createClock> | null>(null);

export function OwnedProvider({ shelf, children }: { shelf: DeskAlbum[]; children: ReactNode }) {
  const shell = useShell();
  const known = useRef(new Map<string, OwnedTrack>());
  const [pending, setPending] = useState<string | null>(null);

  // a song as the desk knows it: the one it started, else found on the shelf by its record's name
  const byName = useMemo(() => {
    const m = new Map<string, DeskAlbum>();
    for (const a of shelf) {
      const k = `${norm(a.artist)}\u0000${norm(a.title)}`;
      if (!m.has(k)) m.set(k, a);
      if (!m.has(norm(a.title))) m.set(norm(a.title), a);
    }
    return m;
  }, [shelf]);
  const fromShell = useCallback(
    (t: ShellTrack, i: number): OwnedTrack => {
      // started here, else in the Mac's song list (a queue started elsewhere, or before a reload); the
      // list also knows the song's own artist when what started it didn't carry one
      const started = t.subsonicTrackId ? known.current.get(t.subsonicTrackId) : undefined;
      const listed = t.subsonicTrackId ? songOfNow(t.subsonicTrackId) : null;
      const mine = started ? (started.songArtist === undefined && listed ? { ...started, songArtist: listed.songArtist } : started) : (listed ?? undefined);
      if (mine) return mine;
      const a = byName.get(`${norm(t.artist)}\u0000${norm(t.album)}`) ?? byName.get(norm(t.album));
      return {
        key: `${t.subsonicTrackId ?? t.title}-${i}`,
        subsonicTrackId: t.subsonicTrackId ?? null,
        cassetteLocalId: t.cassetteLocalId ?? null,
        title: t.title,
        artist: t.artist,
        album: t.album ?? a?.title ?? "",
        albumKey: a?.key ?? null,
        albumSlug: a?.slug ?? null,
        artistSlug: a?.artistSlug ?? null,
        cover: t.albumCoverUrl ?? a?.catalogCoverSmall ?? null,
        coverOverride: t.albumCoverOverrideUrl ?? a?.overrideCover ?? null,
        coverVersion: a?.localCoverVersion ?? null,
        seconds: t.durationSeconds ?? null,
      };
    },
    [byName],
  );

  const track = useMemo(() => (shell.nowPlaying ? fromShell(shell.nowPlaying, 0) : null), [shell.nowPlaying, fromShell]);
  const queue = useMemo(() => (shell.nowPlaying ? shell.upNext.map((t, i) => fromShell(t, i + 1)) : []), [shell.nowPlaying, shell.upNext, fromShell]);

  const { playFrom } = shell;
  const playList = useCallback(
    (list: OwnedTrack[], index = 0, opts?: { shuffle?: boolean }) => {
      for (const t of list) if (t.subsonicTrackId) known.current.set(t.subsonicTrackId, t);
      // the shell sends the Mac only the songs on it, from the chosen one, and says so when there are none
      playFrom(list.map(toShell), index, opts);
    },
    [playFrom],
  );
  const shuffleList = useCallback(
    (list: OwnedTrack[]) => {
      const here = list.filter((t) => t.subsonicTrackId);
      if (here.length) playList(here, Math.floor(Math.random() * here.length), { shuffle: true });
    },
    [playList],
  );

  const { showToast } = shell;
  const { playNext: shellPlayNext, addToQueue: shellAddToQueue } = shell;
  const queueUp = useCallback(
    (list: OwnedTrack[], where: "next" | "last") => {
      const here = list.filter((t) => t.subsonicTrackId);
      if (!here.length) return showToast("None of those songs are on your computer", { variant: "error" });
      for (const t of here) known.current.set(t.subsonicTrackId!, t);
      void (where === "next" ? shellPlayNext : shellAddToQueue)(here.map(toShell)).then((ok) => {
        if (!ok) showToast("Couldn't change Up Next", { variant: "error" });
      });
    },
    [shellPlayNext, shellAddToQueue, showToast],
  );
  const playNext = useCallback((list: OwnedTrack[]) => queueUp(list, "next"), [queueUp]);
  const addToQueue = useCallback((list: OwnedTrack[]) => queueUp(list, "last"), [queueUp]);
  // a record's songs as the Mac has them, through the library's own songs API. Read through the same
  // local copy the dashboard keeps (lib/read-cache, the shell's own `lib-album:` key), so a record
  // played before starts at once and still starts when the cloud doesn't answer; the cloud's answer
  // refreshes the copy for next time.
  const recordTracks = useCallback(
    async (key: string): Promise<OwnedTrack[]> => {
      const a = shelf.find((x) => x.key === key);
      // the Mac's song list this window already holds (kept in the browser, read at the window's start):
      // a record's songs straight from memory, with no round trip at all
      const now = songsOfRecordNow(key);
      if (now?.length) return now;
      // the first answer wins (the local copy when there is one); the read carries on to refresh it
      const tracks = await new Promise<ShellTrack[]>((resolve, reject) => {
        let done = false;
        void swrRead<{ tracks: ShellTrack[] }>(
          `lib-album:${toBase64Url(key)}`,
          async () => {
            const res = await fetch(`/api/sync/library/album/${toBase64Url(key)}/tracks`, { credentials: "include" });
            if (!res.ok) throw new Error(String(res.status));
            return (await res.json()) as { tracks: ShellTrack[] };
          },
          (v) => {
            if (done) return;
            done = true;
            resolve(v.tracks);
          },
        ).then(async ({ ok }) => {
          if (ok || done) return;
          // never played here and the cloud didn't answer: the Mac's song list knows the record's songs
          try {
            const mine = inRecordOrder((await loadSongs()).filter((t) => t.albumKey === key), [key]);
            if (mine.length) {
              done = true;
              resolve(mine.map(toShell));
              return;
            }
          } catch {
            /* no list either */
          }
          reject(new Error("record unavailable"));
        });
      });
      return tracks.map((t, i) => ({
        key: `${t.subsonicTrackId ?? t.title}-${i}`,
        subsonicTrackId: t.subsonicTrackId ?? null,
        cassetteLocalId: t.cassetteLocalId ?? null,
        title: t.title,
        artist: t.artist,
        album: a?.title ?? t.album ?? "",
        albumKey: key,
        albumSlug: a?.slug ?? null,
        artistSlug: a?.artistSlug ?? null,
        cover: t.albumCoverUrl ?? a?.catalogCoverSmall ?? null,
        coverOverride: t.albumCoverOverrideUrl ?? a?.overrideCover ?? null,
        coverVersion: a?.localCoverVersion ?? null,
        seconds: t.durationSeconds ?? null,
      }));
    },
    [shelf],
  );

  const playRecord = useCallback(
    async (key: string, song?: string) => {
      setPending(key);
      try {
        const list = await recordTracks(key);
        if (!list.length) {
          showToast("None of this album's songs are in your library yet");
          return;
        }
        const named = song ? list.findIndex((t) => norm(t.title) === norm(song)) : -1;
        playList(list, Math.max(0, named));
      } catch {
        // offline: the record was never played here and the song list isn't saved yet (BUG-542)
        showToast(navigator.onLine ? "Couldn't reach that album" : "This album isn't saved for offline yet");
      } finally {
        setPending(null);
      }
    },
    [recordTracks, playList, showToast],
  );

  const playRecords = useCallback(
    async (keys: string[], opts?: { shuffle?: boolean }) => {
      if (!keys.length) return;
      setPending(keys[0]);
      try {
        const lists = await Promise.all(keys.map((k) => recordTracks(k).catch(() => [] as OwnedTrack[])));
        const list = lists.flat();
        if (!list.length) showToast("None of their songs are in your library yet");
        else if (opts?.shuffle) shuffleList(list);
        else playList(list, 0);
      } finally {
        setPending(null);
      }
    },
    [recordTracks, playList, shuffleList, showToast],
  );

  // a playlist add: songs as they are, or a whole record in its order (the shell does the write)
  const { addTracksToPlaylist } = shell;
  const addToPlaylist = useCallback(
    async (to: { id: string; name: string }, what: { songs: OwnedTrack[] } | { record: string }) => {
      try {
        const songs = "songs" in what ? what.songs : await recordTracks(what.record);
        await addTracksToPlaylist(to.id, to.name, songs.map(toShell));
      } catch {
        showToast("Couldn't reach that album");
      }
    },
    [recordTracks, addTracksToPlaylist, showToast],
  );

  // The scrubber's clock keeps its own time and takes the hub's word only when it really differs. The
  // hub's position arrives up to a second old (five while paused), so snapping to every reading made
  // the time jump back on each pause and play and then forward again on the next read. Pause freezes
  // it where it is, play walks on from there; a new song, a seek or real drift (over 1.5s) resets it.
  const clockRef = useRef<ReturnType<typeof createClock> | null>(null);
  if (!clockRef.current) clockRef.current = createClock();
  const clock = clockRef.current;
  const { positionSeconds, durationSeconds, playing } = shell;
  const songId = shell.nowPlaying?.subsonicTrackId ?? shell.nowPlaying?.title ?? null;
  const cap = durationSeconds || track?.seconds || Infinity;
  const run = useRef({ pos: 0, from: 0, playing: false, song: null as string | null });
  const now = useCallback(() => {
    const r = run.current;
    return Math.min(cap, r.playing ? r.pos + (performance.now() - r.from) / 1000 : r.pos);
  }, [cap]);
  // a new song starts from the hub's word
  useEffect(() => {
    run.current = { pos: positionSeconds, from: performance.now(), playing, song: songId };
    clock.set(positionSeconds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId]);
  // the hub's reading: taken only when it disagrees by more than the reading's own lag
  useEffect(() => {
    if (Math.abs(positionSeconds - now()) <= 1.5) return;
    run.current = { ...run.current, pos: positionSeconds, from: performance.now() };
    clock.set(positionSeconds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionSeconds]);
  // pause freezes the time where it is; play walks on from there
  useEffect(() => {
    if (run.current.playing === playing) return;
    run.current = { ...run.current, pos: now(), from: performance.now(), playing };
    clock.set(run.current.pos);
  }, [playing, now, clock]);
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => clock.set(now()), 250);
    return () => window.clearInterval(id);
  }, [playing, now, clock]);

  // a seek moves the time at once, however small (the reading-lag tolerance above is for the hub's word)
  const { seek: shellSeek } = shell;
  const seek = useCallback(
    (to: number) => {
      run.current = { ...run.current, pos: to, from: performance.now() };
      clock.set(to);
      shellSeek(to);
    },
    [shellSeek, clock],
  );

  const value = useMemo<Owned>(
    () => ({
      track,
      queue,
      status: shell.playing ? "playing" : "paused",
      reachable: shell.hubReachable,
      pending,
      playList,
      shuffleList,
      playNext,
      addToQueue,
      playRecord,
      recordTracks,
      playRecords,
      addToPlaylist,
      toggle: shell.togglePlay,
      next: shell.next,
      previous: shell.prev,
      seek,
      volume: shell.volume,
      setVolume: shell.setVolume,
      shuffle: shell.shuffle,
      toggleShuffle: shell.toggleShuffle,
      repeat: shell.repeat,
      cycleRepeat: shell.cycleRepeat,
    }),
    [
      track,
      queue,
      shell.playing,
      shell.hubReachable,
      pending,
      playList,
      shuffleList,
      playNext,
      addToQueue,
      playRecord,
      recordTracks,
      playRecords,
      addToPlaylist,
      shell.togglePlay,
      shell.next,
      shell.prev,
      seek,
      shell.volume,
      shell.setVolume,
      shell.shuffle,
      shell.toggleShuffle,
      shell.repeat,
      shell.cycleRepeat,
    ],
  );

  return (
    <Ctx.Provider value={value}>
      <ClockCtx.Provider value={clock}>{children}</ClockCtx.Provider>
    </Ctx.Provider>
  );
}

/** Whether the Mac answered, for parts that may sit outside the player (null when they do). */
export function useMacReachable(): boolean | null {
  return useContext(Ctx)?.reachable ?? null;
}

export function useOwned(): Owned {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOwned outside OwnedProvider");
  return v;
}

/** Seconds into the song on the Mac. Ticks four times a second; only what reads it re-renders. */
export function useOwnedTime(): number {
  const c = useContext(ClockCtx);
  if (!c) throw new Error("useOwnedTime outside OwnedProvider");
  return useSyncExternalStore(c.subscribe, c.get, () => 0);
}
