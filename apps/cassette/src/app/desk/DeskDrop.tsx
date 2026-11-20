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

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Glyph } from "@discovery/cassette-kit";
import { useShell } from "@/app/dashboard/_shell/shell-context";
import { useLibraryDrop } from "@/app/dashboard/_shell/LibraryDrop";
import { HubPicture } from "@/app/components/HubPicture";
import { HUB_IN_REACH } from "@/lib/hub-origin";
import { dropNote } from "@/lib/library-drop-note";
import { importStatus, type ImportStatus } from "@/lib/import-status";
import { coverArtURL } from "@/lib/playback-remote";
import { DESK } from "./types";
import { useDesk } from "./DeskShell";
import { FIRST_ROW } from "./first-run";
import { rereadLibrary } from "./songs";
import d from "./desk.module.css";

export function DeskDrop({ quietOn }: { quietOn: string }) {
  const { dragging, ingest } = useLibraryDrop();
  const { showToast } = useShell();
  const router = useRouter();
  const pathname = usePathname();
  const { shelf } = useDesk();
  // where the add card itself is on screen (Devices, and Home before a whole row of music): it's the focus
  // there, so the note at the foot of the window steps aside
  const onCard = (pathname?.startsWith(quietOn) ?? false) || (pathname === DESK && shelf.length < FIRST_ROW);

  // A brief word only for what isn't progress (waiting for the computer, couldn't add). Progress is the
  // steady note below: a toast per song flashed in and out on every one (the founder, 2026-11-20).
  const note = ingest.phase === "queued" || ingest.phase === "noMac" || ingest.phase === "error" ? dropNote(ingest) : null;
  const msg = note?.msg ?? null;
  const error = note?.error ?? false;
  useEffect(() => {
    if (msg && !onCard) showToast(msg, error ? { variant: "error" } : undefined);
  }, [msg, error, onCard, showToast]);

  // read once, as the import turns done (not on a window that opens with a finished one still showing);
  // and a new add brings the note back if the last one was tucked away
  const was = useRef(ingest.phase);
  const [tucked, setTucked] = useState(false);
  useEffect(() => {
    if (ingest.phase === "done" && was.current !== "done") rereadLibrary(router);
    if (ingest.phase === "uploading" && was.current !== "uploading") setTucked(false);
    was.current = ingest.phase;
  }, [ingest.phase, router]);

  const status = importStatus(ingest);
  const showNote = !!status && (status.busy || ingest.phase === "done") && !tucked && !onCard;

  return (
    <>
      {showNote && <ImportNote s={status!} onTuck={() => setTucked(true)} onOpen={() => router.push(quietOn)} />}
      {dragging && <DropVeil />}
    </>
  );
}

/**
 * The add going on, at the window's foot on the left, over the end of the sidebar and out of the music's
 * way: the first record found (its cover once the computer has read it), what's happening and how far, in
 * one note that stays up and changes in place. A click opens Devices, where the card has the rest; the ×
 * tucks it away and the sidebar's Devices line keeps counting. Finished, it says where the music went and
 * leaves with the add.
 */
function ImportNote({ s, onTuck, onOpen }: { s: ImportStatus; onTuck: () => void; onOpen: () => void }) {
  const lead = s.albums.find((a) => a.trackId);
  const src = lead ? coverArtURL(lead.trackId, 80) : null;
  const pct = s.progress === null ? null : Math.round(s.progress * 100);
  return (
    <div className={d.importNote} role="status" aria-live="polite" data-done={!s.busy || undefined}>
      <button type="button" className={d.importNoteBody} onClick={onOpen} title="See it on Devices">
        <span className={d.importArt} data-found={lead?.found || undefined}>
          {src ? <HubPicture src={src} alt="" /> : <span className={d.importReels} data-run={s.busy || undefined} aria-hidden="true" />}
          {!s.busy && (
            <span className={d.importDone} aria-hidden="true">
              <Glyph name="check" size={12} />
            </span>
          )}
        </span>
        <span className={d.importWords}>
          <span className={d.importTitle}>
            {s.verb} <em>{s.what}</em>
          </span>
          <span className={d.importLine}>{s.line}</span>
        </span>
      </button>
      {s.busy && (
        <button type="button" className={d.importTuck} onClick={onTuck} aria-label="Hide this. It keeps going, and Devices in the sidebar shows it." title="Hide">
          <Glyph name="close" size={12} />
        </button>
      )}
      <span className={d.importBar} data-run={(s.busy && pct === null) || undefined} aria-hidden="true">
        <i style={{ width: `${pct ?? 0}%` }} />
      </span>
    </div>
  );
}

function DropVeil() {
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
