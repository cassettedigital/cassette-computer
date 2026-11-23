"use client";

/**
 * Saved songs in the Mac app (the founder, 2026-11-23, board #1162): a song of yours you save goes to "Saved songs",
 * pinned first in Playlists. They are your own songs (the owned store, /api/sync/favorites, by the song's Cassette
 * id, as the phones' own saves are), never a catalog song you don't have: those wait in Saved for later on Discover.
 * The list is asked of the cloud once and kept for the window, newest save first; a press flips it at once and puts
 * it back if the cloud says no.
 */

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useShell } from "@/app/dashboard/_shell/shell-context";
import type { OwnedTrack } from "./types";

/** Cassette song ids, newest save first. */
let saved: string[] = [];
let asked = false;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => saved;

function ask() {
  if (asked) return;
  asked = true;
  fetch("/api/sync/favorites", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<{ favorites?: Array<{ cassette_local_id?: unknown; event_at?: unknown }> }>) : null))
    .then((d) => {
      if (!d || !Array.isArray(d.favorites)) return;
      saved = d.favorites
        .filter((f): f is { cassette_local_id: string; event_at: string } => typeof f.cassette_local_id === "string")
        .sort((a, b) => String(b.event_at ?? "").localeCompare(String(a.event_at ?? "")))
        .map((f) => f.cassette_local_id);
      tell();
    })
    .catch(() => {
      asked = false;
    });
}

/** The saved songs' Cassette ids (newest first), whether a song is saved, and the press that saves or takes it back. */
export function useSavedSongs(): { ids: string[]; isSaved: (t: OwnedTrack) => boolean; set: (songs: OwnedTrack[], on: boolean) => void } {
  const now = useSyncExternalStore(subscribe, snapshot, snapshot);
  const { showToast } = useShell();
  useEffect(ask, []);
  return useMemo(() => {
    const has = new Set(now);
    return {
      ids: now,
      isSaved: (t: OwnedTrack) => !!t.cassetteLocalId && has.has(t.cassetteLocalId),
      set: (songs: OwnedTrack[], on: boolean) => {
        const list = songs.filter((t): t is OwnedTrack & { cassetteLocalId: string } => !!t.cassetteLocalId);
        if (!list.length) return;
        const was = saved;
        const ids = new Set(list.map((t) => t.cassetteLocalId));
        saved = on ? [...list.map((t) => t.cassetteLocalId).filter((id) => !has.has(id)), ...saved] : saved.filter((id) => !ids.has(id));
        tell();
        const at = new Date().toISOString();
        Promise.all(
          list.map((t) =>
            fetch("/api/sync/favorites", {
              method: on ? "POST" : "DELETE",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(
                on
                  ? { cassette_local_id: t.cassetteLocalId, event_at: at, source_device: "mac", track_title: t.title, artist_name: t.artist, album_name: t.album }
                  : { cassette_local_id: t.cassetteLocalId, event_at: at },
              ),
            }).then((r) => {
              if (!r.ok) throw new Error(String(r.status));
            }),
          ),
        ).catch(() => {
          saved = was;
          tell();
          showToast(on ? "Couldn't save that" : "Couldn't take that out of Saved songs", { variant: "error" });
        });
      },
    };
  }, [now, showToast]);
}
