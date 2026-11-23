"use client";

/**
 * Preview album for a record a page shows but hasn't read the songs of (Discover's shelves: a cover's play key plays
 * that record in full). The press asks /api/preview/album for the record's songs and its start song (_kit/hear.ts,
 * the album and artist pages' own recipe), then plays them as Preview album does everywhere: the start song, then the
 * rest of the record, wrapping round. A record's answer is kept for the visit, so a second press plays at once.
 *
 * The latest press wins: a slow answer for an earlier press never takes over from a later one. With no answer (a
 * record hidden since the page was made, the network away), the one song the page already holds plays on its own.
 */

import { useCallback, useState } from "react";
import type { Playable } from "./play";
import { usePlayerMaybe } from "./player";

/** A record's Preview album as /api/preview/album answers it (_kit/hear.ts readHear): its playable songs in its
 *  page's order and the one it starts on. Here, not beside the read, so the drawing reads nothing to know it. */
export type Hear = { queue: Playable[]; start: number };

const kept = new Map<number, Promise<Hear | null>>();
let pressed = 0;

function hearOf(albumId: number): Promise<Hear | null> {
  const had = kept.get(albumId);
  if (had) return had;
  const asked = fetch(`/api/preview/album?id=${albumId}`)
    .then((res) => (res.ok ? (res.json() as Promise<Hear>) : null))
    .then((h) => (h && h.queue.length > 0 && h.queue[h.start] ? h : null))
    .catch(() => null);
  kept.set(albumId, asked);
  // a miss is asked again on the next press
  void asked.then((h) => {
    if (!h) kept.delete(albumId);
  });
  return asked;
}

/** `asking` is the record whose songs are on their way (its key shows it), `preview` plays a record in full. */
export function useHearRecord(): { asking: number | null; preview: (albumId: number, fallback: Playable | null) => Promise<void> } {
  const player = usePlayerMaybe();
  const [asking, setAsking] = useState<number | null>(null);
  const preview = useCallback(
    async (albumId: number, fallback: Playable | null) => {
      if (!player) return;
      const press = ++pressed;
      setAsking(albumId);
      const hear = await hearOf(albumId);
      setAsking((a) => (a === albumId ? null : a));
      if (press !== pressed) return;
      if (hear) player.playList(hear.queue, hear.start, { wrap: true });
      else if (fallback) player.playList([fallback], 0);
    },
    [player],
  );
  return { asking, preview };
}
