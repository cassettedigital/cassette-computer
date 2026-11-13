"use client";

/**
 * 3. Best-known songs: their ten most recognised songs with a preview at most (the founder, 2026-10-21:
 * "10 is probably more than enough"), numbered 01 on so they never pose as a side of the record, each
 * with its album's cover, played in the shared dock. Two columns of five on a wide page, one column on a
 * phone, and nothing held back behind a "more". The rows are the kit's SongList (promoted from here).
 */

import { useMemo } from "react";
import { SectionHead } from "@/app/_taste/SectionHead";
import { SongList, type SongItem as Row } from "@/app/_taste/SongList";
import k from "@/app/_taste/taste.module.css";
import { SONGS_MAX } from "../_lib/rules";
import type { SongItem } from "../_lib/types";
import s from "./artist.module.css";

export function Songs({ songs }: { songs: SongItem[] }) {
  const rows = useMemo<Row[]>(
    () =>
      songs.slice(0, SONGS_MAX).map((it) => ({
        key: it.play.trackId,
        title: it.play.title,
        meta: [it.play.album, it.year].filter(Boolean).join(" · "),
        cover: it.play.cover,
        sleeve: it.play.album ?? it.play.title,
        seconds: it.play.seconds,
        play: it.play,
      })),
    [songs],
  );
  return (
    <section className={s.ownSec} aria-labelledby="songs-title">
      <div className={k.wrap}>
        <SectionHead id="songs-title">Best-known songs.</SectionHead>
        <SongList items={rows} />
      </div>
    </section>
  );
}
