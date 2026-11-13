"use client";

/**
 * Now Playing's pieces (LargeCurrentlyPlayingPlayerView + PlayerControlView), so a column the width of a
 * phone draws the phone's player:
 *
 *   PlayerArt       the cover, 8pt corners, the full width of the column
 *   StationLine     radio only: the station's 22pt mark and "NAME · NETWORK", 12pt above the title
 *   PlayerTitle     the song in the player's caps (34pt, one line) and the artist in the serif italic,
 *                   in the record's tint
 *   Scrubber        the line: played part in the record's tint over the hairline, the time gone on the
 *                   left and the time left on the right. `live` (radio) draws the line full and says LIVE.
 *                   With `onSeek` it is the phone's SeekableTimeSlider: press anywhere on the line and
 *                   drag (the times follow the finger, the song moves on release), or the arrow keys
 *                   (5 seconds; Home and End). The line thickens under the pointer, as the phone's does
 *                   under a finger.
 */

import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import s from "./kit.module.css";

const mmss = (sec: number | null | undefined) =>
  sec == null || !Number.isFinite(sec) ? "–:––" : `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

export function PlayerArt({ children }: { children: ReactNode }) {
  return <span className={s.playerArt}>{children}</span>;
}

export function StationLine({ mark, text }: { mark: ReactNode | null; text: string }) {
  return (
    <p className={s.stationLine}>
      <span className={s.stationMark}>{mark}</span>
      <span>{text}</span>
    </p>
  );
}

export function PlayerTitle({ title, artist }: { title: string; artist: ReactNode }) {
  return (
    <div className={s.playerTitle}>
      <p className={s.playerSong} title={title} aria-live="polite">
        {title}
      </p>
      <p className={s.playerArtist}>{artist}</p>
    </div>
  );
}

export function Scrubber({
  elapsed,
  duration,
  live,
  note,
  onSeek,
  inline,
}: {
  elapsed?: number;
  duration?: number | null;
  live?: boolean;
  note?: string;
  onSeek?: (seconds: number) => void;
  /** a computer's player bar: the times either side of the line, not under it */
  inline?: boolean;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const seekable = !!onSeek && !live && !!duration;
  const at = drag ?? elapsed ?? 0;
  const p = live ? 1 : duration ? Math.max(0, Math.min(1, at / duration)) : 0;
  const fromX = (x: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r || !duration) return 0;
    return Math.max(0, Math.min(1, (x - r.left) / r.width)) * duration;
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (!seekable || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(fromX(e.clientX));
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (drag !== null) setDrag(fromX(e.clientX));
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (drag === null) return;
    const to = fromX(e.clientX);
    setDrag(null);
    onSeek?.(to);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    // Cmd/Ctrl/Option-arrows are the window's (Cmd-Right skips the song), not a 5 second seek (BUG-604)
    if (!seekable || !duration || e.metaKey || e.ctrlKey || e.altKey) return;
    const to =
      e.key === "ArrowRight" ? Math.min(duration, at + 5) : e.key === "ArrowLeft" ? Math.max(0, at - 5) : e.key === "Home" ? 0 : e.key === "End" ? duration - 1 : null;
    if (to === null) return;
    e.preventDefault();
    e.stopPropagation();
    onSeek?.(to);
  };
  return (
    <div className={s.scrub} data-live={live || undefined} data-seek={seekable || undefined} data-drag={drag !== null || undefined} data-inline={inline || undefined}>
      <div
        ref={track}
        className={s.scrubHit}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={key}
        {...(seekable
          ? {
              role: "slider",
              tabIndex: 0,
              "aria-label": "Position",
              "aria-valuemin": 0,
              "aria-valuemax": Math.round(duration ?? 0),
              "aria-valuenow": Math.round(at),
              "aria-valuetext": `${mmss(at)} of ${mmss(duration)}`,
            }
          : { "aria-hidden": true })}
      >
        <div className={s.scrubTrack}>
          <i style={{ transform: `scaleX(${p})` }} />
        </div>
      </div>
      <div className={s.scrubTimes}>
        {live ? (
          <>
            <span className={s.scrubLive}>Live</span>
            <span>{note ?? ""}</span>
          </>
        ) : (
          <>
            <span>{mmss(at)}</span>
            <span>{duration ? `-${mmss(Math.max(0, duration - at))}` : "–:––"}</span>
          </>
        )}
      </div>
    </div>
  );
}
