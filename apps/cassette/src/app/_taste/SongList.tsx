"use client";

/**
 * Songs as rows: the cover small, the title in the serif, one line of meta under it (the album and year,
 * or the artist and album), and the length at the end, or the playing bars while it is the one docked. A
 * row is a button that plays from it in the page frame's dock, "this one, then onward". Every row counts,
 * 01 on (never posing as a side of a record): pointed at, the kit's one hover-play, a plain triangle in the
 * page's accent, takes the number's place, as it does in every song list (the founder, 2026-11-06: "truly
 * universal"). The row that is docked pauses and resumes. One column on a phone, two from 760, filled down
 * and then across. No lines between rows. Promoted from the artist page's best-known songs.
 *
 * A song whose preview isn't known yet passes `resolve` instead of `play`: the preview is looked up when
 * the row is pressed, and a song with none says so in its meta line. `end` puts a page's own keys at the
 * end of a row (save, its album), outside the play button.
 */

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { PlayOver } from "@discovery/cassette-kit/play-over";
import { Bars } from "./Bars";
import { Sleeve } from "./Sleeve";
import { usePlayer } from "./player";
import type { Playable } from "./play";
import s from "./songs.module.css";

export type SongItem = {
  key: string | number;
  title: string;
  /** the line under the title */
  meta: string;
  cover: string | null;
  /** what a song with no cover shows the first letter of (its album, usually) */
  sleeve: string;
  seconds: number | null;
  /** the preview, when it is known */
  play: Playable | null;
  /** looks the preview up when the row is pressed, for a song whose preview isn't known yet */
  resolve?: () => Promise<Playable | null>;
  /** what a press does in place of a preview (inside the iPhone app, where the page plays nothing), and its label */
  open?: () => void;
  openLabel?: string;
  /** the page's own keys at the end of the row */
  end?: ReactNode;
};

/** m:ss, or nothing (rounded as the album page's tracklist rounds). */
function time(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const r = Math.round(seconds % 60);
  return r === 60 ? `${m + 1}:00` : `${m}:${String(r).padStart(2, "0")}`;
}

export function SongList({ items }: { items: SongItem[] }) {
  const { playList, play, isCurrent, status, toggle } = usePlayer();
  const queue = useMemo(() => items.map((x) => x.play).filter((x): x is Playable => !!x), [items]);
  const [found, setFound] = useState<Map<string | number, Playable>>(() => new Map());
  const [pending, setPending] = useState<string | number | null>(null);
  const [missing, setMissing] = useState<Set<string | number>>(() => new Set());

  async function press(it: SongItem) {
    if (it.open) return it.open();
    const known = it.play ?? found.get(it.key) ?? null;
    if (known && isCurrent(known.trackId)) return toggle();
    if (it.play) return playList(queue, queue.indexOf(it.play));
    if (known) return play(known);
    if (!it.resolve || pending != null) return;
    setPending(it.key);
    try {
      const p = await it.resolve();
      if (p) {
        setFound((m) => new Map(m).set(it.key, p));
        play(p);
      } else {
        setMissing((m) => new Set(m).add(it.key));
      }
    } catch {
      setMissing((m) => new Set(m).add(it.key));
    } finally {
      setPending(null);
    }
  }

  return (
    <ol className={s.songs} style={{ "--rows": Math.ceil(items.length / 2) } as CSSProperties}>
      {items.map((it, i) => {
        const p = it.play ?? found.get(it.key) ?? null;
        const cur = !!p && isCurrent(p.trackId);
        const none = missing.has(it.key);
        // the shared hover-play on its number: a press plays this row (not the one playing, whose press pauses)
        const over = !cur && !none && !it.open;
        const row = (
          <button
            type="button"
            className={s.song}
            data-over={over || undefined}
            aria-pressed={cur}
            disabled={none}
            aria-label={it.open ? (it.openLabel ?? it.title) : cur ? (status === "paused" ? `Resume ${it.title}` : `Pause ${it.title}`) : `Play ${it.title}`}
            onClick={() => void press(it)}
          >
            <span className={s.songN}>
              {String(i + 1).padStart(2, "0")}
              {over && <PlayOver bare size={16} />}
            </span>
            <span className={s.songArt}>
              <Sleeve src={it.cover} title={it.sleeve.replace(/^the\s+/i, "")} small />
            </span>
            <span className={s.songText}>
              <span className={s.songTitle}>{it.title}</span>
              <span className={s.songMeta}>{none ? "No preview" : it.meta}</span>
            </span>
            {cur ? (
              <Bars live={status === "playing"} className={s.songBars} />
            ) : (
              <span className={s.songTime}>{pending === it.key ? "…" : time(it.seconds)}</span>
            )}
          </button>
        );
        return (
          <li key={it.key} className={it.end ? s.withEnd : undefined}>
            {row}
            {it.end ? <span className={s.end}>{it.end}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
