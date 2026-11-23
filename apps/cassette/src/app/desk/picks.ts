"use client";

/**
 * Songs picked in one of the side view's lists (the founder, 2026-11-06: a click on a song selects it,
 * Shift and Command pick several to add to a playlist or take out; only the play symbol plays). The kit's
 * rules (select.ts), kept by row; a new list starts with nothing picked. A right click or a drag (drag.tsx) acts
 * on the picks when it lands on one of them, else on that row alone, which it picks.
 */

import { useEffect, useState, type MouseEvent } from "react";
import { NOTHING_PICKED, pick, pickForMenu, pickHow, type Picked } from "@discovery/cassette-kit";

export function useSongPicks<T extends { key: string }>(songs: T[]) {
  const [picked, setPicked] = useState<Picked>(NOTHING_PICKED);
  const listKey = songs.map((x) => x.key).join("\u0000");
  useEffect(() => setPicked(NOTHING_PICKED), [listKey]);
  return {
    isPicked: (i: number) => picked.rows.includes(i),
    onSelect: (i: number) => (e: MouseEvent) => setPicked((was) => pick(was, i, pickHow(e))),
    take: (i: number): T[] => {
      const now = pickForMenu(picked, i);
      if (now !== picked) setPicked(now);
      return now.rows.map((r) => songs[r]).filter((x): x is T => !!x);
    },
  };
}
