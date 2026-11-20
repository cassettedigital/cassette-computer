"use client";

/**
 * Dropping a folder or files on the desk (BUG-636). The wiring is the dashboard's (useLibraryDrop: where a
 * drag is live, where a drop goes, the outbox that waits for the computer); what the person sees is the
 * desk's own: a veil over the window on the kit's colours while a drag is live, and the progress as the
 * desk's note above the player bar, in the same capsule as its other words, not a second kind of chip
 * pinned to the bottom edge. On the Devices screen its own card shows the progress, so no note there.
 *
 * When music that went in (a drop, or Choose music anywhere in the window: one shared store) is done, the
 * window reads its library again, as it does when a rip finishes (disc.tsx): the hub has told the cloud
 * before it says done (sidecar ingest.go), so Home, the rail and the shelves show the new records then,
 * not three minutes later on coming back to the window (2026-11-20: four albums dropped on Windows sat
 * on Devices while Home still said the library was empty).
 */

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useShell } from "@/app/dashboard/_shell/shell-context";
import { useLibraryDrop } from "@/app/dashboard/_shell/LibraryDrop";
import { HUB_IN_REACH } from "@/lib/hub-origin";
import { dropNote } from "@/lib/library-drop-note";
import { rereadLibrary } from "./songs";
import d from "./desk.module.css";

export function DeskDrop({ quietOn }: { quietOn: string }) {
  const { dragging, ingest } = useLibraryDrop();
  const { showToast } = useShell();
  const router = useRouter();
  const pathname = usePathname();
  const quiet = pathname?.startsWith(quietOn) ?? false;
  const note = dropNote(ingest);
  const msg = note?.msg ?? null;
  const error = note?.error ?? false;

  useEffect(() => {
    if (msg && !quiet) showToast(msg, error ? { variant: "error" } : undefined);
  }, [msg, error, quiet, showToast]);

  // read once, as the import turns done (not on a window that opens with a finished one still showing)
  const was = useRef(ingest.phase);
  useEffect(() => {
    if (ingest.phase === "done" && was.current !== "done") rereadLibrary(router);
    was.current = ingest.phase;
  }, [ingest.phase, router]);

  if (!dragging) return null;
  return (
    <div className={d.dropOver} aria-hidden="true">
      {/* the website can't reach the computer, so it says where music goes in before the drop, not after */}
      {HUB_IN_REACH ? (
        <>
          <div className={d.dropOverTitle}>Drop to add to your library</div>
          <div className={d.dropOverSub}>Let go anywhere. We&apos;ve got it from here.</div>
        </>
      ) : (
        <>
          <div className={d.dropOverTitle}>Music goes in on your computer</div>
          <div className={d.dropOverSub}>Drop it into the Cassette app there.</div>
        </>
      )}
    </div>
  );
}
