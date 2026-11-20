"use client";

/**
 * The taste pages' one preview player. It lives in the page frame (PageFrame with `player`), which the
 * artist and album pages share as their layout ((taste)/layout.tsx), so a song keeps playing while you
 * move from Radiohead to OK Computer and back (next/link keeps the layout mounted; a full page load ends
 * it). The dock draws it; the pages only call play, playList, toggle and read isCurrent.
 *
 * One sound at a time: starting a song announces itself on the site's audio-lane bus as the preview
 * booth (src/lib/audio-lane.ts), which stops the radio lane and the hub transport; when either of them
 * starts, this stops itself.
 *
 * On a shared song's visit (playList with `{ shared: true }`) the player waits between songs instead of
 * running straight on: the next song is named beside the video with a countdown (UP_NEXT_SECONDS), Play
 * now and Stop. A friend who came for one song is never carried into the rest of the record without
 * seeing it coming. Turning autoplay off keeps it waiting for a press, on that computer only (kept in the
 * browser).
 *
 * The dock draws the video in a panel down the right of a wide window (the rail) and pinned along the top
 * of a narrower one (PlayerDock.tsx). A page may hand the rail its own list to sit under the video
 * (useRailSlot: the album page's previews); a page that doesn't gets the queue there.
 *
 * A Discover lane (playList with `{ lane }`, lib/discover/lane-rules.ts) plays like a playlist the listener
 * chose: the dock names it, and as its queue runs low the player asks the lane for more of itself
 * (lane.extend) and adds them to the end. It never moves to another lane on its own; a lane ends when
 * extend has nothing left, or when the listener starts something else.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { tellApp } from "@/lib/app-surface";
import { announceAudioLane, onOtherAudioLane } from "@/lib/audio-lane";
import { reportWebError } from "@/lib/diagnostics/web-report";
import { useNoteNowPlaying } from "@/lib/diagnostics/now-playing";
import { REPORTED_KEY, REPORT_PATH, dayOf, noteReport, pickReport, unplayableReportsOn } from "@/lib/media/player-report-plan";
import { fromIndex, wrapFrom, type Playable } from "./play";
import { primeYouTube, type FrameApi } from "./YouTubeFrame";

export type PlayerStatus = "loading" | "playing" | "paused";

/** A Discover lane playing: its key and name for the page and the dock, and where more of it comes from.
 *  extend gets the last song queued and answers the lane's next songs, or none when the lane is done. */
export type PlayerLane = { key: string; label: string; extend?: (last: Playable) => Promise<Playable[]> };

/** Ask the lane for more while fewer than this many songs wait. */
const LANE_LOW_WATER = 3;

/** How long a shared song's visit waits before the next song plays on by itself. */
export const UP_NEXT_SECONDS = 10;

const AUTOPLAY_KEY = "cassette.autoplay";
function readAutoplay(): boolean {
  try {
    return window.localStorage.getItem(AUTOPLAY_KEY) !== "off";
  } catch {
    return true;
  }
}
function writeAutoplay(on: boolean) {
  try {
    if (on) window.localStorage.removeItem(AUTOPLAY_KEY);
    else window.localStorage.setItem(AUTOPLAY_KEY, "off");
  } catch {
    // private window or blocked storage: the choice lasts this visit only
  }
}

export type PlayerState = {
  track: Playable | null; // the docked song; null = dock closed
  queue: Playable[]; // what plays next, in order
  /** What came before the docked song in this listening, oldest first: the songs that played or were passed,
   *  and, for a list started part way down, the list's songs above it (the founder, 2026-11-06: "a way to get
   *  back to past songs"). Any of them is a press away (skipBack). */
  history: Playable[];
  status: PlayerStatus;
  /** True when the docked song can't play here: YouTube refused every upload and nothing is queued after it,
   *  or it is the STALLED_IN_A_ROW-th song in a row that never really played. */
  unplayable: boolean;
  startedAt: number | null; // ms epoch of YouTube's FIRST "playing" for this track; null while loading
  play: (track: Playable, queue?: Playable[]) => void;
  /**
   * fromIndex(list, index ?? 0), then play: "this one, then onward". With `{ wrap: true }` the rest of
   * the record follows and wraps round to its first song (Hear it).
   */
  playList: (list: Playable[], index?: number, opts?: { wrap?: boolean; big?: boolean; shared?: boolean; lane?: PlayerLane }) => void;
  /** The lane playing (playList with `{ lane }`), or null. */
  lane: { key: string; label: string } | null;
  /** Play queue[index] now and keep the rest after it (the dock's Up next): the lane, if any, plays on. */
  skipTo: (index: number) => void;
  /** Back to history[index]: it plays, and everything after it (the docked song included) waits again in front. */
  skipBack: (index: number) => void;
  /** Back one song (history's last), when there is one. */
  previous: () => void;
  /** Ask the lane playing for more until `n` songs wait (or the lane runs out); answers the queue then.
   *  For handing the lane on whole (Open on YouTube); outside a lane it answers the queue as it is. */
  fillLane: (n: number) => Promise<Playable[]>;
  /** A shared song's visit (CASSETTE_SHARING.md: playList with `{ shared: true }`): between songs the
   *  player waits, saying what's next. It holds for the rest of the visit, whatever plays next, until Stop. */
  shared: boolean;
  /** Counts the times a page asked for the video large (playList with `{ big: true }`): the dock enlarges
   *  itself each time it goes up. 0 = never asked. */
  bigAsk: number;
  /** A shared song's visit, between songs: the song ended and queue[0] plays at `at` (ms epoch), or waits
   *  for a press (`at` null) when autoplay is off on this computer. Null while nothing is waiting. */
  waiting: { at: number | null } | null;
  /** Autoplay on or off for a shared song's visit, on this computer (kept in the browser). */
  setAutoplay: (on: boolean) => void;
  next: () => void;
  toggle: () => void; // pause or resume
  stop: () => void;
  isCurrent: (trackId: number) => boolean;
};

/* ── the progress store: ticks re-render only what reads usePlayerTime ── */

type Time = { elapsed: number; duration: number | null };
function createTimeStore() {
  let value: Time = { elapsed: 0, duration: null };
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set(next: Time) {
      if (next.elapsed === value.elapsed && next.duration === value.duration) return;
      value = next;
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
type TimeStore = ReturnType<typeof createTimeStore>;
const SERVER_TIME: Time = { elapsed: 0, duration: null };

/** What the dock needs to drive the frame. Not for pages. */
type FrameHooks = {
  apiRef: MutableRefObject<FrameApi | null>;
  onPlaying: () => void;
  onPaused: () => void;
  onEnded: () => void;
  onUnplayable: (codes: number[]) => void;
};

/**
 * After this many songs in a row that never really played, the player stops on the last one ("Can't play here")
 * rather than running on: YouTube refused every upload of each, or each ended within CUT_SHORT_MS of starting. A
 * browser that does either does it to every song, and an artist's queue can hold hundreds (BUG-847: in Safari, an
 * ad blocker's YouTube script jumps the video to its end whenever YouTube marks an ad as showing, and with the ad
 * in the song's own stream that ends the song). The first time it stops on a page it says so to the diagnostics
 * spine with what happened, so the reason can be read in /admin/diagnostics: YouTube's codes for a refusal (150
 * the uploader keeps it off other sites, 152 or 153 the browser hid which site asked, 100 gone, 5 the browser's
 * own player failed), "ended at once" for a song cut short.
 */
export const STALLED_IN_A_ROW = 3;
/** A song that ends sooner than this after it starts playing was cut short, unless it is itself that short. */
export const CUT_SHORT_MS = 5000;
let stallReported = false;

function reportStall(said: string[]): void {
  if (stallReported) return;
  stallReported = true;
  const why = [...new Set(said)].sort().join(", ") || "no code";
  reportWebError(new Error(`${STALLED_IN_A_ROW} previews in a row did not play (${why})`), { source: "preview-player" });
}

/**
 * A song YouTube refused: say so once, so the videos job re-checks its record the next morning instead of
 * up to 27 days later (lib/media/player-report-plan.ts has the rules). Only the song's catalog id, the upload
 * refused and YouTube's code; once per song per browser per day; only for a refusal about the upload itself,
 * never a refusal with no code, a song that ended at once, or the browser's own trouble (codes 5, 152, 153).
 * Sent and forgotten: it never waits and never throws, and the player moves on exactly as it did before.
 * Nothing at all (no call, nothing kept in the browser) until NEXT_PUBLIC_PLAYER_UNPLAYABLE_REPORT reads "on",
 * the same switch the endpoint answers to.
 */
let reportedMemo: string | null = null; // today's songs when the browser keeps nothing (a private window)
function reportUnplayable(track: Playable | null, codes: number[]): void {
  try {
    if (!unplayableReportsOn()) return;
    const report = pickReport(track, codes);
    if (!report) return;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(REPORTED_KEY);
    } catch {
      // blocked storage: this visit's own memory below
    }
    const seen = noteReport(stored ?? reportedMemo, report.trackId, dayOf(Date.now()));
    if (!seen.send || !seen.next) return;
    reportedMemo = seen.next;
    try {
      window.localStorage.setItem(REPORTED_KEY, seen.next);
    } catch {
      // kept for this visit only
    }
    void fetch(REPORT_PATH, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    }).catch(() => {});
  } catch {
    // a report never gets in the player's way
  }
}

/** The rail's list slot: the place under the video where a page's own list goes. Not for pages: they use
 *  useRailSlot. */
type Rail = {
  slot: HTMLElement | null;
  setSlot: (el: HTMLElement | null) => void;
  /** Some page on screen has its own list for the rail. */
  claimed: boolean;
  claim: () => () => void;
  /** The page's record colour (accentOf), so the rail beside the page draws in it (useRailAccent). */
  accent: string | null;
  setAccent: (a: string | null) => void;
};

/**
 * A song waiting in the rail for its first press: a shared song's arrival on a wide window (Arrival.tsx).
 * The rail opens with it before anything plays, with the page's `lead` at its top (who sent it, their
 * note) and the song's still with Play where the video goes, so pressing Play turns it into the player in
 * place. Once anything plays it is `started`: the lead stays above the video while the shared song is the
 * one playing, and Close shuts the rail as it always does. Only the page that set it changes it.
 */
export type Cue = {
  track: Playable;
  lead: ReactNode;
  started: boolean;
  start: () => void;
  dismiss: () => void;
};
type CueHost = { cue: Cue | null; setCue: (c: Cue | null) => void };

const Ctx = createContext<PlayerState | null>(null);
const TimeCtx = createContext<TimeStore | null>(null);
const FrameCtx = createContext<FrameHooks | null>(null);
const RailCtx = createContext<Rail | null>(null);
const CueCtx = createContext<CueHost | null>(null);

type Core = { track: Playable | null; queue: Playable[]; history: Playable[]; status: PlayerStatus; startedAt: number | null; unplayable: boolean };
const CLOSED: Core = { track: null, queue: [], history: [], status: "loading", startedAt: null, unplayable: false };
/** The most songs kept behind the docked one: a lane can run for hours. */
const HISTORY_MAX = 200;
const keep = (list: Playable[]) => (list.length > HISTORY_MAX ? list.slice(list.length - HISTORY_MAX) : list);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const [core, setCore] = useState<Core>(CLOSED);
  // a note to the founder says which song the preview player had on (lib/diagnostics/now-playing)
  useNoteNowPlaying(
    "preview",
    core.track
      ? { state: core.unplayable ? "unplayable" : core.status, title: core.track.title, artist: core.track.artist, album: core.track.album }
      : null,
  );
  const [bigAsk, setBigAsk] = useState(0);
  const [shared, setShared] = useState(false);
  const [waiting, setWaiting] = useState<{ at: number | null } | null>(null);
  const [railSlot, setRailSlot] = useState<HTMLElement | null>(null);
  const [railClaims, setRailClaims] = useState(0);
  const [railAccent, setRailAccent] = useState<string | null>(null);
  const [cue, setCue] = useState<Cue | null>(null);
  const [lane, setLane] = useState<PlayerLane | null>(null);
  const laneRef = useRef<PlayerLane | null>(null);
  laneRef.current = lane;
  // the lane's songs so far (played and queued), so a record shown twice never plays twice
  const laneSeen = useRef(new Set<number>());
  const laneAsking = useRef(false);
  const laneDone = useRef(false);
  // the queue ran out while the lane was still being asked: play on when the answer lands
  const laneOwed = useRef(false);
  // what went wrong with each song in a row that never really played (STALLED_IN_A_ROW), and the timer that
  // clears it once a song has played for CUT_SHORT_MS
  const stalled = useRef<string[][]>([]);
  const settle = useRef<number | undefined>(undefined);
  const apiRef = useRef<FrameApi | null>(null);
  const timeRef = useRef<TimeStore | null>(null);
  if (!timeRef.current) timeRef.current = createTimeStore();
  const time = timeRef.current;
  const coreRef = useRef(core);
  coreRef.current = core;
  const sharedRef = useRef(shared);
  sharedRef.current = shared;
  const waitingRef = useRef(waiting);
  waitingRef.current = waiting;

  // Load YouTube's IFrame API only once a person reaches for something: pointing at or focusing a
  // button, or a first tap or key. A page that is only read (and every crawler) never asks Google for
  // anything; a click still starts at once, because the script is in by the time the pointer lands.
  useEffect(() => {
    const opts = { capture: true, passive: true } as const;
    const kinds = ["pointerover", "focusin", "pointerdown", "touchstart", "keydown"] as const;
    const stop = () => kinds.forEach((k) => document.removeEventListener(k, reach, opts));
    function reach(e: Event) {
      if ((e.type === "pointerover" || e.type === "focusin") && !(e.target instanceof Element && e.target.closest("button"))) return;
      stop();
      primeYouTube();
    }
    kinds.forEach((k) => document.addEventListener(k, reach, opts));
    return stop;
  }, []);

  const begin = useCallback(
    (track: Playable, queue: Playable[], nextLane: PlayerLane | null = null, before: Playable[] = []) => {
      const cur = coreRef.current;
      if (cur.track && cur.track.trackId === track.trackId && (laneRef.current?.key ?? null) === (nextLane?.key ?? null)) {
        // the current song: resume if paused, otherwise leave it (and its queue) alone
        if (cur.status === "paused") apiRef.current?.play();
        return;
      }
      laneSeen.current = new Set([track.trackId, ...queue.map((x) => x.trackId)]);
      laneDone.current = false;
      laneOwed.current = false;
      stalled.current = [];
      setLane(nextLane);
      announceAudioLane("booth");
      time.set({ elapsed: 0, duration: track.seconds ?? null });
      setWaiting(null);
      setCore({ track, queue, history: keep(before), status: "loading", startedAt: null, unplayable: false });
    },
    [time],
  );

  const play = useCallback((track: Playable, queue: Playable[] = []) => begin(track, queue), [begin]);

  const playList = useCallback(
    (list: Playable[], index = 0, opts?: { wrap?: boolean; big?: boolean; shared?: boolean; lane?: PlayerLane }) => {
      const picked = opts?.wrap ? wrapFrom(list, index) : fromIndex(list, index);
      if (!picked) return;
      if (opts?.shared) setShared(true);
      // a list started part way down keeps the songs above as what came before (a wrapped record has none)
      begin(picked.track, picked.queue, opts?.lane ?? null, opts?.wrap ? [] : list.slice(0, index));
      if (opts?.big) setBigAsk((n) => n + 1);
    },
    [begin],
  );

  const stop = useCallback(() => {
    time.set({ elapsed: 0, duration: null });
    setWaiting(null);
    setCore(CLOSED);
    setShared(false);
    setLane(null);
  }, [time]);

  const next = useCallback(() => {
    const cur = coreRef.current;
    if (cur.queue.length === 0) return;
    const [head, ...rest] = cur.queue;
    time.set({ elapsed: 0, duration: head.seconds ?? null });
    setWaiting(null);
    const history = cur.track ? keep([...cur.history, cur.track]) : cur.history;
    setCore({ track: head, queue: rest, history, status: "loading", startedAt: null, unplayable: false });
  }, [time]);

  const skipTo = useCallback(
    (index: number) => {
      const cur = coreRef.current;
      const head = cur.queue[index];
      if (!head) return;
      time.set({ elapsed: 0, duration: head.seconds ?? null });
      setWaiting(null);
      // the songs skipped over count as passed, so they are a press away above
      const history = keep([...cur.history, ...(cur.track ? [cur.track] : []), ...cur.queue.slice(0, index)]);
      setCore({ track: head, queue: cur.queue.slice(index + 1), history, status: "loading", startedAt: null, unplayable: false });
    },
    [time],
  );

  const skipBack = useCallback(
    (index: number) => {
      const cur = coreRef.current;
      const head = cur.history[index];
      if (!head) return;
      time.set({ elapsed: 0, duration: head.seconds ?? null });
      setWaiting(null);
      const queue = [...cur.history.slice(index + 1), ...(cur.track ? [cur.track] : []), ...cur.queue];
      setCore({ track: head, queue, history: cur.history.slice(0, index), status: "loading", startedAt: null, unplayable: false });
    },
    [time],
  );

  const previous = useCallback(() => {
    const n = coreRef.current.history.length;
    if (n > 0) skipBack(n - 1);
  }, [skipBack]);

  const fillLane = useCallback(async (n: number): Promise<Playable[]> => {
    const l = laneRef.current;
    // a page already on its way lands first (the refill below is asking), so nothing is asked for twice
    for (let i = 0; laneAsking.current && i < 100; i++) await new Promise((r) => setTimeout(r, 100));
    let queue = coreRef.current.queue;
    while (l?.extend && laneRef.current === l && !laneDone.current && coreRef.current.track && queue.length < n) {
      laneAsking.current = true;
      try {
        const more = await l.extend(queue[queue.length - 1] ?? coreRef.current.track);
        if (laneRef.current !== l) break;
        const fresh = more.filter((x) => !laneSeen.current.has(x.trackId));
        if (fresh.length === 0) {
          laneDone.current = true;
          break;
        }
        fresh.forEach((x) => laneSeen.current.add(x.trackId));
        queue = [...queue, ...fresh];
        setCore((c) => (c.track ? { ...c, queue: [...c.queue, ...fresh] } : c));
      } catch {
        laneDone.current = true;
        break;
      } finally {
        laneAsking.current = false;
      }
    }
    return queue;
  }, []);

  // A lane tops its queue up as it runs low, a page of songs at a time, until it has nothing left.
  useEffect(() => {
    const l = lane;
    if (!l?.extend || !core.track || core.queue.length >= LANE_LOW_WATER || laneAsking.current || laneDone.current) return;
    laneAsking.current = true;
    const last = core.queue[core.queue.length - 1] ?? core.track;
    l.extend(last)
      .then((more) => {
        if (laneRef.current !== l) return;
        const fresh = more.filter((x) => !laneSeen.current.has(x.trackId));
        if (fresh.length === 0) {
          laneDone.current = true;
          return;
        }
        fresh.forEach((x) => laneSeen.current.add(x.trackId));
        setCore((c) => (c.track ? { ...c, queue: [...c.queue, ...fresh] } : c));
      })
      .catch(() => {
        if (laneRef.current === l) laneDone.current = true;
      })
      .finally(() => {
        laneAsking.current = false;
        if (laneRef.current === l && laneOwed.current) {
          laneOwed.current = false;
          if (coreRef.current.queue.length > 0) next();
          else stop();
        }
      });
  }, [lane, core.track, core.queue, next, stop]);

  // between songs on a shared visit: the next one plays when the countdown runs out
  useEffect(() => {
    const at = waiting?.at;
    if (!at) return;
    const id = window.setTimeout(next, Math.max(0, at - Date.now()));
    return () => window.clearTimeout(id);
  }, [waiting, next]);

  const setAutoplay = useCallback((on: boolean) => {
    writeAutoplay(on);
    // a wait already showing starts its countdown over, or stops counting
    setWaiting((w) => (w ? { at: on ? Date.now() + UP_NEXT_SECONDS * 1000 : null } : w));
  }, []);

  const toggle = useCallback(() => {
    const cur = coreRef.current;
    if (!cur.track) return;
    // between songs, Play is "play the next one now"
    if (waitingRef.current) {
      next();
      return;
    }
    // status follows YouTube's report, not the click
    if (cur.status === "playing") apiRef.current?.pause();
    else apiRef.current?.play();
  }, [next]);

  const isCurrent = useCallback((trackId: number) => coreRef.current.track?.trackId === trackId, []);

  // Another lane (radio, the hub) started: this one goes quiet.
  useEffect(
    () =>
      onOtherAudioLane("booth", () => {
        setCore((c) => (c.track ? CLOSED : c));
        setWaiting(null);
        setShared(false);
        setLane(null);
      }),
    [],
  );

  // Tick the progress line while playing; one last read when it stops.
  useEffect(() => {
    const read = () => {
      const t = apiRef.current?.time();
      if (!t) return;
      time.set({ elapsed: Math.floor(t.elapsed * 4) / 4, duration: t.duration ?? coreRef.current.track?.seconds ?? null });
    };
    if (core.status !== "playing") {
      read();
      return;
    }
    read();
    const id = window.setInterval(read, 250);
    return () => window.clearInterval(id);
  }, [core.status, core.track, time]);

  const frame = useMemo<FrameHooks>(() => {
    // a song that never really played: true when it is the STALLED_IN_A_ROW-th in a row and the player stopped on it
    const stall = (why: string[]): boolean => {
      stalled.current.push(why);
      if (stalled.current.length < STALLED_IN_A_ROW) return false;
      reportStall(stalled.current.flat());
      setCore((c) => (c.track ? { ...c, status: "paused", unplayable: true } : c));
      return true;
    };
    return {
      apiRef,
      onPlaying: () => {
        // inside the iPhone app: the phone's own music pauses, so the preview has the sound
        tellApp({ type: "preview-playing" });
        // still playing a while later: it really played, so the run of songs that didn't is over
        const id = coreRef.current.track?.trackId;
        window.clearTimeout(settle.current);
        settle.current = window.setTimeout(() => {
          if (coreRef.current.track?.trackId === id && coreRef.current.status === "playing") stalled.current = [];
        }, CUT_SHORT_MS);
        setWaiting(null);
        setCore((c) => (c.track ? { ...c, status: "playing", startedAt: c.startedAt ?? Date.now(), unplayable: false } : c));
      },
      onPaused: () => setCore((c) => (c.track ? { ...c, status: "paused" } : c)),
      onEnded: () => {
        const c = coreRef.current;
        // cut short: ended within CUT_SHORT_MS of playing (or before it played), on a song longer than that
        const cut = (c.track?.seconds ?? Infinity) * 1000 > 2 * CUT_SHORT_MS && (c.startedAt == null || Date.now() - c.startedAt < CUT_SHORT_MS);
        if (cut && stall(["ended at once"])) return;
        if (coreRef.current.queue.length === 0) {
          // a lane still being asked for more: hold the dock and play on when the songs arrive
          if (laneRef.current && laneAsking.current) {
            laneOwed.current = true;
            setCore((c) => (c.track ? { ...c, status: "paused" } : c));
            return;
          }
          return stop();
        }
        if (!sharedRef.current) return next();
        // a shared song's visit: say what's next and wait for the countdown, or for a press
        // (read from the browser each time, so a choice made in another tab holds here too)
        const on = readAutoplay();
        setCore((c) => (c.track ? { ...c, status: "paused" } : c));
        setWaiting({ at: on ? Date.now() + UP_NEXT_SECONDS * 1000 : null });
      },
      onUnplayable: (codes) => {
        reportUnplayable(coreRef.current.track, codes);
        if (stall(codes.length ? codes.map(String) : ["refused"])) return;
        if (coreRef.current.queue.length > 0) next();
        else setCore((c) => (c.track ? { ...c, status: "paused", unplayable: true } : c));
      },
    };
  }, [next, stop]);

  const laneName = useMemo(() => (lane ? { key: lane.key, label: lane.label } : null), [lane]);
  const value = useMemo<PlayerState>(
    () => ({ ...core, play, playList, skipTo, skipBack, previous, fillLane, lane: laneName, next, toggle, stop, isCurrent, bigAsk, shared, waiting, setAutoplay }),
    [core, play, playList, skipTo, skipBack, previous, fillLane, laneName, next, toggle, stop, isCurrent, bigAsk, shared, waiting, setAutoplay],
  );

  const claimRail = useCallback(() => {
    setRailClaims((n) => n + 1);
    return () => setRailClaims((n) => n - 1);
  }, []);
  const rail = useMemo<Rail>(
    () => ({ slot: railSlot, setSlot: setRailSlot, claimed: railClaims > 0, claim: claimRail, accent: railAccent, setAccent: setRailAccent }),
    [railSlot, railClaims, claimRail, railAccent],
  );

  const cueHost = useMemo<CueHost>(() => ({ cue, setCue }), [cue]);

  return (
    <Ctx.Provider value={value}>
      <TimeCtx.Provider value={time}>
        <FrameCtx.Provider value={frame}>
          <RailCtx.Provider value={rail}>
            <CueCtx.Provider value={cueHost}>{children}</CueCtx.Provider>
          </RailCtx.Provider>
        </FrameCtx.Provider>
      </TimeCtx.Provider>
    </Ctx.Provider>
  );
}

/** The player. Throws outside a page frame that has one (PageFrame with `player`). */
export function usePlayer(): PlayerState {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlayer must be used inside a PageFrame with `player` (PlayerProvider)");
  return v;
}

/** The player, or null outside a page frame that has one: for parts that also render without it (the
 *  paired desktop app draws the taste pages without the frame), which then simply offer nothing to play. */
export function usePlayerMaybe(): PlayerState | null {
  return useContext(Ctx);
}

/** Seconds played and the song's length (YouTube's, else the stored length). Ticks 4 times a second. */
export function usePlayerTime(): { elapsed: number; duration: number | null } {
  const store = useContext(TimeCtx);
  if (!store) throw new Error("usePlayerTime must be used inside a PageFrame with `player` (PlayerProvider)");
  return useSyncExternalStore(store.subscribe, store.get, () => SERVER_TIME);
}

/**
 * The rail's list slot, for a page with its own list to sit under the video (the album page's previews):
 * the element to portal it into while the rail is open, else null (the window is narrow, or nothing is
 * playing), when the page keeps the list in itself. Calling it tells the dock this page brings a list.
 */
export function useRailSlot(): HTMLElement | null {
  const v = useContext(RailCtx);
  if (!v) throw new Error("useRailSlot must be used inside a PageFrame with `player` (PlayerProvider)");
  const { claim } = v;
  useEffect(() => claim(), [claim]);
  return v.slot;
}

/** The page's record colour for the rail beside it (its hover-play draws in it), for as long as the page is
 *  on screen. Outside the player's frame it does nothing. */
export function useRailAccent(accent: string | null | undefined): void {
  const set = useContext(RailCtx)?.setAccent;
  useEffect(() => {
    if (!set || !accent) return;
    set(accent);
    return () => set(null);
  }, [set, accent]);
}

/** The rail's side of the slot. Only PlayerDock.tsx uses this. */
export function useRailHost(): Rail {
  const v = useContext(RailCtx);
  if (!v) throw new Error("useRailHost must be used inside PlayerProvider");
  return v;
}

/** The song waiting in the rail (Cue): the arrival sets it, the dock draws it. */
export function useCue(): CueHost {
  const v = useContext(CueCtx);
  if (!v) throw new Error("useCue must be used inside a PageFrame with `player` (PlayerProvider)");
  return v;
}

/** The dock's handle on the frame. Only Dock.tsx uses this. */
export function useFrameHooks(): FrameHooks {
  const v = useContext(FrameCtx);
  if (!v) throw new Error("useFrameHooks must be used inside PlayerProvider");
  return v;
}
