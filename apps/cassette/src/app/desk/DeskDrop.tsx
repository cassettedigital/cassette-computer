"use client";

/**
 * Dropping a folder or files on the desk (BUG-636). The wiring is the dashboard's (useLibraryDrop: where a
 * drag is live, where a drop goes, the outbox that waits for the computer); what the person sees is the
 * desk's own: a veil over the window on the kit's colours while a drag is live, and the progress as the
 * desk's note above the player bar, in the same capsule as its other words, not a second kind of chip
 * pinned to the bottom edge. On the Devices screen its own card shows the progress, so no note there.
 */

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useShell } from "@/app/dashboard/_shell/shell-context";
import { useLibraryDrop } from "@/app/dashboard/_shell/LibraryDrop";
import { HUB_IN_REACH } from "@/lib/hub-origin";
import { dropNote } from "@/lib/library-drop-note";
import d from "./desk.module.css";

export function DeskDrop({ quietOn }: { quietOn: string }) {
  const { dragging, ingest } = useLibraryDrop();
  const { showToast } = useShell();
  const pathname = usePathname();
  const quiet = pathname?.startsWith(quietOn) ?? false;
  const note = dropNote(ingest);
  const msg = note?.msg ?? null;
  const error = note?.error ?? false;

  useEffect(() => {
    if (msg && !quiet) showToast(msg, error ? { variant: "error" } : undefined);
  }, [msg, error, quiet, showToast]);

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
