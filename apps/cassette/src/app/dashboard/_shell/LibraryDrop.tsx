"use client";

/**
 * Whole-screen drop overlay (SPEC This-Mac card, Job 3) — drag an album folder
 * (or audio files) anywhere on the dashboard and the whole screen becomes a
 * welcoming target; let go anywhere and it routes to the shared ingest store
 * (→ local Cassette Player → music dir → ingest). Audio never touches the cloud.
 *
 * Progress shows ON the device card (AddMusic) via the shared store; off the
 * devices page a small chip carries it so a drop is never met with silence.
 * No reachable Player → the files hold in the local outbox (library-queue) and
 * replay when it returns (the drain effect below).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  collectDropFiles,
  listenForAppDrops,
  startIngest,
  useLibraryIngest,
  type IngestState,
} from "@/lib/library-ingest";
import { flushQueue, queuedCount } from "@/lib/library-queue";
import { HUB_IN_REACH } from "@/lib/hub-origin";
import { StatusDot, type StatusTone } from "@/app/components/StatusDot";
import styles from "./LibraryDrop.module.css";

/**
 * The window's drop and outbox wiring, shared by this dashboard overlay and the desk's own (desk/DeskDrop,
 * which draws it in the desk's look, BUG-636): whether a file drag is live over the window, and the ingest
 * state a drop starts. Mount it once per window.
 */
export function useLibraryDrop(): { dragging: boolean; ingest: IngestState } {
  const [dragging, setDragging] = useState(false);
  const ingest = useLibraryIngest();
  const depth = useRef(0);

  const handleDrop = useCallback(async (e: DragEvent) => {
    const files = await collectDropFiles(e.dataTransfer ?? null);
    if (files.length) void startIngest(files);
  }, []);

  // Inside the desktop app the window's drops go to the app, never to the page: listen there (the app then
  // moves or copies them, lib/library-ingest addPathsInApp). In a browser this does nothing.
  useEffect(() => listenForAppDrops(setDragging) ?? undefined, []);

  // Window-level drag detection → the settle-in overlay. Guarded to OS file drops
  // ("Files") so it never collides with the dashboard's DnD-kit track dragging.
  useEffect(() => {
    const isFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onEnter = (e: DragEvent) => {
      if (!isFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (isFiles(e)) e.preventDefault(); // required for drop to fire
    };
    const onLeave = (e: DragEvent) => {
      if (!isFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!isFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      void handleDrop(e);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        depth.current = 0;
        setDragging(false);
      }
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("keydown", onKey);
    };
  }, [handleDrop]);

  // Drain the local outbox when the Player is back (mount / focus / 60s).
  useEffect(() => {
    let cancelled = false;
    const tryFlush = async () => {
      if (cancelled) return;
      if ((await queuedCount()) === 0) return;
      await flushQueue();
    };
    void tryFlush();
    const onFocus = () => void tryFlush();
    window.addEventListener("focus", onFocus);
    const iv = window.setInterval(tryFlush, 60_000);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(iv);
    };
  }, []);

  return { dragging, ingest };
}

export function LibraryDrop({ quietOn = "/dashboard/devices" }: { quietOn?: string } = {}) {
  const { dragging, ingest } = useLibraryDrop();
  const pathname = usePathname();

  // On the devices page the card (AddMusic) shows progress; elsewhere a chip does.
  // `quietOn` names that page for the shell mounting this (the desk has its own).
  const onDevices = pathname?.startsWith(quietOn) ?? false;
  const chip = onDevices ? null : chipFor(ingest);

  return (
    <>
      {dragging && (
        <div className={styles.overlay} aria-hidden="true">
          {/* the website can't reach the computer, so it says where music goes in before the drop, not after
              (BUG-929; the library on the website, 2026-11-08) */}
          {HUB_IN_REACH ? (
            <>
              <div className={styles.title}>Drop to add to your library</div>
              <div className={styles.sub}>Let go anywhere. We&apos;ve got it from here.</div>
            </>
          ) : (
            <>
              <div className={styles.title}>Music goes in on your computer</div>
              <div className={styles.sub}>Drop it into the Cassette app there.</div>
            </>
          )}
        </div>
      )}
      {chip && (
        <div role="status" className={styles.chip}>
          <StatusDot tone={chip.tone} label={chip.label} />
        </div>
      )}
    </>
  );
}

// The floating progress chip speaks the kit lamp vocabulary: busy (orange) while
// uploading, syncing (amber) while identifying, reachable (green) when added,
// error (red) on failure, offline (grey) when it's waiting on the Mac.
function chipFor(i: IngestState): { tone: StatusTone; label: string } | null {
  switch (i.phase) {
    case "uploading":
      return { tone: "busy", label: `Adding ${i.album} — ${i.uploaded}/${i.total}` };
    case "identifying":
      return { tone: "syncing", label: `Identifying ${i.album}…` };
    case "done":
      return { tone: "reachable", label: `Added ${i.album}` };
    case "queued":
      return {
        tone: "offline",
        label: `Queued ${i.queued} song${i.queued === 1 ? "" : "s"}. They go in when your computer is back.`,
      };
    case "noMac":
      return { tone: "offline", label: "Add music in the Cassette app." };
    case "error":
      return { tone: "error", label: "Couldn't add those files." };
    default:
      return null;
  }
}
