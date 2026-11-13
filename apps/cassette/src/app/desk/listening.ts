"use client";

/**
 * The listening rows, in the browser's own time: the shared rules (lib/home-shelves/listening, the
 * phone's On repeat and Around now) over the plays the window was handed, resolved to records on the
 * shelf. Around now waits for the page to be in the browser (the server's clock isn't the listener's
 * evening), so it is empty on the first paint and fills in straight after.
 */

import { useEffect, useMemo, useState } from "react";
import { aroundNow, onRepeat, type DayPart } from "@/lib/home-shelves/listening";
import { useDesk } from "./DeskShell";
import type { DeskAlbum } from "./types";

export const PART_WORD: Record<DayPart, string> = { morning: "this morning", afternoon: "this afternoon", evening: "this evening", late: "late at night" };

export function useListening() {
  const { shelf, plays } = useDesk();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  return useMemo(() => {
    const byKey = new Map(shelf.map((a) => [a.key, a]));
    const pick = (keys: string[]) => keys.map((k) => byKey.get(k)).filter((a): a is DeskAlbum => !!a);
    // the records played lately, most recent first, each once (plays arrive newest first)
    const seen = new Set<string>();
    const recentKeys: string[] = [];
    for (const p of plays) if (!seen.has(p.key)) (seen.add(p.key), recentKeys.push(p.key));
    const around = now ? aroundNow(plays, now) : null;
    return {
      recent: pick(recentKeys.slice(0, 12)),
      onRepeat: now ? pick(onRepeat(plays, now)) : [],
      aroundNow: around ? { part: around.part, albums: pick(around.keys) } : null,
    };
  }, [shelf, plays, now]);
}
