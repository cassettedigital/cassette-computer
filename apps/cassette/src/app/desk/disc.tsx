"use client";

/**
 * The disc in the drive, in the desktop app (the founder, 2026-10-31: putting in a CD is deliberate, so
 * the app meets it at the top, not on Devices). Three parts:
 *
 *   DiscProvider  the drive's status for the whole window (the hub's own poll, lib/rip-status: 4s, 2.5s
 *                 on the disc's page, nothing while the window is hidden), the disc's cover, and the
 *                 three things done to it here: rip, stop, eject. "Done" says so once, in a toast. It
 *                 remembers what the hub doesn't send again: that this disc was surely identified (no
 *                 confidence comes with a rip or after a Stop), and the disc itself while the hub reads it
 *                 again at the start of every rip.
 *   DiscRow       one row at the sidebar's foot while a disc is in: its cover (it confirms the match), its
 *                 name, Rip and Eject in fixed seats (iTunes kept eject beside the disc). Ripping, the cover
 *                 softens under a ring that fills. The rest is in its right-click menu; the name opens the page.
 *   DiscPage      the disc's page: one page for a disc in every state (design wave 1c, board #1201), planned
 *                 in disc/disc.states.ts and drawn by disc/DiscView.tsx. The head holds still; choosing, naming and
 *                 errors fill the body under it.
 *
 * Nothing rips without a click (CLAUDE.md). Rip here is only offered for a disc identified with
 * confidence, where the hub's /api/rip/start lands on the same identity; anything less (a guess, an
 * unknown disc, an error, a part-read disc) puts the drive panel's own choosing and naming steps under the head.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Glyph, ICON, useContextMenu, type MenuItem } from "@discovery/cassette-kit";
import { useShell } from "@/app/dashboard/_shell/shell-context";
import { POLL_MS, postSidecar, resolveDiscCover, ripDoneCount, useRipStatus, type Reachability, type RipStatus } from "@/lib/rip-status";
import { CdDrivePanel } from "@/app/dashboard/devices/CdDrivePanel";
import { Art } from "./Art";
import { useDesk } from "./DeskShell";
import { useOwned } from "./owned";
import { useTint } from "./Player";
import { rereadLibrary } from "./songs";
import { DESK, deskAlbum, type DeskAlbum } from "./types";
import { discLook, discName, discSongs, isReading, SURE } from "./disc/look";
import { DiscView } from "./disc/DiscView";
import d from "./desk.module.css";

/** Away from the disc's page the drive is asked a little less often. */
const ROW_POLL_MS = 4000;
/** How long the window holds the disc through the hub's re-read after Rip is pressed, at most. */
const PRESSED_MS = 20000;

const MOVING: RipStatus["state"][] = ["ripping", "registering"];
const SHOWS: RipStatus["state"][] = ["detecting", "matched", "confirm", "ripping", "registering", "done", "incomplete", "error"];

type Disc = {
  status: RipStatus | null;
  reachability: Reachability;
  /** a disc to show (in the drive, or a rip that still has something to say) */
  shown: boolean;
  cover: string | null;
  /** identified surely enough to rip in one press */
  sure: boolean;
  /** this disc was identified surely before; the hub doesn't send its confidence again while it rips or after a Stop */
  sureBefore: boolean;
  /** Rip was pressed and the hub is reading the disc again before it starts */
  pressed: boolean;
  /** the disc as it was last known, drawn through that re-read */
  held: RipStatus | null;
  moving: boolean;
  busy: boolean;
  rip: () => void;
  stop: () => void;
  eject: () => void;
};

const DiscCtx = createContext<Disc | null>(null);
export function useDisc(): Disc {
  const v = useContext(DiscCtx);
  if (!v) throw new Error("useDisc outside DiscProvider");
  return v;
}

/** One physical disc, as far as the hub's status names it. */
const discKey = (s: RipStatus | null) => (s ? s.discId || s.releaseMbid || (s.album ? `${s.album}|${s.albumArtist ?? ""}` : null) : null);

export function DiscProvider({ children }: { children: ReactNode }) {
  const onPage = usePathname()?.startsWith(`${DESK}/disc`) ?? false;
  const { status, reachability } = useRipStatus(onPage ? POLL_MS : ROW_POLL_MS);
  const { showToast } = useShell();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [cover, setCover] = useState<string | null>(null);
  const [pressed, setPressed] = useState(false);

  // what the hub doesn't say twice: a sure match, and the disc it re-reads after Rip
  const sureKey = useRef<string | null>(null);
  const held = useRef<RipStatus | null>(null);
  const key = discKey(status);
  if (status && status.state === "matched" && !status.unidentified && (status.confidence ?? 0) >= SURE) sureKey.current = key;
  if (status && !status.discPresent && status.state === "idle") sureKey.current = null;
  if (status?.album && !pressed) held.current = status;
  const sureBefore = !!key && key === sureKey.current;

  // the cover, once per disc (cached by lib/rip-status); kept while the hub reads the disc again
  const releaseMbid = status?.releaseMbid;
  const album = status?.album;
  const artist = status?.albumArtist;
  useEffect(() => {
    if (!releaseMbid && !album) {
      if (!pressed) setCover(null);
      return;
    }
    let gone = false;
    void resolveDiscCover(releaseMbid || `${album}|${artist ?? ""}`, { releaseMbid, album, artist }).then((url) => !gone && setCover(url));
    return () => {
      gone = true;
    };
  }, [releaseMbid, album, artist, pressed]);

  // the press is over once the hub has moved on from reading: it rips, asks which release, or can't
  useEffect(() => {
    if (!pressed) return;
    const st = status?.state;
    if (!status?.discPresent || (st && !["detecting", "matched", "idle"].includes(st))) setPressed(false);
    const t = setTimeout(() => setPressed(false), PRESSED_MS);
    return () => clearTimeout(t);
  }, [pressed, status?.state, status?.discPresent]);

  // "done" said once, when this window saw the rip finish. The hub has put the record in the library
  // and told the cloud before it says done, so the window reads its library again then and the record
  // is on the shelf (BUG-760); a rip that landed only some songs ("incomplete") brought those in too.
  const was = useRef<RipStatus["state"] | null>(null);
  useEffect(() => {
    const now = status?.state ?? null;
    const finished = !!was.current && MOVING.includes(was.current) && (now === "done" || now === "incomplete");
    if (finished && now === "done") showToast(`${status?.album ?? "The disc"} is in your library`);
    if (finished) rereadLibrary(router);
    was.current = now;
  }, [status?.state, status?.album, showToast, router]);

  const act = useCallback(
    async (path: string, fail: string) => {
      setBusy(true);
      const r = await postSidecar(path);
      setBusy(false);
      if (!r.ok) setPressed(false);
      if (r.status === 409 && r.body.alreadyRipping) showToast("A disc is already ripping.", { variant: "error" });
      else if (r.status === 409 && path.endsWith("eject")) showToast("It can't come out while it's ripping.", { variant: "error" });
      else if (!r.ok) showToast(fail, { variant: "error" });
    },
    [showToast],
  );

  const value = useMemo<Disc>(() => {
    const st = status?.state;
    const shown = reachability === "online" && !!status && status.drivePresent !== false && (status.discPresent || (!!st && SHOWS.includes(st)));
    return {
      status,
      reachability,
      shown,
      cover,
      sure: st === "matched" && !status?.unidentified && ((status?.confidence ?? 0) >= SURE || sureBefore),
      sureBefore,
      pressed,
      held: held.current,
      moving: !!st && MOVING.includes(st),
      busy,
      rip: () => {
        setPressed(true);
        void act("/api/rip/start", "Couldn't start the rip. Try again in a moment.");
      },
      stop: () => void act("/api/rip/stop", "Couldn't stop the rip."),
      eject: () => void act("/api/rip/eject", "Couldn't eject the disc."),
    };
  }, [status, reachability, cover, sureBefore, pressed, busy, act]);

  return <DiscCtx.Provider value={value}>{children}</DiscCtx.Provider>;
}

/** The sidebar row's one quiet line, by state. */
function rowLine(s: RipStatus, sure: boolean): string {
  const total = s.trackCount ?? s.tracks?.length ?? 0;
  const done = ripDoneCount(s);
  switch (s.state) {
    case "ripping":
      return `Ripping ${done}/${total || "?"}`;
    case "registering":
      return "Adding to your library";
    case "done":
      return "In your library";
    case "incomplete":
      return `${done} of ${total} ripped`;
    case "error":
      return "Couldn't read it";
    case "matched":
      if (!sure) return "Which release is this?";
      return s.alreadyInLibrary ? "In your library" : (s.albumArtist ?? "");
    case "confirm":
      return "Which release is this?";
    default:
      return "Reading…";
  }
}

/** Still reading: nothing known about the disc yet (the drive spinning up, the lookup on its way). */
export const reading = isReading;

/** The cover; with none yet, the disc itself, turning while it's being read (2026-10-31: the drawn
    "Audio CD" placeholder read as broken). */
export function DiscArt({ cover, sizes, spin }: { cover: string | null; sizes: string; spin?: boolean }) {
  return cover ? <Art src={cover} sizes={sizes} /> : <span className={d.discBare} data-spin={spin || undefined} aria-hidden="true" />;
}

/**
 * The sidebar's row, at the sidebar's foot (the "Holding still" rules: a disc gets a fixed seat, so the library
 * list never moves as one goes in or comes out). Inside, Rip and Eject keep their seats in every state, dimmed
 * where they sit when they can't be used, so the name's room never changes. Both are round icon keys (the page's
 * Rip glyph, then Eject), so holding the seats costs the name no room (the navigator, wave 1c).
 */
export function DiscRow({ slim }: { slim: boolean }) {
  const disc = useDisc();
  const router = useRouter();
  const cm = useContextMenu();
  const onPage = usePathname()?.startsWith(`${DESK}/disc`) ?? false;
  if (!disc.shown || !disc.status) return null;
  const s = disc.status;
  const name = isReading(s) && !s.album ? "Audio CD" : discName(s);
  const line = rowLine(s, disc.sure);
  const open = () => router.push(`${DESK}/disc`);
  const canRip = disc.sure && !disc.moving && !disc.pressed;
  const canEject = s.discPresent && !disc.moving && s.state !== "detecting" && !disc.pressed;
  const total = s.trackCount ?? s.tracks?.length ?? 0;
  const pct = total ? Math.round((ripDoneCount(s) / total) * 100) : 0;
  const menu: MenuItem[] = [
    { label: s.alreadyInLibrary ? "Rip Again" : "Rip to Library", onSelect: disc.rip, disabled: disc.busy || !canRip },
    { label: "Stop Ripping", onSelect: disc.stop, disabled: disc.busy || !disc.moving },
    { label: "Show Tracks", onSelect: open },
    { label: "Not This Album…", onSelect: () => router.push(`${DESK}/disc?choose=1`), disabled: !(s.state === "matched" || s.state === "confirm") || disc.moving },
    "separator",
    { label: "Eject", onSelect: disc.eject, disabled: disc.busy || !canEject },
  ];
  return (
    <div className={d.discRow} data-on={onPage || undefined} data-moving={disc.moving || undefined} onContextMenu={(e: MouseEvent) => cm.open(e, menu)}>
      <button type="button" className={d.discThumb} onClick={open} aria-label={`${name}: ${line}`} title={slim ? `${name}: ${line}` : undefined}>
        <DiscArt cover={disc.cover} sizes="40px" spin={isReading(s) && !disc.pressed} />
        {disc.moving && <span className={d.discRing} style={{ "--done": `${pct}%` } as CSSProperties} aria-hidden="true" />}
      </button>
      {!slim && (
        <>
          <button type="button" className={d.discWords} onClick={open}>
            <span className={d.discName}>{name}</span>
            <span className={d.discLine}>
              {s.state === "done" && <Glyph name="check" size={11} />}
              {line}
            </span>
          </button>
          <button type="button" className={d.discRip} onClick={disc.rip} disabled={disc.busy || !canRip || !!s.alreadyInLibrary} aria-label="Rip to Library" title="Rip to Library">
            <Glyph name="album" size={ICON.small} />
          </button>
          <button type="button" className={d.discEject} onClick={disc.eject} disabled={disc.busy || !canEject} aria-label="Eject" title="Eject">
            <Glyph name="eject" size={ICON.small} />
          </button>
        </>
      )}
      {cm.menu}
    </div>
  );
}

const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The disc that was last on this page: what it was, so an eject can say where it went. */
type LastDisc = { name: string; cover: string | null; mine: DeskAlbum | null };

/**
 * The drive with nothing in it (the founder, 2026-11-07: the empty state after an eject was "rough"): the
 * page's middle, calm. Just after an eject, the album's sleeve with its CD slid out beside it, its name
 * "is out", and the way to it in your library when it's there; otherwise a CD resting, and one line.
 * Held as it is: empty states wait on the founder's round (the open call empty.styles).
 */
function NoDisc({ last, head, answer, line }: { last: LastDisc | null; head: string; answer: string; line: string }) {
  return (
    <div className={d.page}>
      <h1 className={d.srOnly}>Disc</h1>
      <div className={d.noDisc}>
        <span className={d.noDiscArt} data-sleeve={last ? "" : undefined} aria-hidden="true">
          <span className={d.noDiscCd}>
            <span className={d.discCd} />
          </span>
          {last && (
            <span className={d.noDiscSleeve}>
              <DiscArt cover={last.cover} sizes="176px" />
            </span>
          )}
        </span>
        <p className={d.noDiscHead}>
          <span className={d.noDiscShout}>{last ? last.name : head}</span> <span className={d.noDiscAnswer}>{last ? "is out" : answer}</span>
        </p>
        <p className={d.noDiscLine}>{line}</p>
        {last?.mine && (
          <p className={d.discNot}>
            <Link href={deskAlbum(last.mine)}>Open it in your library</Link>
          </p>
        )}
      </div>
    </div>
  );
}

/** The disc's page: one page for a disc in every state, the album it is about to become with the CD in its sleeve. */
export function DiscPage({ choose }: { choose: boolean }) {
  const disc = useDisc();
  const { shelf } = useDesk();
  const owned = useOwned();
  const router = useRouter();
  const tint = useTint(disc.cover);
  const s = disc.status;
  const known = disc.pressed && disc.held ? disc.held : s;
  const name = known ? discName(known) : "";
  const mine = known && known.album ? (shelf.find((a) => norm(a.title) === norm(name) && (!known.albumArtist || norm(a.artist) === norm(known.albumArtist))) ?? null) : null;
  // what was on the page, kept while it stays open, so an eject reads as the disc leaving, not a blank
  const last = useRef<LastDisc | null>(null);
  if (disc.shown && known && !(isReading(known) && !known.album)) last.current = { name, cover: disc.cover, mine };

  // "Not this album?" is a state of the page, not an address to stay on: once the disc moves on, it goes
  const choosing = choose && !!s && (s.state === "matched" || s.state === "confirm") && !disc.pressed;
  useEffect(() => {
    if (choose && !choosing && s && s.state !== "idle") router.replace(`${DESK}/disc`);
  }, [choose, choosing, s, router]);

  if (disc.reachability !== "online" || !s) {
    return <NoDisc last={null} head="The CD drive" answer={disc.reachability === "offline" ? "reconnecting" : "one moment"} line={disc.reachability === "offline" ? "Reconnecting to the CD drive…" : "Checking the CD drive…"} />;
  }
  if (!disc.shown) {
    if (s.drivePresent === false) return <NoDisc last={null} head="No CD drive" answer="plugged in" line="Plug one in and it shows up here." />;
    return <NoDisc last={last.current} head="No disc" answer="in the drive" line={last.current ? "Put another CD in and it opens here." : "Put a CD in and it opens here, ready to rip."} />;
  }

  const look = discLook(s, { sureBefore: disc.sureBefore, pressed: disc.pressed, choose: choosing, onShelf: !!mine && (s.state === "done" || s.state === "incomplete") }, disc.held);
  return (
    <DiscView
      look={look}
      songs={discSongs(known ?? s)}
      cover={disc.cover ? <Art src={disc.cover} sizes="240px" priority /> : <span className={d.discBare} aria-hidden="true" />}
      tint={tint}
      acts={{
        rip: disc.rip,
        stop: disc.stop,
        eject: disc.eject,
        play: () => mine && void owned.playRecord(mine.key),
        busy: disc.busy,
        chooseHref: `${DESK}/disc?choose=1`,
        recordHref: mine ? deskAlbum(mine) : undefined,
      }}
      steps={<CdDrivePanel connected under onBack={() => router.replace(`${DESK}/disc`)} />}
    />
  );
}
