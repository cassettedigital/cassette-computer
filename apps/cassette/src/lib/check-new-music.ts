"use client";

/**
 * Check for new music (the founder, 2026-11-23): the hub looks through the Cassette folder and every folder
 * Cassette reads, then sends what it found to your library and phones. It also happens by itself (change
 * notices, a look every 15 minutes, a full pass every hour); this is the on-demand door, one action everywhere
 * it's offered: the computer's page and its right-click menu in the app, and the website's device page.
 *
 * Called "new music", never "updates": "Update available" is the app's own new version.
 */

import { useCallback, useRef, useState } from "react";
import { fetchIngestStatus, triggerLibraryIngest } from "@/lib/library-remote";

type Notify = (message: string, opts?: { variant?: "error" }) => void;

const LOOK_EVERY_MS = 1500;
const GIVE_UP_MS = 10 * 60 * 1000; // a first look through a big drive can take a while; the hub carries on regardless

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** `run` starts a check and tells `notify` how it went; `checking` is true until it's done. */
export function useCheckForNewMusic(notify: Notify): { checking: boolean; run: () => Promise<void> } {
  const [checking, setChecking] = useState(false);
  const busy = useRef(false);

  const run = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setChecking(true);
    try {
      const before = await fetchIngestStatus();
      if (!(await triggerLibraryIngest())) {
        notify("Your computer didn't answer. Is Cassette open on it?", { variant: "error" });
        return;
      }
      const startedAt = Date.now();
      let seenWorking = false;
      while (Date.now() - startedAt < GIVE_UP_MS) {
        await wait(LOOK_EVERY_MS);
        const now = await fetchIngestStatus();
        if (!now) continue;
        if (now.state === "scanning" || now.state === "working") {
          seenWorking = true;
          continue;
        }
        // the hub answers "done" from the last check until this one begins
        if (!seenWorking && now.at === before?.at) continue;
        if (now.state === "error") {
          notify("Cassette couldn't finish checking. It tries again by itself within the hour.", { variant: "error" });
          return;
        }
        // A count to compare with only exists once the hub has finished a check since it started.
        if (before?.state !== "done" || before.count === undefined) {
          notify("Checked. Anything new is in your library now.");
          return;
        }
        const added = (now.count ?? 0) - before.count;
        notify(added > 0 ? `Found ${added} new song${added === 1 ? "" : "s"}` : "No new music. You're up to date.");
        return;
      }
      notify("Still checking. New music shows up as it's found.");
    } finally {
      busy.current = false;
      setChecking(false);
    }
  }, [notify]);

  return { checking, run };
}
