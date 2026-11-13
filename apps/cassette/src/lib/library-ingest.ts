"use client";

/**
 * Shared "add music" ingest store (SPEC This-Mac card, Job 5) — one tiny
 * client-side store that both the window-level drop overlay (LibraryDrop) and the
 * in-card add-music pane (AddMusic) write to and read from, so a drop ANYWHERE
 * surfaces progress ON the device card — never a silent freeze.
 *
 * Audio goes ONLY to the local Cassette Player (library-remote → sidecar), never
 * the cloud. No reachable Player → the dropped files hold in the local outbox
 * (library-queue) and replay when it returns.
 *
 * The store is framework-free (a Set of listeners + a snapshot); components
 * subscribe via useLibraryIngest() / useSyncExternalStore.
 */

import { useSyncExternalStore } from "react";
import { uploadLibraryFile, triggerLibraryIngest, fetchIngestStatus } from "@/lib/library-remote";
import { queueUploads } from "@/lib/library-queue";
import { HUB_IN_REACH } from "@/lib/hub-origin";
import { tell } from "@/lib/ask";

export type IngestPhase =
  | "idle"
  | "uploading"
  | "identifying"
  | "done"
  | "queued"
  | "noMac"
  | "error";

export type IngestState = {
  phase: IngestPhase;
  album: string; // best-guess album name (the dropped folder)
  total: number; // audio files in this drop
  uploaded: number; // files that landed on the Mac
  failed: number; // files the Player rejected
  identified: number; // tracks the sidecar resolved to an MBID (live)
  queued: number; // files held in the offline outbox (no-Mac)
};

const IDLE: IngestState = {
  phase: "idle",
  album: "",
  total: 0,
  uploaded: 0,
  failed: 0,
  identified: 0,
  queued: 0,
};

let state: IngestState = IDLE;
const listeners = new Set<() => void>();
let busy = false;
let clearTimer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  for (const l of listeners) l();
}
function set(patch: Partial<IngestState>) {
  state = { ...state, ...patch };
  emit();
}
function scheduleClear(ms = 6000) {
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    state = IDLE;
    emit();
  }, ms);
}

export function subscribeIngest(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export function getIngestSnapshot(): IngestState {
  return state;
}

/** React binding — re-renders on every ingest state change. */
export function useLibraryIngest(): IngestState {
  return useSyncExternalStore(subscribeIngest, getIngestSnapshot, () => IDLE);
}

// The dropped folder is the album name — the common top-level path segment, with
// the audio extension stripped for a lone file. Falls back to a track count.
function albumFromFiles(files: { relPath: string }[]): string {
  const tops = new Set(files.map((f) => f.relPath.split("/")[0] ?? f.relPath));
  if (tops.size === 1) {
    const only = [...tops][0] ?? "";
    return only.replace(/\.(flac|mp3)$/i, "") || "music";
  }
  return `${files.length} tracks`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Poll the sidecar's ingest progress so the card shows a live "M identified"
// climbing, and resolves when the pass reports done. Bounded; degrades to a
// working spinner if the sidecar doesn't expose progress.
async function pollIdentified(): Promise<void> {
  const deadline = Date.now() + 90_000;
  for (;;) {
    await sleep(1500);
    const ing = await fetchIngestStatus();
    if (ing) {
      if (typeof ing.identified === "number") set({ identified: ing.identified });
      if (ing.state === "done" || ing.state === "error") return;
    }
    if (Date.now() > deadline) return;
  }
}

/**
 * Stream a dropped batch to the Player and surface progress. One run at a time
 * (overlapping drops are ignored while busy). Files are {relPath, file} already
 * collected (folder structure preserved in relPath).
 */
export async function startIngest(files: { relPath: string; file: File }[]): Promise<void> {
  if (busy || files.length === 0) return;
  busy = true;
  if (clearTimer) clearTimeout(clearTimer);

  const album = albumFromFiles(files);
  // The website in a regular browser never reaches a hub (lib/hub-origin), so nothing would ever replay
  // an outbox: music goes in through the app, and nothing is held here.
  if (!HUB_IN_REACH) {
    set({ phase: "noMac", album, total: files.length, uploaded: 0, failed: 0, identified: 0, queued: 0 });
    busy = false;
    scheduleClear(9000);
    return;
  }
  set({ phase: "uploading", album, total: files.length, uploaded: 0, failed: 0, identified: 0, queued: 0 });

  let uploaded = 0;
  let failed = 0;
  for (let i = 0; i < files.length; i++) {
    const { relPath, file } = files[i]!;
    const r = await uploadLibraryFile(relPath, file);
    if (!r.reachable) {
      // No Player → hold the remaining files in the local outbox for replay.
      const { queued } = await queueUploads(files.slice(i));
      set({ phase: queued > 0 ? "queued" : "noMac", queued });
      busy = false;
      scheduleClear(9000);
      return;
    }
    if (r.ok) uploaded++;
    else failed++;
    set({ uploaded, failed });
  }

  if (uploaded === 0) {
    set({ phase: "error" });
    busy = false;
    scheduleClear();
    return;
  }

  set({ phase: "identifying" });
  await triggerLibraryIngest();
  await pollIdentified();
  set({ phase: "done" });
  busy = false;
  scheduleClear();
}

// ─── Adding music in the desktop app: the app moves or copies it ───────────────
//
// A web page only ever sees a dropped file's bytes, so in a browser music is uploaded, a copy. The desktop app
// knows where each file lives, and its shell does the file work itself (add_music.rs): the founder prefers music
// moved, not copied (2026-11-06), so the first time anyone adds music the app asks which, and remembers.

type ShellInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
type ShellListen = <T>(event: string, cb: (e: { payload: T }) => void) => Promise<() => void>;
const shell = () =>
  (globalThis as { __TAURI__?: { core?: { invoke?: ShellInvoke }; event?: { listen?: ShellListen } } }).__TAURI__;

export type AddMode = "move" | "copy";
const ADD_MODE_KEY = "cs-add-music";

/** The person's answer to Move or Copy, or null before they've given one. */
export function savedAddMode(): AddMode | null {
  try {
    const v = localStorage.getItem(ADD_MODE_KEY);
    return v === "move" || v === "copy" ? v : null;
  } catch {
    return null;
  }
}

export function saveAddMode(mode: AddMode): void {
  try {
    localStorage.setItem(ADD_MODE_KEY, mode);
  } catch {
    // nowhere to keep it: the question comes back next time
  }
}

/** Move or Copy, asked the first time in the Mac's own alert, the answer kept from then on. Null: Cancel. */
async function askAddMode(invoke: ShellInvoke): Promise<AddMode | null> {
  const saved = savedAddMode();
  if (saved) return saved;
  try {
    const answer = await invoke<string>("plugin:dialog|message", {
      title: "Add music",
      message:
        "Cassette keeps your music in the Cassette folder inside Music. Move your files there, or copy them and leave the originals where they are?\n\nCassette remembers your answer. You can change it in Settings.",
      kind: "info",
      buttons: { YesNoCancelCustom: ["Move", "Copy", "Cancel"] },
    });
    const mode: AddMode | null = answer === "Move" ? "move" : answer === "Copy" ? "copy" : null;
    if (mode) saveAddMode(mode);
    return mode;
  } catch {
    return null;
  }
}

type AddReport = { added: number; already: number; failed: number; error: string | null };

/** Files and folders by their place on this computer (a drop on the window, or the picker), moved or copied into
 *  the music folder by the app, then shown on the device card like any other add. Desktop app only. */
export async function addPathsInApp(paths: string[]): Promise<void> {
  const invoke = shell()?.core?.invoke;
  if (!invoke || busy || paths.length === 0) return;
  const mode = await askAddMode(invoke);
  if (!mode || busy) return;
  busy = true;
  if (clearTimer) clearTimeout(clearTimer);
  const album = albumFromFiles(paths.map((p) => ({ relPath: p.split("/").filter(Boolean).pop() ?? p })));
  set({ phase: "uploading", album, total: paths.length, uploaded: 0, failed: 0, identified: 0, queued: 0 });
  let report: AddReport;
  try {
    report = await invoke<AddReport>("add_music", { paths, mode });
  } catch (e) {
    // a whole add refused before anything moved: no room, no music in it, the music folder itself
    set({ phase: "error" });
    busy = false;
    scheduleClear();
    void tell(typeof e === "string" ? e : "Cassette couldn't add that music.");
    return;
  }
  set({ total: report.added + report.already + report.failed, uploaded: report.added + report.already, failed: report.failed });
  if (report.error) void tell(`Some of it couldn't be added. ${report.error}`);
  if (report.added === 0) {
    set({ phase: report.failed ? "error" : "done" });
    busy = false;
    scheduleClear();
    return;
  }
  set({ phase: "identifying" });
  await triggerLibraryIngest();
  await pollIdentified();
  set({ phase: "done" });
  busy = false;
  scheduleClear();
}

const AUDIO_EXTENSIONS = ["flac", "mp3", "m4a", "aac", "alac", "wav", "aif", "aiff", "ogg", "oga", "opus", "wma", "ape", "wv", "dsf", "dff"];

/** The app's own file picker (File > Add to Library…, the Devices page's Choose…), whose picks the app can move.
 *  False outside the app, where the caller opens its own file input instead. */
export function pickMusicInApp(): boolean {
  const invoke = shell()?.core?.invoke;
  if (!invoke) return false;
  void invoke<string[] | string | null>("plugin:dialog|open", {
    options: { title: "Add to Library", multiple: true, directory: false, filters: [{ name: "Music", extensions: AUDIO_EXTENSIONS }] },
  })
    .then((picked) => {
      const paths = picked == null ? [] : Array.isArray(picked) ? picked : [picked];
      if (paths.length) void addPathsInApp(paths);
    })
    .catch(() => {});
  return true;
}

/** Inside the app the window's drops come to the app, never to the page (Tauri takes them, with their places on
 *  disk): listen for them there. `dragging` drives the drop overlay. Returns the unlisten, or null outside the app. */
export function listenForAppDrops(dragging: (on: boolean) => void): (() => void) | null {
  const listen = shell()?.event?.listen;
  if (!listen) return null;
  const offs = [
    listen<{ paths?: string[] }>("tauri://drag-enter", (e) => dragging((e.payload.paths?.length ?? 0) > 0)),
    listen("tauri://drag-leave", () => dragging(false)),
    listen<{ paths?: string[] }>("tauri://drag-drop", (e) => {
      dragging(false);
      if (e.payload.paths?.length) void addPathsInApp(e.payload.paths);
    }),
  ];
  return () => {
    for (const off of offs) void off.then((f) => f()).catch(() => {});
  };
}

// ─── Collecting dropped / picked files (shared by the overlay + the pane) ──────

const AUDIO_RE = /\.(flac|mp3)$/i;
type Collected = { relPath: string; file: File };

// Recursively walk a dropped FileSystemEntry, preserving relative paths so an
// album lands as Album/track.flac. webkitGetAsEntry / FileSystemEntry are
// non-standard → typed as any.
async function walkEntry(entry: any, prefix: string, out: Collected[]): Promise<void> {
  if (!entry) return;
  if (entry.isFile) {
    const file: File = await new Promise((res, rej) => entry.file(res, rej));
    out.push({ relPath: prefix ? `${prefix}/${entry.name}` : entry.name, file });
    return;
  }
  if (entry.isDirectory) {
    const dirPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
    const reader = entry.createReader();
    for (;;) {
      const batch: any[] = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) await walkEntry(e, dirPrefix, out);
    }
  }
}

/** Collect audio files from a drop (folder structure preserved), or null-safe empty. */
export async function collectDropFiles(dt: DataTransfer | null): Promise<Collected[]> {
  const items = Array.from(dt?.items ?? []);
  const out: Collected[] = [];
  for (const it of items) {
    const entry = (it as unknown as { webkitGetAsEntry?: () => unknown }).webkitGetAsEntry?.();
    if (entry) {
      await walkEntry(entry, "", out);
    } else {
      const f = it.getAsFile?.();
      if (f) out.push({ relPath: f.name, file: f });
    }
  }
  return out.filter((c) => AUDIO_RE.test(c.relPath));
}

/** Collect audio files from a <input type="file"> (browse fallback). */
export function collectInputFiles(list: FileList | null): Collected[] {
  return Array.from(list ?? [])
    .map((file) => ({
      relPath: (file as unknown as { webkitRelativePath?: string }).webkitRelativePath || file.name,
      file,
    }))
    .filter((c) => AUDIO_RE.test(c.relPath));
}
