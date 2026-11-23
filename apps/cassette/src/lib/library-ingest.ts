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
import { uploadLibraryFile, triggerLibraryIngest, fetchIngestStatus, fetchLibraryFolders } from "@/lib/library-remote";
import { queueUploads } from "@/lib/library-queue";
import { HUB_IN_REACH } from "@/lib/hub-origin";
import type { IngestAlbum } from "@/lib/library-remote";
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
  /** after the copy, what the computer is doing: reading the new files, looking each song up, saving */
  stage?: "scanning" | "lookingUp" | "saving";
  /** songs the computer will look up in this pass, and how many it has so far */
  lookTotal?: number;
  checked?: number;
  /** the records coming in, with a song each for its cover (hubs from 0.5.51) */
  albums?: IngestAlbum[];
};

const IDLE: IngestState = {
  phase: "idle",
  album: "",
  total: 0,
  uploaded: 0,
  failed: 0,
  identified: 0,
  queued: 0,
  stage: undefined,
  lookTotal: 0,
  checked: 0,
  albums: [],
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

// A folder named only for its format or disc says nothing about the music in it ("MP3", "FLAC", "CD 1").
const FORMAT_WORD = /^(mp3s?|flac|aac|alac|m4a|ogg|opus|wav|aiff?|320k?|v0|v2|(cd|dis[ck]) ?\d+)$/i;

// What an add in the app is called before the computer has read the files: the one thing added, or the
// folder the picked songs share (past a format folder to the one above it). Paths are this computer's, so a
// Windows path splits on its backslashes too (it used to read every Windows add as "N tracks").
function albumFromPaths(paths: string[]): string {
  const parts = paths.map((p) => p.split(/[\\/]/).filter(Boolean));
  if (parts.length === 1) return (parts[0].at(-1) ?? "").replace(/\.[a-z0-9]{2,4}$/i, "") || "your music";
  const parents = new Set(parts.map((x) => x.slice(0, -1).join("/")));
  if (parents.size === 1) {
    const at = parts[0].length - 2;
    const name = parts[0][at];
    if (name && !FORMAT_WORD.test(name)) return name;
    if (name && parts[0][at - 1]) return parts[0][at - 1];
  }
  return "your music";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Watch the computer's own report while it reads the new files and looks each song up, so the card, the
// sidebar and the status note move with it (2026-11-20: "Finding what it is" sat still for minutes). It
// stops when the computer says it's done or failed, when its report hasn't moved for two minutes (an older
// hub says nothing as it goes, a stuck one stops talking), or after half an hour. It used to give up after
// a minute and a half and call a long lookup "Added" while it was still going.
async function pollIdentified(): Promise<void> {
  const started = Date.now();
  let lastAt = "";
  let lastMove = Date.now();
  for (;;) {
    await sleep(1200);
    const ing = await fetchIngestStatus();
    if (ing) {
      // a report from before this add (the last one's "done") says nothing about this one
      const at = ing.at ? Date.parse(ing.at) : NaN;
      const fresh = !Number.isFinite(at) || at >= started - 2000;
      if (fresh) {
        const stage = ing.stage === "scanning" || ing.stage === "lookingUp" || ing.stage === "saving" ? ing.stage : ing.state === "scanning" ? "scanning" : undefined;
        // the counts are this add's own only while the computer is looking songs up (after its first save,
        // and on an older hub at the end, `total` and `identified` are the whole library's again), so they're
        // taken then and kept
        const looking = ing.stage === "lookingUp";
        set({
          ...(looking && typeof ing.identified === "number" ? { identified: ing.identified } : {}),
          ...(stage ? { stage } : {}),
          ...(looking && typeof ing.checked === "number" ? { checked: ing.checked } : {}),
          ...(looking && typeof ing.total === "number" ? { lookTotal: ing.total } : {}),
          ...(Array.isArray(ing.albums) && ing.albums.length ? { albums: ing.albums.slice(0, 8) } : {}),
        });
        if (ing.state === "done" || ing.state === "error") return;
      }
      if (ing.at && ing.at !== lastAt) {
        lastAt = ing.at;
        lastMove = Date.now();
      }
    }
    if (Date.now() - lastMove > 120_000 || Date.now() - started > 30 * 60_000) return;
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
    set({ phase: "noMac", album, total: files.length, uploaded: 0, failed: 0, identified: 0, queued: 0, stage: undefined, checked: 0, lookTotal: 0, albums: [] });
    busy = false;
    scheduleClear(9000);
    return;
  }
  set({ phase: "uploading", album, total: files.length, uploaded: 0, failed: 0, identified: 0, queued: 0, stage: undefined, checked: 0, lookTotal: 0, albums: [] });

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

  set({ phase: "identifying", stage: "scanning", checked: 0, lookTotal: 0 });
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
        "Cassette keeps the music you add in its Cassette folder. Move your files there, or copy them and leave the originals where they are?\n\nCassette remembers your answer. You can change it in Settings. To play a whole library from where it already is, add its folder on your computer's page in Devices.",
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
/** What the app says after every song while an add runs (add_music.rs PROGRESS_EVENT). */
type AddProgress = { done: number; total: number; added: number; already: number; failed: number };
const ADD_PROGRESS_EVENT = "add-music-progress";

/** Files and folders by their place on this computer (a drop on the window, or the picker), moved or copied into
 *  the music folder by the app, then shown on the device card like any other add. Desktop app only. */
export async function addPathsInApp(paths: string[]): Promise<void> {
  const invoke = shell()?.core?.invoke;
  if (!invoke || busy || paths.length === 0) return;
  // Where the Cassette folder is now (it can be moved, board #1163), and the folders Cassette reads where they
  // are, which nothing is ever moved out of. A hub too old to say leaves both to the app's own default.
  const folders = await fetchLibraryFolders();
  if (folders?.move && folders.move.phase !== "error") {
    void tell("The Cassette folder is moving. Add your music when it's done.");
    return;
  }
  if (folders && !folders.cassette.here) {
    void tell("The Cassette folder's drive isn't connected. Connect it and try again.");
    return;
  }
  const mode = await askAddMode(invoke);
  if (!mode || busy) return;
  busy = true;
  if (clearTimer) clearTimeout(clearTimer);
  const album = albumFromPaths(paths);
  set({ phase: "uploading", album, total: paths.length, uploaded: 0, failed: 0, identified: 0, queued: 0, stage: undefined, checked: 0, lookTotal: 0, albums: [] });
  // The app says how far it has got after every song, so the card counts up while the music goes in, not only
  // once it has all gone in.
  let stopListening: (() => void) | null = null;
  const listen = shell()?.event?.listen;
  if (listen) {
    try {
      stopListening = await listen<AddProgress>(ADD_PROGRESS_EVENT, (e) =>
        set({ total: e.payload.total, uploaded: e.payload.done }),
      );
    } catch {
      // no word from the app as it goes: the card fills in when the add ends
    }
  }
  let report: AddReport;
  try {
    report = await invoke<AddReport>("add_music", {
      paths,
      mode,
      ...(folders ? { dest: folders.cassette.path, read: folders.linked.map((f) => f.path) } : {}),
    });
  } catch (e) {
    // a whole add refused before anything moved: no room, no music in it, the music folder itself
    set({ phase: "error" });
    busy = false;
    scheduleClear();
    void tell(typeof e === "string" ? e : "Cassette couldn't add that music.");
    return;
  } finally {
    stopListening?.();
  }
  set({ total: report.added + report.already + report.failed, uploaded: report.added + report.already, failed: report.failed });
  if (report.error) void tell(`Some of it couldn't be added. ${report.error}`);
  if (report.added === 0) {
    set({ phase: report.failed ? "error" : "done" });
    busy = false;
    scheduleClear();
    return;
  }
  set({ phase: "identifying", stage: "scanning", checked: 0, lookTotal: 0 });
  await triggerLibraryIngest();
  await pollIdentified();
  set({ phase: "done" });
  busy = false;
  scheduleClear();
}

/** The app's own folder picker. Null outside the app (no picker there) or when the person cancels. */
export async function pickFolderInApp(title: string): Promise<string | null> {
  const invoke = shell()?.core?.invoke;
  if (!invoke) return null;
  try {
    const picked = await invoke<string[] | string | null>("plugin:dialog|open", {
      options: { title, multiple: false, directory: true },
    });
    const one = Array.isArray(picked) ? picked[0] : picked;
    return typeof one === "string" && one ? one : null;
  } catch {
    return null;
  }
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
