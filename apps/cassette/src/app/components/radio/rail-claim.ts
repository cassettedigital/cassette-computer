"use client";

/**
 * Whether the radio is showing in a page's right rail (the taste frame's RadioRail) right now. The corner dock
 * (RadioDock) rides on every page and steps aside while it is, so one station never shows in two players. A
 * plain module store: the rail and the dock sit in different trees (the page frame, the app's providers).
 */

import { useSyncExternalStore } from "react";

let inRail = false;
const heard = new Set<() => void>();

export function setRadioInRail(on: boolean): void {
  if (inRail === on) return;
  inRail = on;
  heard.forEach((f) => f());
}

export function useRadioInRail(): boolean {
  return useSyncExternalStore(
    (cb) => {
      heard.add(cb);
      return () => heard.delete(cb);
    },
    () => inRail,
    () => false,
  );
}
