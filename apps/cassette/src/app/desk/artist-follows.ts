"use client";

/**
 * Following in the Mac app (the founder, 2026-11-23, board #1162): every artist you own a record by is one you
 * follow, so their new records come to Home. An artist's menu here says Unfollow, or Follow for one you unfollowed;
 * unfollowing only stops the news and never touches the music. The list of the ones you unfollowed is asked of the
 * cloud once (GET /api/follows?type=artist&mine=1) and kept for the window; a press flips it at once and puts it back
 * if the cloud says no.
 */

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useShell } from "@/app/dashboard/_shell/shell-context";

let unfollowed = new Set<string>();
let asked = false;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => unfollowed;

function ask() {
  if (asked) return;
  asked = true;
  fetch("/api/follows?type=artist&mine=1", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<{ unfollowed?: unknown }>) : null))
    .then((d) => {
      if (d && Array.isArray(d.unfollowed)) {
        unfollowed = new Set(d.unfollowed.filter((x): x is string => typeof x === "string"));
        tell();
      }
    })
    .catch(() => {
      asked = false;
    });
}

/** Whether you follow an artist you own (by catalog slug), and the press that unfollows or follows them again. */
export function useArtistFollow(): { follows: (slug: string) => boolean; set: (slug: string, follow: boolean) => void } {
  const now = useSyncExternalStore(subscribe, snapshot, snapshot);
  const { showToast } = useShell();
  useEffect(ask, []);
  return useMemo(
    () => ({
      follows: (slug: string) => !now.has(slug),
      set: (slug: string, follow: boolean) => {
        const was = unfollowed;
        const next = new Set(unfollowed);
        if (follow) next.delete(slug);
        else next.add(slug);
        unfollowed = next;
        tell();
        fetch("/api/follows", {
          method: follow ? "POST" : "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(follow ? { type: "artist", id: slug, level: "following", source: "desk" } : { type: "artist", id: slug, action: "unfollow" }),
        })
          .then((r) => {
            if (!r.ok) throw new Error(String(r.status));
          })
          .catch(() => {
            unfollowed = was;
            tell();
            showToast(follow ? "Couldn't follow them" : "Couldn't unfollow them", { variant: "error" });
          });
      },
    }),
    [now, showToast],
  );
}
