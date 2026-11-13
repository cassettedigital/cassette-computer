"use client";

/**
 * Home as the cloud makes it (lib/home, GET /api/sync/home; One Home, founder 2026-10-28): the rows,
 * their order, their names and what's in them, the same as on the phone and in the car. The desk
 * draws what's on this Mac and hides a row it can't fill.
 *
 * One read per window, through the browser's kept copy (lib/read-cache) so Home paints at once and
 * offline, then the cloud's answer; asked again when the window comes back to the front and every
 * ten minutes. The listener's own time zone goes along: their hour picks the part of the day.
 *
 * Records arrive as their songs' Cassette ids and are found among the Mac's songs (songs.ts), each
 * by the first of its songs the Mac holds, the way made for you's songs are (mixes.ts).
 */

import { useEffect, useMemo, useState } from "react";
import { swrRead } from "@/lib/read-cache";
import { HUB_IN_REACH } from "@/lib/hub-origin";
import { mixCoverSpec } from "@/lib/cover-art/mixes/catalog";
import type { HomeAnswer, HomeArtist, HomeMix, HomeRecord, HomeShelf } from "@/lib/home/types";
import { useDesk } from "./DeskShell";
import type { DeskMix } from "./mixes";
import { useSongs } from "./songs";
import { DESK, type DeskAlbum, type OwnedTrack } from "./types";

export const deskShelves = `${DESK}/shelves`;
export const deskShelf = (id: string) => `${DESK}/shelves/${encodeURIComponent(id)}`;

const MIN_SONGS = 15;
const ASK_EVERY = 10 * 60_000;

const zone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

let kept: HomeAnswer | null = null;
let askedAt = 0;
const listeners = new Set<(a: HomeAnswer) => void>();

function ask(force = false) {
  if (!force && Date.now() - askedAt < ASK_EVERY) return;
  askedAt = Date.now();
  const tz = zone();
  void swrRead<HomeAnswer>(
    `desk-home:${tz}`,
    async () => {
      // the library on the website only looks: nothing plays there, so Home showing a record there mustn't count
      // toward its rest (api/sync/home `look`); the app, where the hub is in reach, plays what it shows
      const r = await fetch(`/api/sync/home?tz=${encodeURIComponent(tz)}${HUB_IN_REACH ? "" : "&look=1"}`, { credentials: "include" });
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as HomeAnswer;
    },
    (v) => {
      kept = v;
      for (const l of listeners) l(v);
    },
  )
    .then(({ ok }) => {
      // nothing came (the cloud didn't answer): ask again in half a minute while Home is showing
      if (ok) return;
      askedAt = 0;
      setTimeout(() => listeners.size && ask(), 30_000);
    })
    .catch(() => {
      askedAt = 0;
    });
}

/** Home as the cloud made it; null until the first answer (or the kept copy) arrives. */
export function useHome(): HomeAnswer | null {
  const [home, setHome] = useState<HomeAnswer | null>(kept);
  useEffect(() => {
    listeners.add(setHome);
    ask();
    // back to the window: a new part of the day, or plays from another device, may have moved it
    const onFocus = () => ask(Date.now() - askedAt > 60_000);
    const timer = window.setInterval(() => ask(), ASK_EVERY);
    window.addEventListener("focus", onFocus);
    return () => {
      listeners.delete(setHome);
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  return home;
}

export type OnMac = {
  /** a record the Mac holds, else null */
  record: (r: HomeRecord) => DeskAlbum | null;
  /** a shelf's or row's records the Mac holds, in order */
  records: (rs: readonly HomeRecord[]) => DeskAlbum[];
  /** a song by its Cassette id, when the Mac holds it */
  song: (id: string) => OwnedTrack | null;
  /** a made-for-you playlist (or Nostalgia's mix) with the Mac's songs, else null when too few are here */
  mix: (m: HomeMix) => DeskMix | null;
  /** an artist's records on the Mac */
  artist: (a: HomeArtist) => DeskAlbum[];
  /** a shelf's records on the Mac */
  shelf: (s: HomeShelf) => DeskAlbum[];
};

/** The cloud's records, songs and playlists, found among what this Mac holds. */
export function useOnMac(): OnMac | null {
  const { shelf } = useDesk();
  const all = useSongs(true);
  return useMemo(() => {
    if (!all) return null;
    const byLocal = new Map<string, OwnedTrack>();
    for (const t of all) if (t.cassetteLocalId && t.subsonicTrackId && !byLocal.has(t.cassetteLocalId)) byLocal.set(t.cassetteLocalId, t);
    const byKey = new Map(shelf.map((a) => [a.key, a]));
    const record = (r: HomeRecord) => {
      for (const id of r.songs) {
        const key = byLocal.get(id)?.albumKey;
        const a = key ? byKey.get(key) : undefined;
        if (a) return a;
      }
      return null;
    };
    const records = (rs: readonly HomeRecord[]) => {
      const seen = new Set<string>();
      return rs.map(record).filter((a): a is DeskAlbum => !!a && !seen.has(a.key) && (seen.add(a.key), true));
    };
    return {
      record,
      records,
      song: (id: string) => byLocal.get(id) ?? null,
      mix: (m: HomeMix) => {
        const songs = m.songs.map((id) => byLocal.get(id)).filter((t): t is OwnedTrack => !!t);
        if (songs.length < (m.kind === "lately" ? 1 : MIN_SONGS)) return null;
        return {
          id: m.id,
          kind: m.kind as DeskMix["kind"],
          title: m.title,
          subtitle: m.subtitle,
          color: m.color,
          cover: m.cover ? mixCoverSpec(m.cover.key, m.cover.variant) : null,
          songs,
        };
      },
      artist: (a: HomeArtist) => {
        const names = new Set(a.songs.map((id) => byKey.get(byLocal.get(id)?.albumKey ?? "")?.artist).filter((x): x is string => !!x));
        return shelf.filter((x) => names.has(x.artist));
      },
      shelf: (s: HomeShelf) => records(s.records),
    };
  }, [shelf, all]);
}
