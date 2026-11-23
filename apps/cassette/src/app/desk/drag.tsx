"use client";

/**
 * Dragging music onto a playlist: a song, the songs picked in a list, or a whole album (its tile, its art in the
 * side view), onto a playlist in the sidebar, or onto "New playlist" (the sidebar's row while a drag is on, the
 * Playlists page while there are none) to start one with it. The founder's wife, testing the app 2026-11-21:
 * "drag and drop to create or fill a playlist doesn't work".
 *
 * Pointer events, not the browser's drag and drop. Inside the app the window's own drop catcher (Tauri's: it
 * hands the app the places on disk of files dropped from Finder or File Explorer, lib/library-ingest
 * listenForAppDrops) answers every drag over the window itself and never passes it on, so a page's dragover
 * and drop never fire there (wry's drag_drop.rs only hands a drag to the page when Tauri's handler declines
 * it, and Tauri's never does). The sidebar's playlists took songs in a browser and never in the app. The
 * pointer is the page's own, so this works the same in both, and files from the computer still go in.
 *
 * A press that slides a few pixels starts it; a chip saying what's going follows the pointer; a target is any
 * element marked `data-drop-playlist` (a playlist's id, or "new"), lit while the pointer is over it (useDragOver);
 * letting go over one hands the music to the window's drop (useDropMusic, mounted once, by the sidebar);
 * letting go anywhere else, or Escape, puts it down. The click a drag ends in never reaches what's under it.
 */

import { useEffect, useRef, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react";
import type { OwnedTrack } from "./types";
import d from "./desk.module.css";

export type DragMusic = { songs: OwnedTrack[] } | { record: string };
type Live = { label: string; x: number; y: number; over: string | null };

let live: Live | null = null;
const subs = new Set<() => void>();
const publish = (v: Live | null) => {
  live = v;
  for (const f of subs) f();
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};

/** True while music is being dragged (the sidebar shows its "New playlist" target then). */
export const useDragging = () => useSyncExternalStore(subscribe, () => live !== null, () => false);
/** True while the drag is held over this target (a playlist's id, or "new"). */
export const useDragOver = (target: string | null) => useSyncExternalStore(subscribe, () => target !== null && live?.over === target, () => false);

let onDrop: ((target: string, music: DragMusic) => void) | null = null;
/** The window's one drop: what happens when music lands on a target. */
export function useDropMusic(drop: (target: string, music: DragMusic) => void) {
  const latest = useRef(drop);
  useEffect(() => {
    latest.current = drop;
  });
  useEffect(() => {
    const f = (target: string, music: DragMusic) => latest.current(target, music);
    onDrop = f;
    return () => {
      if (onDrop === f) onDrop = null;
    };
  }, []);
}

const targetAt = (x: number, y: number): string | null =>
  (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>("[data-drop-playlist]")?.dataset.dropPlaylist ?? null;

// the click a drag ends in would land on whatever is under the pointer; it isn't one
function swallowTheClick() {
  const stop = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener("click", stop, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", stop, true), 0);
}

/**
 * Follow a press as a possible drag of music. `music` is asked once the press has slid far enough to be a drag
 * (null: nothing here can go on a playlist, and nothing happens), `label` then too. `now`: the press has slid
 * already (a song table hands over a press it was watching), so the drag starts at once.
 */
export function dragMusic(e: ReactPointerEvent | PointerEvent, music: () => DragMusic | null, label: () => string, opts: { now?: boolean } = {}) {
  // the main button: pressed now (a press), or held (a move handed over, whose `button` is -1)
  if (e.pointerType === "touch" || (opts.now ? (e.buttons & 1) === 0 : e.button !== 0)) return;
  const x0 = e.clientX;
  const y0 = e.clientY;
  let what: DragMusic | null = null;
  let words = "";
  const begin = (): boolean => {
    what = music();
    if (!what) return false;
    words = label();
    document.documentElement.dataset.dragging = "";
    window.getSelection()?.removeAllRanges();
    return true;
  };
  const at = (x: number, y: number) => publish({ label: words, x, y, over: targetAt(x, y) });
  const move = (ev: PointerEvent) => {
    // let go outside the window, where the page never hears it: the drag is over, nothing dropped
    if ((ev.buttons & 1) === 0) return end();
    if (!what) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      if (!begin()) return end();
    }
    at(ev.clientX, ev.clientY);
  };
  const up = (ev: PointerEvent) => {
    const going: DragMusic | null = what;
    const over = going ? targetAt(ev.clientX, ev.clientY) : null;
    end();
    if (!going) return;
    swallowTheClick();
    if (over) onDrop?.(over, going);
  };
  const key = (ev: KeyboardEvent) => {
    if (ev.key === "Escape" && what) end();
  };
  function end() {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", end);
    window.removeEventListener("keydown", key);
    delete document.documentElement.dataset.dragging;
    publish(null);
  }
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", end);
  window.addEventListener("keydown", key);
  if (opts.now) {
    if (begin()) at(e.clientX, e.clientY);
    else end();
  }
}

/** What's being dragged, beside the pointer. Mounted once, by the window. */
export function DragChip() {
  const l = useSyncExternalStore(subscribe, () => live, () => null);
  if (!l) return null;
  return (
    <div className={d.dragChip} style={{ left: l.x, top: l.y }} data-over={l.over ? "" : undefined} aria-hidden="true">
      {l.label}
    </div>
  );
}

/** A press on songs (a row, the picks it lands on): the ones on this computer go. `now` as dragMusic's. */
export function dragSongs(e: ReactPointerEvent | PointerEvent, take: () => OwnedTrack[], opts: { now?: boolean } = {}) {
  let going: OwnedTrack[] = [];
  dragMusic(
    e,
    () => {
      going = take().filter((x) => x.subsonicTrackId);
      return going.length ? { songs: going } : null;
    },
    () => (going.length === 1 ? going[0].title : `${going.length} songs`),
    opts,
  );
}

/** A press on an album (its tile, its art): the whole album goes, in its order. */
export function dragRecord(e: ReactPointerEvent | PointerEvent, a: { key: string; title: string }) {
  dragMusic(e, () => ({ record: a.key }), () => a.title);
}
