"use client";

/**
 * The page frame's player, wired: the shared Dock fed by the one player. On a window 1100 wide or more it
 * is the rail, a panel down the right: the page steps aside for it (the root's [data-rail], whose padding
 * is the rail's width), so the page re-lays itself at its narrower width, and under the video goes the
 * page's own list (useRailSlot: the album page's previews, which become the rail) or, on a page that brings
 * none, what plays next. Narrower, it is pinned along the top, the video the full width, and the page
 * starts below it (its measured height written to the root as --top-dock-h, with [data-topdock]). It
 * mounts on the first play and stays mounted while anything is docked, so the iframe lives across songs
 * and across pages. Between songs on a shared song's visit it names the next song beside the video, with a
 * countdown (DockUpNext). On a wide window a shared song arrives here before anything plays (the Cue,
 * set by the album page's Arrival): the rail opens on it, and its Play turns it into the player in place.
 */

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { Dock, DockCue, DockExpand, DockKey, DockUpNext } from "./Dock";
import { albumHref, artistHref } from "./links";
import { Bars } from "./Bars";
import { accentVars } from "./colour";
import { usePlayer, useCue, useFrameHooks, useRailHost } from "./player";
import type { Playable } from "./play";
import { ShareSong } from "./ShareSong";
import { PlayOver } from "@discovery/cassette-kit/play-over";
import { YouTubeFrame } from "./YouTubeFrame";
import { YOUTUBE_TEMP_PLAYLIST_MAX, youtubeTempPlaylistUrl } from "@/lib/preview/youtube-playlist-link";
import { ladderSrc } from "@/lib/images/picture";
import { inPanelFrame, type PanelSays } from "@/lib/app-surface";
import s from "./dock.module.css";

/** Wide enough for the rail: at 1100 the page keeps 700 beside a 400 rail. In the account window's side panel
 *  (lib/app-surface PANEL_FRAME) the page is drawn with a 400 strip on its left that the window keeps out of
 *  sight (taste.module.css), so beside any panel (380 at the least) the rail goes in that strip, never along the
 *  top; only a phone's sheet is narrower. */
const WIDE = "(min-width: 1100px)";
const WIDE_IN_PANEL = "(min-width: 780px)";

/** A media query, live. False on the server; the dock only mounts on a click, by when it is read. */
function useMedia(q: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(q);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(q).matches,
    () => false,
  );
}

/** The player is a rail on this window (wide), not pinned along the top: the arrival asks, to know whether
 *  its song goes to the rail or stays at the top of the page. */
export function useRailWide(): boolean {
  return useMedia(useWideQuery());
}

/** The rail's breakpoint for this page: the window's, or the side panel's. */
function useWideQuery(): string {
  const panel = useSyncExternalStore(
    () => () => {},
    () => inPanelFrame(),
    () => false,
  );
  return panel ? WIDE_IN_PANEL : WIDE;
}

/** Who and what, each a link where it has a page. */
function byLine(t: Playable) {
  return (
    <>
      {/* a song found by its title alone (search) may not know its artist's page */}
      {t.artistSlug ? <Link href={artistHref(t.artistSlug)}>{t.artist}</Link> : t.artist}
      {t.album && (
        <>
          {" · "}
          {t.albumSlug ? <Link href={albumHref(t.albumSlug)}>{t.album}</Link> : t.album}
        </>
      )}
    </>
  );
}

/** One song in the rail's list: its place in the run (01 on, earlier songs too, so a song keeps its number as
 *  the list moves on), the kit's hover-play over that number when a press plays it, or the playing bars on
 *  the song playing; then its cover and its words. */
function QueueSong({ x, n, play, live }: { x: Playable; n: number; play: boolean; live?: boolean }) {
  return (
    <>
      <span className={s.queueN} data-over={play || undefined}>
        {live === undefined ? String(n).padStart(2, "0") : <Bars live={live} />}
        {play && <PlayOver bare size={16} />}
      </span>
      <span className={s.queueCover} style={x.cover ? { backgroundImage: `url("${ladderSrc(x.cover, 120)}")` } : undefined} aria-hidden="true" />
      <span className={s.queueText}>
        <span className={s.queueTitle}>{x.title}</span>
        <span className={s.queueBy}>{x.artist}</span>
      </span>
    </>
  );
}

/**
 * The rail's list on a page that brings none of its own: what came before (the founder, 2026-11-06: "a way to
 * get back to past songs"), the song playing, and what plays next, each one a press away. The song playing
 * stays in view as it changes; the earlier ones are a scroll up.
 */
function Queue() {
  const { track, queue, history, skipTo, skipBack, lane, status } = usePlayer();
  const listRef = useRef<HTMLUListElement>(null);
  const nowRef = useRef<HTMLLIElement>(null);
  const placed = useRef(false);
  useEffect(() => {
    const list = listRef.current;
    const now = nowRef.current;
    if (!list || !now) return;
    // the first time at once, after that the list glides to the new song
    list.scrollTo({ top: Math.max(0, now.offsetTop - 4), behavior: placed.current ? "smooth" : "instant" });
    placed.current = true;
  }, [track?.trackId]);
  if (!track || (queue.length === 0 && history.length === 0)) return null;
  return (
    <div className={s.queue}>
      <ul ref={listRef} className={s.queueList}>
        {history.length > 0 && (
          <li className={s.queueLabel} aria-hidden="true">
            Earlier
          </li>
        )}
        {history.map((x, i) => (
          <li key={`was-${x.trackId}-${i}`}>
            <button type="button" className={s.queueItem} data-past="" onClick={() => skipBack(i)} aria-label={`Play ${x.title} again`}>
              <QueueSong x={x} n={i + 1} play />
            </button>
          </li>
        ))}
        <li ref={nowRef} className={s.queueLabel} aria-hidden="true">
          {status === "paused" ? "Paused" : "Now playing"}
        </li>
        <li>
          <div className={s.queueItem} data-now="" aria-current="true">
            <QueueSong x={track} n={history.length + 1} play={false} live={status === "playing"} />
          </div>
        </li>
        {queue.length > 0 && (
          <li className={s.queueLabel} aria-hidden="true">
            {lane ? `Up next in ${lane.label}` : "Up next"}
          </li>
        )}
        {queue.map((x, i) => (
          <li key={`next-${x.trackId}-${i}`}>
            <button type="button" className={s.queueItem} onClick={() => skipTo(i)} aria-label={`Play ${x.title}`}>
              <QueueSong x={x} n={history.length + 2 + i} play />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The most a lane hands YouTube: the song playing and the next 49 (the temporary playlist's limit is 50). */
const ON_YOUTUBE_AHEAD = YOUTUBE_TEMP_PLAYLIST_MAX - 1;

/**
 * A Discover lane on YouTube, from the player's footer (never the page: founder, 2026-09-27): the song
 * playing and up to 49 next in the lane, as YouTube's temporary playlist (no sign-in, none of our daily
 * allowance). The tab opens on the press, so the browser lets it, and fills in once the lane has fetched far
 * enough; the song here pauses, so the two don't play over each other.
 */
function OpenLaneOnYouTube() {
  const { track, status, toggle, fillLane } = usePlayer();
  const [busy, setBusy] = useState(false);
  const open = async () => {
    if (!track || busy) return;
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    if (status === "playing") toggle();
    setBusy(true);
    try {
      const ahead = await fillLane(ON_YOUTUBE_AHEAD);
      const url = youtubeTempPlaylistUrl([track.videoId, ...ahead.slice(0, ON_YOUTUBE_AHEAD).map((x) => x.videoId)]);
      if (!url) tab?.close();
      else if (tab) tab.location.href = url;
      else window.open(url, "_blank", "noopener");
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className={s.footLink} onClick={() => void open()} aria-busy={busy || undefined}>
      {busy ? "Opening on YouTube…" : "Open on YouTube ↗"}
    </button>
  );
}

export function PlayerDock({ rootRef }: { rootRef: RefObject<HTMLDivElement | null> }) {
  const { track, queue, history, status, unplayable, toggle, next, previous, stop, bigAsk, waiting, setAutoplay, lane } = usePlayer();
  const hooks = useFrameHooks();
  const rail = useRailHost();
  const { cue } = useCue();
  const barRef = useRef<HTMLElement>(null);
  const wide = useMedia(useWideQuery());
  const mode = wide ? "rail" : "top";
  // a shared song waiting for its first press (wide only: along the top the page keeps it)
  const cued = !track && cue && !cue.started && mode === "rail" ? cue : null;
  const open = !!track || !!cued;
  // Each ask for the video large is used once: the Dock (mounted on the first play, unmounted on Stop)
  // only sees an ask newer than the last one it acted on, so a later ordinary play never opens large.
  const askedBig = useRef(0);
  const freshAsk = bigAsk > askedBig.current ? bigAsk : 0;
  useEffect(() => {
    askedBig.current = bigAsk;
  }, [bigAsk]);

  // In the account window's side panel, the window uncovers the player's strip while anything is docked.
  useEffect(() => {
    if (!inPanelFrame()) return;
    const say = (on: boolean) => window.parent.postMessage({ cassettePanel: "stage", on } satisfies PanelSays, window.location.origin);
    say(open);
    return () => {
      if (open) say(false);
    };
  }, [open]);

  // The page steps aside: for the rail, by its width (CSS, from [data-rail]); pinned along the top, by its
  // measured height, which the masthead also sits below.
  useEffect(() => {
    const root = rootRef.current;
    const bar = barRef.current;
    if (!open || !root || !bar) return;
    if (mode === "rail") {
      root.setAttribute("data-rail", "");
      return () => root.removeAttribute("data-rail");
    }
    const write = () => root.style.setProperty("--top-dock-h", `${Math.ceil(bar.getBoundingClientRect().height)}px`);
    write();
    root.setAttribute("data-topdock", "");
    const ro = new ResizeObserver(write);
    ro.observe(bar);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--top-dock-h");
      root.removeAttribute("data-topdock");
    };
  }, [open, rootRef, mode]);

  if (cued) {
    return (
      <Dock
        ref={barRef}
        mode={mode}
        cover={cued.track.cover}
        lead={cued.lead}
        frame={<DockCue videoId={cued.track.videoId} title={cued.track.title} onPlay={cued.start} />}
        title={cued.track.title}
        by={byLine(cued.track)}
        keys={<DockKey big glyph="play" label={`Play ${cued.track.title}`} onClick={cued.start} />}
        dismiss={<DockKey glyph="close" label="Close" onClick={cued.dismiss} />}
        listRef={rail.setSlot}
      />
    );
  }
  if (!track) return null;
  const upNext = waiting ? (queue[0] ?? null) : null;
  // the sender's line stays above the video while their song is the one playing
  const lead = cue && mode === "rail" && cue.track.trackId === track.trackId ? cue.lead : null;
  // only a refusal is said: the play key shows playing or paused, and YouTube's own frame says it is YouTube
  const note = unplayable ? "Can't play here" : null;

  return (
    <Dock
      ref={barRef}
      mode={mode}
      bigAsk={freshAsk}
      cover={track.cover}
      frame={
        <YouTubeFrame
          videoId={track.videoId}
          fallbackVideoIds={track.fallbackVideoIds}
          startSeconds={track.startSeconds}
          onPlaying={hooks.onPlaying}
          onPaused={hooks.onPaused}
          onEnded={hooks.onEnded}
          onUnplayable={hooks.onUnplayable}
          apiRef={hooks.apiRef}
        />
      }
      title={track.title}
      upNext={
        upNext && waiting ? (
          <DockUpNext title={upNext.title} album={upNext.album ?? null} at={waiting.at} onPlay={next} onStop={stop} onAutoplay={setAutoplay} />
        ) : undefined
      }
      by={byLine(track)}
      lead={lead}
      note={note}
      keys={
        upNext ? undefined : (
          <>
            <DockKey glyph="prev" label={history.length ? `Back to ${history[history.length - 1].title}` : "Previous"} onClick={previous} disabled={history.length === 0} />
            <DockKey big glyph={status === "playing" ? "pause" : "play"} label={status === "playing" ? "Pause" : "Play"} onClick={toggle} />
            {queue.length > 0 && <DockKey glyph="next" label={`Next: ${queue[0].title}`} onClick={next} />}
          </>
        )
      }
      actions={
        <>
          {/* the song's link needs its record; a song found by its title alone may not have one */}
          {!upNext && track.albumSlug && <ShareSong albumSlug={track.albumSlug} trackId={track.trackId} title={track.title} hasVideo />}
          <DockExpand />
        </>
      }
      dismiss={upNext ? undefined : <DockKey glyph="close" label="Close the player" onClick={stop} />}
      listRef={rail.setSlot}
      listStyle={rail.accent ? accentVars(rail.accent) : undefined}
      list={rail.claimed ? null : <Queue />}
      foot={lane ? <OpenLaneOnYouTube /> : undefined}
    />
  );
}
