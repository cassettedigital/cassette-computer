"use client";

/**
 * Where the music lives (board #1163, the founder 2026-11-23). One block, the same on the app's Devices screen
 * (the computer at the middle of the rings) and the website's device page:
 *
 *   - the Cassette folder: where music you add and discs you rip land, the only folder Cassette writes into,
 *     with Show, Move… and Check for new music;
 *   - folders Cassette reads where they are (a big library, an external drive, a NAS), with Add a folder and
 *     Stop reading. Cassette never changes anything in one, and a folder whose drive is unplugged or asleep
 *     shows as away: nothing in it leaves the library meanwhile.
 *
 * Choosing a folder needs the app's own picker, so Add and Move show only in the desktop app. Everything talks
 * to this computer's hub (lib/library-remote). A hub older than this feature answers nothing, and then only the
 * plain folder line and Check for new music show.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Folder, HardDrive, Server } from "lucide-react";
import { Key } from "@discovery/cassette-kit";
import {
  addReadFolder,
  fetchLibraryFolders,
  fetchLibraryInfo,
  moveMusicFolder,
  removeReadFolder,
  revealLibrary,
  type HubFolder,
  type LibraryFolders,
} from "@/lib/library-remote";
import { pickFolderInApp } from "@/lib/library-ingest";
import { useCheckForNewMusic } from "@/lib/check-new-music";
import { askToConfirm, tell } from "@/lib/ask";
import { inDesktopApp } from "@/lib/open-outside";
import { computerWordsForUserAgent, type ComputerWords } from "@/lib/computer-words";
import s from "./MusicFolders.module.css";

type Notify = (message: string, opts?: { variant?: "error" }) => void;

function prettyPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}

function folderName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

function FolderIcon({ f }: { f: HubFolder }) {
  // a network drive, a drive of its own (a Mac's /Volumes, any Windows letter but C:), or a folder
  const own = /^\/Volumes\//.test(f.path) || (/^[A-Za-z]:\\/.test(f.path) && !/^[Cc]:\\/.test(f.path));
  const Icon = f.network ? Server : own ? HardDrive : Folder;
  return <Icon size={14} strokeWidth={1.75} aria-hidden="true" />;
}

/** `reveal={false}` where the page already has its own button for the folder (the app's computer panel). */
export function MusicFolders({
  notify,
  computer,
  onMoved,
  reveal = true,
}: {
  notify: Notify;
  computer?: ComputerWords;
  onMoved?: () => void;
  reveal?: boolean;
}) {
  const [folders, setFolders] = useState<LibraryFolders | null>(null);
  // a hub too old to list its folders still says where its one folder is
  const [plainDir, setPlainDir] = useState<string | null>(null);
  const [inApp, setInApp] = useState(false);
  const [words, setWords] = useState<ComputerWords | null>(computer ?? null);
  const [working, setWorking] = useState(false);
  const [moving, setMoving] = useState(false);
  const check = useCheckForNewMusic(notify);
  const movingRef = useRef(false);

  const load = useCallback(async () => {
    const f = await fetchLibraryFolders();
    setFolders(f);
    if (!f) setPlainDir((await fetchLibraryInfo())?.musicDir ?? null);
    const now = !!f?.move && f.move.phase !== "error";
    // after a move the hub starts again over the new folder: keep looking until it answers without a move
    if (movingRef.current && !now && f) {
      movingRef.current = false;
      setMoving(false);
      onMoved?.();
    } else if (now) {
      movingRef.current = true;
      setMoving(true);
    }
  }, [onMoved]);

  useEffect(() => {
    setInApp(inDesktopApp());
    if (!computer) setWords(computerWordsForUserAgent(navigator.userAgent));
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load, computer]);

  useEffect(() => {
    if (!moving) return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [moving, load]);

  const onAdd = useCallback(async () => {
    const path = await pickFolderInApp("Choose a folder of music to play where it is");
    if (!path) return;
    setWorking(true);
    const r = await addReadFolder(path);
    setWorking(false);
    if (!r.ok) {
      void tell(r.error ?? "Cassette couldn't read that folder.");
      return;
    }
    notify(`Reading ${folderName(path)}. Its music shows up as it's found.`);
    void load();
  }, [load, notify]);

  const onRemove = useCallback(
    async (f: HubFolder) => {
      const yes = await askToConfirm(
        `Stop reading ${folderName(f.path)}?\n\nIts songs leave your library and your phones. The files stay exactly where they are.`,
        { ok: "Stop reading" },
      );
      if (!yes) return;
      setWorking(true);
      const r = await removeReadFolder(f.path);
      setWorking(false);
      if (!r.ok) void tell(r.error ?? "Cassette couldn't do that.");
      void load();
    },
    [load],
  );

  const onMove = useCallback(async () => {
    const path = await pickFolderInApp("Choose where the Cassette folder goes");
    if (!path) return;
    const yes = await askToConfirm(
      `Move the Cassette folder to ${prettyPath(path)}?\n\nMusic you add and discs you rip go there from now on. If it's another drive, Cassette copies everything first and leaves your old folder where it is, for you to put away once you've checked.`,
      { ok: "Move" },
    );
    if (!yes) return;
    const r = await moveMusicFolder(path);
    if (!r.ok) {
      void tell(r.error ?? "Cassette couldn't move the folder.");
      return;
    }
    movingRef.current = true;
    setMoving(true);
    void load();
  }, [load]);

  const cassette = folders?.cassette ?? (plainDir ? { path: plainDir, here: true } : null);
  if (!cassette) return null;
  const move = folders?.move;
  const linked = folders?.linked ?? [];
  const pct = move && move.totalBytes > 0 ? Math.min(99, Math.floor((move.doneBytes / move.totalBytes) * 100)) : null;
  const busy = working || moving || check.checking;

  const note =
    move?.phase === "error"
      ? `The move stopped: ${move.error} Your music is still in the old folder.`
      : move || moving
        ? `Moving to ${prettyPath(move?.to ?? "the new place")}${move?.phase === "switching" || !move ? ", starting again over it…" : pct !== null ? `, ${pct}%…` : "…"}`
        : !cassette.here
          ? "The Cassette folder's drive isn't connected. Nothing leaves your library meanwhile."
          : folders?.movedFrom
            ? `Your old Cassette folder is still at ${prettyPath(folders.movedFrom)}. Once your music plays from its new place, you can put it in the Trash.`
            : null;

  return (
    <div className={s.block}>
      <div className={s.row}>
        <div className={s.path} title={cassette.path}>
          <FolderIcon f={cassette} />
          <span>
            {prettyPath(cassette.path)}
            {!cassette.here && <span className={s.away}> · away</span>}
          </span>
        </div>
        <div className={s.keys}>
          <Key onClick={() => void check.run()} disabled={busy}>
            {check.checking ? "Checking…" : "Check for new music"}
          </Key>
          {reveal && cassette.here && (
            <Key tone="plain" onClick={() => void revealLibrary()}>
              {words?.reveal ?? "Show folder"}
            </Key>
          )}
          {inApp && folders && cassette.here && !move && (
            <Key tone="plain" onClick={() => void onMove()} disabled={busy}>
              Move…
            </Key>
          )}
        </div>
      </div>
      {note && <p className={s.note}>{note}</p>}

      {folders && (
        <div className={s.read}>
          <div className={s.head}>Folders Cassette reads</div>
          {linked.length === 0 ? (
            <p className={s.note}>Play a library from where it already is, on this computer, a drive or a NAS. Cassette never changes anything in it.</p>
          ) : (
            linked.map((f) => (
              <div key={f.path} className={s.row}>
                <div className={s.path} title={f.path}>
                  <FolderIcon f={f} />
                  <span>
                    {prettyPath(f.path)}
                    {!f.here && <span className={s.away}> · away</span>}
                  </span>
                </div>
                <div className={s.keys}>
                  <Key tone="plain" onClick={() => void onRemove(f)} disabled={busy}>
                    Stop reading
                  </Key>
                </div>
              </div>
            ))
          )}
          {inApp && (
            <div className={s.keys}>
              <Key onClick={() => void onAdd()} disabled={busy}>
                {working ? "Reading…" : "Add a folder"}
              </Key>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
