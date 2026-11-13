"use client";

/**
 * Whether this Mac has a network right now, as the browser reports it, live (the online and offline
 * events). The window's own data says when it was drawn from the kept copy (DeskData.offline), but a
 * window opened online and then cut off is only told by this.
 */

import { useSyncExternalStore } from "react";
import { SIDECAR_SAME_ORIGIN } from "@/lib/playback-remote";

const subscribe = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

/**
 * What to say when the music isn't answering (BUG-607). In the app it is the app's own player, which
 * the shell's watchdog is already restarting, so it says so and nothing more: never "open Cassette"
 * inside Cassette. On the web it is the computer with the music, which may simply not be running
 * Cassette (the old library's HubOfflineBar draws the same line).
 */
export function offlineWords(computer?: string | null): { head: string; rest?: string } {
  if (SIDECAR_SAME_ORIGIN) return { head: "Reconnecting to your music…" };
  return { head: `${computer ?? "Your computer"} isn't answering.`, rest: "Open Cassette there to play your music." };
}
