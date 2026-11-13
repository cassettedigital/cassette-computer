"use client";

/**
 * The made-for-you playlists in the desk: the cloud makes them for every device
 * (/api/sync/made-for-you, lib/taste/made-for-you.ts), the desk plays the ones whose songs are on
 * this Mac. Each song comes as its cassette_local_id and is matched to the Mac's song list; a song
 * the Mac doesn't hold is left out, and a playlist that falls under 15 songs is hidden (Lately
 * shows with any), as the phone does.
 *
 * Read through the browser's kept copy first (swrRead), then the cloud's answer, so the row paints
 * at once and offline. The listener's own time zone goes along: their day and hour pick the
 * playlists.
 */

import { useEffect, useMemo, useState } from "react";
import { swrRead } from "@/lib/read-cache";
import { mixCoverSpec, type MixCoverSpec } from "@/lib/cover-art/mixes/catalog";
import { useSongs } from "./songs";
import { DESK, type OwnedTrack } from "./types";

type Wire = {
  version: number;
  day: string;
  slot: string;
  mixes: Array<{
    id: string;
    kind: "lately" | "daypart" | "been-a-while" | "mood";
    title: string;
    subtitle: string | null;
    color: string | null;
    cover: { key: string; variant: string } | null;
    songs: string[];
  }>;
};

export type DeskMix = {
  id: string;
  /** "nostalgia" is a Nostalgia shelf's mix of songs from its years (Home's reaching row) */
  kind: Wire["mixes"][number]["kind"] | "nostalgia";
  title: string;
  subtitle: string | null;
  color: string | null;
  cover: MixCoverSpec | null;
  /** the Mac's songs, in the playlist's order */
  songs: OwnedTrack[];
};

const MIN_SONGS = 15;

export const deskMix = (id: string) => `${DESK}/mix/${encodeURIComponent(id)}`;

const zone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

// one read for the whole window (the Home row, the side view and a mix's page all show them),
// asked again after ten minutes so a new part of the day's playlists arrive
let kept: Wire | null = null;
let askedAt = 0;
const listeners = new Set<(w: Wire) => void>();
function ask() {
  if (Date.now() - askedAt < 10 * 60_000) return;
  askedAt = Date.now();
  const tz = zone();
  void swrRead<Wire>(
    `desk-made-for-you:${tz}`,
    async () => {
      const r = await fetch(`/api/sync/made-for-you?tz=${encodeURIComponent(tz)}`, { credentials: "include" });
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as Wire;
    },
    (v) => {
      kept = v;
      for (const l of listeners) l(v);
    },
  )
    .then(({ ok }) => {
      // nothing came (the cloud didn't answer, or the window opened before a deploy landed):
      // ask again in half a minute while something still shows them
      if (ok) return;
      askedAt = 0;
      setTimeout(() => listeners.size && ask(), 30_000);
    })
    .catch(() => {
      askedAt = 0;
    });
}

/** The day's made-for-you playlists on this Mac, in row order; null while they load. */
export function useMadeForYou(): DeskMix[] | null {
  const [wire, setWire] = useState<Wire | null>(kept);
  useEffect(() => {
    listeners.add(setWire);
    ask();
    return () => {
      listeners.delete(setWire);
    };
  }, []);
  const all = useSongs(!!wire);
  return useMemo(() => {
    if (!wire || !all) return null;
    const byLocal = new Map<string, OwnedTrack>();
    for (const t of all) if (t.cassetteLocalId && t.subsonicTrackId && !byLocal.has(t.cassetteLocalId)) byLocal.set(t.cassetteLocalId, t);
    return wire.mixes
      .map((m) => ({
        id: m.id,
        kind: m.kind,
        title: m.title,
        subtitle: m.subtitle,
        color: m.color,
        cover: m.cover ? mixCoverSpec(m.cover.key, m.cover.variant) : null,
        songs: m.songs.map((id) => byLocal.get(id)).filter((t): t is OwnedTrack => !!t),
      }))
      .filter((m) => m.songs.length >= (m.kind === "lately" ? 1 : MIN_SONGS));
  }, [wire, all]);
}

/** One of the day's playlists by its id; undefined while they load, null when it isn't there today. */
export function useMix(id: string): DeskMix | null | undefined {
  const mixes = useMadeForYou();
  if (!mixes) return undefined;
  return mixes.find((m) => m.id === id) ?? null;
}
