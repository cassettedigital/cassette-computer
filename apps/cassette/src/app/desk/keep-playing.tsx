"use client";

/**
 * Keep playing on the Mac (founder, 2026-11-02), the same feature the iPhone has and the same cloud
 * answer (lib/keep-playing/contract.ts): when what is playing runs out, an album carries on with
 * another record, anything else with songs. The cloud decides all of it; the Mac only keeps the switch,
 * sends its queue and plays the answer.
 *
 * The Mac hands the pick to its hub ahead of time: as soon as a stretch of the queue starts, the cloud
 * is asked and its record (or songs) goes to the end of the hub's queue, so the music carries on with
 * the window closed. When the pick starts playing it becomes what started the queue, and the next
 * pick follows it. Switching keep playing off, or turning repeat on, takes the pick back off; a
 * shuffle or an Add to Queue that lands after it puts it back at the end (lib/keep-playing/queue.ts).
 * The switch is this Mac's own, kept in the window like the phone keeps its own.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useShell, type ShellTrack } from "@/app/dashboard/_shell/shell-context";
import {
  KEEP_PLAYING_PATH,
  lastUnique,
  type KeepPlayingAnswer,
  type KeepPlayingHeading,
  type KeepPlayingRequest,
} from "@/lib/keep-playing/contract";
import { liveTail, tailAtEnd, withTailLast, withoutTail } from "@/lib/keep-playing/queue";
import { toShell, useOwned } from "./owned";
import { loadSongs, songsOfRecordNow } from "./songs";
import type { OwnedTrack } from "./types";

const SWITCH_KEY = "cassette.keepPlaying";
/** The queue's tail the cloud reads; it reads album or songs from what started the queue. */
const SEED_SONGS = 10;

export type KeepPlaying = {
  /** the switch: on unless switched off on this Mac */
  on: boolean;
  /** on, but repeat is on, so it waits (a press turns repeat off) */
  waiting: boolean;
  toggle: () => void;
  /** what goes under THEN, word for word as the cloud said it; null with nothing queued */
  heading: KeepPlayingHeading | null;
  kind: "album" | "songs" | null;
  /** the pick's songs at the end of the queue, by the id the Mac plays them by */
  tail: string[];
  /** the next record down the list, or a fresh draw of songs */
  swap: () => void;
};

type Answer = { kind: "album"; heading: KeepPlayingHeading; records: OwnedTrack[][] } | { kind: "songs"; heading: KeepPlayingHeading; songs: OwnedTrack[] };

const Ctx = createContext<KeepPlaying | null>(null);
const shellId = (t: ShellTrack) => t.subsonicTrackId ?? null;

export function KeepPlayingProvider({ children }: { children: ReactNode }) {
  const shell = useShell();
  const { track, queue, recordTracks } = useOwned();
  const [on, setOn] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(SWITCH_KEY) === "0") setOn(false);
    } catch {
      /* no storage: on */
    }
  }, []);
  const active = on && shell.repeat === "off";

  // this stretch of the queue: what started it (as the cloud knows songs) and every song it has held
  const started = useRef<string[]>([]);
  const known = useRef(new Set<string>());
  // what has played, oldest first, as the cloud knows songs
  const history = useRef<string[]>([]);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [cursor, setCursor] = useState(0);
  const [tail, setTail] = useState<OwnedTrack[]>([]);
  const tailIds = useMemo(() => tail.map((t) => t.subsonicTrackId).filter((id): id is string => !!id), [tail]);
  const asking = useRef<string | null>(null);
  const draw = useRef(0);
  const busy = useRef(false);
  // a hub that will not take the pick (0.5.19 and older say no to /api/playback/queue) is asked once
  // per stretch, and each queue shape is put right once: never a command on every redraw
  const refusedFor = useRef<string | null>(null);
  const repairedFor = useRef<string | null>(null);
  const stretchKey = () => started.current.join(",");

  const reset = useCallback((startedBy: OwnedTrack[]) => {
    started.current = startedBy.map((t) => t.cassetteLocalId).filter((id): id is string => !!id);
    known.current = new Set(startedBy.map((t) => t.subsonicTrackId).filter((id): id is string => !!id));
    asking.current = null;
    draw.current = 0;
    setAnswer(null);
    setCursor(0);
  }, []);

  // the song on now: more of this stretch, the pick starting, or a queue started fresh
  const nowId = track?.subsonicTrackId ?? null;
  useEffect(() => {
    if (!track || !nowId) return;
    if (track.cassetteLocalId && history.current[history.current.length - 1] !== track.cassetteLocalId) {
      history.current = [...history.current, track.cassetteLocalId].slice(-500);
    }
    if (tailIds.includes(nowId)) {
      // the pick is playing: it is what started the queue now, and the next pick follows it
      reset(tail);
      setTail([]);
      return;
    }
    if (!known.current.has(nowId)) {
      reset([track, ...queue.filter((t) => !tailIds.includes(t.subsonicTrackId ?? ""))]);
      setTail([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowId]);
  // songs added to this stretch (Play Next) belong to it
  useEffect(() => {
    for (const t of queue) if (t.subsonicTrackId && !tailIds.includes(t.subsonicTrackId)) known.current.add(t.subsonicTrackId);
  }, [queue, tailIds]);

  const ask = useCallback(async (): Promise<Answer | null> => {
    const local = (list: (OwnedTrack | null)[]) => list.map((t) => t?.cassetteLocalId ?? null);
    const rest = queue.filter((t) => !tailIds.includes(t.subsonicTrackId ?? ""));
    const body: KeepPlayingRequest & { key: string } = {
      started: started.current,
      seed: lastUnique([...history.current, ...local(rest)], SEED_SONGS),
      exclude: lastUnique([...history.current, ...local(queue)], 2000),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      key: String(draw.current),
    };
    const res = await fetch(KEEP_PLAYING_PATH, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const a = (await res.json()) as KeepPlayingAnswer;
    // the cloud's songs as the Mac holds them
    const songs = await loadSongs().catch(() => [] as OwnedTrack[]);
    const byLocal = new Map(songs.filter((t) => t.cassetteLocalId).map((t) => [t.cassetteLocalId!, t]));
    if (a.kind === "album") {
      const records: OwnedTrack[][] = [];
      for (const r of a.records) {
        const any = r.songs.map((id) => byLocal.get(id)).find((t) => t?.albumKey);
        if (!any?.albumKey || any.albumKey === track?.albumKey) continue;
        const list = songsOfRecordNow(any.albumKey) ?? (await recordTracks(any.albumKey).catch(() => [] as OwnedTrack[]));
        const playable = list.filter((t) => t.subsonicTrackId);
        if (playable.length) records.push(playable);
      }
      return records.length ? { kind: "album", heading: a.heading, records } : null;
    }
    if (a.kind === "songs") {
      const list = a.songs.map((id) => byLocal.get(id)).filter((t): t is OwnedTrack => !!t?.subsonicTrackId);
      return list.length ? { kind: "songs", heading: a.heading, songs: list } : null;
    }
    return null;
  }, [queue, tailIds, track?.albumKey, recordTracks]);

  // put `pick` at the end of the queue in place of whatever pick is there
  const place = useCallback(
    async (pick: OwnedTrack[]) => {
      if (refusedFor.current === stretchKey()) return;
      busy.current = true;
      const ids = pick.map((t) => t.subsonicTrackId!);
      setTail(pick);
      const ok = await shell.replaceUpcoming([...withoutTail(shell.upNext, tailIds, shellId), ...pick.map(toShell)]).catch(() => false);
      busy.current = false;
      if (!ok) {
        refusedFor.current = stretchKey();
        setTail((now) => (now.map((t) => t.subsonicTrackId).join() === ids.join() ? [] : now));
      }
    },
    [shell, tailIds],
  );

  // on, with nothing queued after this stretch: ask the cloud (once per stretch), then queue its pick
  useEffect(() => {
    if (!active || !track || busy.current || tail.length || !started.current.length) return;
    if (answer) {
      const pick = answer.kind === "album" ? answer.records[cursor] : answer.songs;
      if (pick?.length) void place(pick);
      return;
    }
    const key = `${started.current.join(",")}|${draw.current}`;
    if (asking.current === key) return;
    asking.current = key;
    busy.current = true;
    void ask()
      .then((a) => {
        if (asking.current === key) setAnswer(a);
      })
      .catch(() => {
        /* offline or an error: the record ends as it always did */
      })
      .finally(() => {
        busy.current = false;
      });
  }, [active, track, tail.length, answer, cursor, ask, place]);

  // off, or repeat on: the pick comes back off the queue (the answer is kept for when it is on again)
  useEffect(() => {
    if (active || !tail.length || busy.current) return;
    busy.current = true;
    void shell.replaceUpcoming(withoutTail(shell.upNext, tailIds, shellId)).finally(() => {
      busy.current = false;
      setTail([]);
    });
  }, [active, tail.length, tailIds, shell]);

  // the pick stays whole and last: a song taken out leaves it, a shuffle or an Add to Queue moves it back
  useEffect(() => {
    if (!tail.length || busy.current || !active) return;
    const live = liveTail(shell.upNext, tailIds, shellId);
    if (live.length < tailIds.length) {
      if (!live.length) {
        // the whole pick taken out: the next record down, or a fresh draw of songs
        setTail([]);
        if (answer?.kind === "album") setCursor((c) => c + 1);
        else {
          draw.current++;
          asking.current = null;
          setAnswer(null);
        }
        return;
      }
      setTail((now) => now.filter((t) => live.includes(t.subsonicTrackId ?? "")));
      return;
    }
    const shape = shell.upNext.map(shellId).join(",");
    if (!tailAtEnd(shell.upNext, tailIds, shellId) && repairedFor.current !== shape) {
      repairedFor.current = shape;
      busy.current = true;
      void shell.replaceUpcoming(withTailLast(shell.upNext, tailIds, shellId)).finally(() => {
        busy.current = false;
      });
    }
  }, [shell, tail.length, tailIds, active, answer]);

  const toggle = useCallback(() => {
    // pressed while it waits: repeat goes off and keep playing takes over, as on the phone
    if (on && shell.repeat !== "off") {
      shell.setRepeatMode("off");
      return;
    }
    const next = !on;
    setOn(next);
    try {
      localStorage.setItem(SWITCH_KEY, next ? "1" : "0");
    } catch {
      /* the switch holds for this window */
    }
  }, [on, shell]);

  const swap = useCallback(() => {
    if (!answer || busy.current) return;
    if (answer.kind === "album") {
      const nextAt = cursor + 1 < answer.records.length ? cursor + 1 : 0;
      setCursor(nextAt);
      const pick = answer.records[nextAt];
      if (pick?.length) void place(pick);
      return;
    }
    // songs: a fresh draw, placed when it comes
    draw.current++;
    asking.current = null;
    busy.current = true;
    void ask()
      .then((a) => {
        busy.current = false;
        if (a?.kind !== "songs") return;
        setAnswer(a);
        void place(a.songs);
      })
      .catch(() => {
        busy.current = false;
      });
  }, [answer, cursor, place, ask]);

  const value = useMemo<KeepPlaying>(
    () => ({
      on,
      waiting: on && shell.repeat !== "off",
      toggle,
      heading: tail.length ? (answer?.heading ?? null) : null,
      kind: tail.length ? (answer?.kind ?? null) : null,
      tail: tailIds,
      swap,
    }),
    [on, shell.repeat, toggle, tail.length, answer, tailIds, swap],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useKeepPlaying(): KeepPlaying {
  const v = useContext(Ctx);
  if (!v) throw new Error("useKeepPlaying outside KeepPlayingProvider");
  return v;
}
