"use client";

/**
 * The disc in the drive, in the desktop app (the founder, 2026-10-31: putting in a CD is deliberate, so
 * the app meets it at the top, not on Devices). Three parts:
 *
 *   DiscProvider  the drive's status for the whole window (the hub's own poll, lib/rip-status: 4s, 2.5s
 *                 on the disc's page, nothing while the window is hidden), the disc's cover, and the
 *                 three things done to it here: rip, stop, eject. "Done" says so once, in a toast.
 *   DiscRow       one sidebar row while a disc is in: its cover (it confirms the match), its name, Rip
 *                 and Eject (iTunes kept eject beside the disc). Ripping, the cover softens under a ring
 *                 that fills. The rest is in its right-click menu; the name opens the disc's page.
 *   DiscPage      the disc's page, drawn as the album it is about to become (the kit's Hero), with the
 *                 CD tucked in its sleeve, turning slowly while it copies, ringed by one segment per song.
 *
 * Nothing rips without a click (CLAUDE.md). Rip here is only offered for a disc identified with
 * confidence, where the hub's /api/rip/start lands on the same identity; anything less (a guess, an
 * unknown disc, an error, a part-read disc) opens the drive panel's own choosing and naming steps.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Glyph, Hero, Pill, Pills, PlayPill, useContextMenu, type MenuItem } from "@discovery/cassette-kit";
import { useShell } from "@/app/dashboard/_shell/shell-context";
import { POLL_MS, postSidecar, resolveDiscCover, ripDoneCount, useRipStatus, type Reachability, type RipStatus, type TrackState, type TrackStatus } from "@/lib/rip-status";
import { CdDrivePanel } from "@/app/dashboard/devices/CdDrivePanel";
import { Art } from "./Art";
import { useDesk } from "./DeskShell";
import { useOwned } from "./owned";
import { useTint } from "./Player";
import { rereadLibrary } from "./songs";
import { PageHead, songs } from "./Shelves";
import { DESK, deskAlbum, type DeskAlbum } from "./types";
import d from "./desk.module.css";

/** The drive panel's own line for a sure identification (CdDrivePanel CONFIDENT_THRESHOLD). */
const SURE = 0.8;
/** Away from the disc's page the drive is asked a little less often. */
const ROW_POLL_MS = 4000;

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

export function DiscProvider({ children }: { children: ReactNode }) {
  const onPage = usePathname()?.startsWith(`${DESK}/disc`) ?? false;
  const { status, reachability } = useRipStatus(onPage ? POLL_MS : ROW_POLL_MS);
  const { showToast } = useShell();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [cover, setCover] = useState<string | null>(null);

  // the cover, once per disc (cached by lib/rip-status)
  const releaseMbid = status?.releaseMbid;
  const album = status?.album;
  const artist = status?.albumArtist;
  useEffect(() => {
    if (!releaseMbid && !album) {
      setCover(null);
      return;
    }
    let gone = false;
    void resolveDiscCover(releaseMbid || `${album}|${artist ?? ""}`, { releaseMbid, album, artist }).then((url) => !gone && setCover(url));
    return () => {
      gone = true;
    };
  }, [releaseMbid, album, artist]);

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
      sure: st === "matched" && !status?.unidentified && (status?.confidence ?? 0) >= SURE,
      moving: !!st && MOVING.includes(st),
      busy,
      rip: () => void act("/api/rip/start", "Couldn't start the rip. Try again in a moment."),
      stop: () => void act("/api/rip/stop", "Couldn't stop the rip."),
      eject: () => void act("/api/rip/eject", "Couldn't eject the disc."),
    };
  }, [status, reachability, cover, busy, act]);

  return <DiscCtx.Provider value={value}>{children}</DiscCtx.Provider>;
}

/** The disc's name and its one quiet line, by state. */
function words(s: RipStatus, sure: boolean): { name: string; line: string } {
  const name = s.album?.trim() || "Audio CD";
  const total = s.trackCount ?? s.tracks?.length ?? 0;
  const done = ripDoneCount(s);
  switch (s.state) {
    case "ripping":
      return { name, line: `Ripping ${done}/${total || "?"}` };
    case "registering":
      return { name, line: "Adding to your library" };
    case "done":
      return { name, line: "In your library" };
    case "incomplete":
      return { name, line: `${done} of ${total} ripped` };
    case "error":
      return { name, line: "Couldn't read it" };
    case "matched":
      if (!sure) return { name, line: "Which release is this?" };
      return { name, line: s.alreadyInLibrary ? "In your library" : (s.albumArtist ?? "") };
    case "confirm":
      return { name, line: "Which release is this?" };
    default:
      return { name: s.album?.trim() || "Audio CD", line: "Reading…" };
  }
}

/** Still reading: nothing known about the disc yet (the drive spinning up, the lookup on its way). */
export const reading = (s: RipStatus | null) => !!s && (s.state === "detecting" || (s.state === "idle" && s.discPresent));

/** The cover; with none yet, the disc itself, turning while it's being read (2026-10-31: the drawn
    "Audio CD" placeholder read as broken). */
export function DiscArt({ cover, sizes, spin }: { cover: string | null; sizes: string; spin?: boolean }) {
  return cover ? <Art src={cover} sizes={sizes} /> : <span className={d.discBare} data-spin={spin || undefined} aria-hidden="true" />;
}

/** The sidebar's row: only while a disc is in (or a rip still has something to say). */
export function DiscRow({ slim }: { slim: boolean }) {
  const disc = useDisc();
  const router = useRouter();
  const cm = useContextMenu();
  const onPage = usePathname()?.startsWith(`${DESK}/disc`) ?? false;
  if (!disc.shown || !disc.status) return null;
  const s = disc.status;
  const { name, line } = words(s, disc.sure);
  const open = () => router.push(`${DESK}/disc`);
  const canRip = disc.sure && !disc.moving;
  const canEject = s.discPresent && !disc.moving && s.state !== "detecting";
  const total = s.trackCount ?? s.tracks?.length ?? 0;
  const pct = total ? Math.round((ripDoneCount(s) / total) * 100) : 0;
  const menu: MenuItem[] = [
    ...(canRip ? ([{ label: s.alreadyInLibrary ? "Rip Again" : "Rip to Library", onSelect: disc.rip, disabled: disc.busy }] as MenuItem[]) : []),
    ...(disc.moving ? ([{ label: "Stop Ripping", onSelect: disc.stop, disabled: disc.busy }] as MenuItem[]) : []),
    { label: "Show Tracks", onSelect: open },
    ...(s.state === "matched" || s.state === "confirm" ? ([{ label: "Not This Album…", onSelect: () => router.push(`${DESK}/disc?choose=1`) }] as MenuItem[]) : []),
    ...(canEject ? (["separator", { label: "Eject", onSelect: disc.eject, disabled: disc.busy }] as MenuItem[]) : []),
  ];
  return (
    <div className={d.discRow} data-on={onPage || undefined} data-moving={disc.moving || undefined} onContextMenu={(e: MouseEvent) => cm.open(e, menu)}>
      <button type="button" className={d.discThumb} onClick={open} aria-label={`${name}: ${line}`} title={slim ? `${name}: ${line}` : undefined}>
        <DiscArt cover={disc.cover} sizes="40px" spin={reading(s)} />
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
          {canRip && !s.alreadyInLibrary && (
            <button type="button" className={d.discRip} onClick={disc.rip} disabled={disc.busy}>
              Rip
            </button>
          )}
          {canEject && (
            <button type="button" className={d.discEject} onClick={disc.eject} disabled={disc.busy} aria-label="Eject" title="Eject">
              <Glyph name="eject" size={11} />
            </button>
          )}
        </>
      )}
      {cm.menu}
    </div>
  );
}

/** The ring around the disc: one segment per song, lit as each is copied, in the record's colour. */
function ringOf(states: TrackState[]): string {
  const on = "var(--pk-tint-glow, var(--pk-tint-neutral-glow))";
  const n = Math.max(1, states.length);
  const step = 360 / n;
  const gap = Math.min(4, step * 0.25);
  const parts = states.flatMap((st, i) => {
    const a = i * step;
    const b = a + step - gap;
    const c = st === "done" ? on : st === "ripping" || st === "encoding" ? `color-mix(in srgb, ${on} 55%, transparent)` : `color-mix(in srgb, ${on} 18%, transparent)`;
    return [`${c} ${a}deg ${b}deg`, `transparent ${b}deg ${a + step}deg`];
  });
  return `conic-gradient(${parts.join(", ")})`;
}

const TRACK_WORD: Partial<Record<TrackState, string>> = { ripping: "Copying", encoding: "Copying", done: "", error: "Couldn't read" };

const norm = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The disc that was last on this page: what it was, so an eject can say where it went. */
type LastDisc = { name: string; cover: string | null; mine: DeskAlbum | null };

/**
 * The drive with nothing in it (the founder, 2026-11-07: the empty state after an eject was "rough"): the
 * page's middle, calm. Just after an eject, the album's sleeve with its CD slid out beside it, its name
 * "is out", and the way to it in your library when it's there; otherwise a CD resting, and one line.
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

/** The disc's page: the album it is about to become, with the CD in its sleeve. */
export function DiscPage({ choose }: { choose: boolean }) {
  const disc = useDisc();
  const { shelf } = useDesk();
  const owned = useOwned();
  const tint = useTint(disc.cover);
  const s = disc.status;
  // what was on the page, kept while it stays open, so an eject reads as the disc leaving, not a blank
  const last = useRef<LastDisc | null>(null);
  if (disc.shown && s && !(reading(s) && !s.album)) {
    const { name } = words(s, disc.sure);
    const mine = shelf.find((a) => norm(a.title) === norm(name) && (!s.albumArtist || norm(a.artist) === norm(s.albumArtist))) ?? null;
    if (name) last.current = { name, cover: disc.cover, mine };
  }

  if (disc.reachability !== "online" || !s) {
    return <NoDisc last={null} head="The CD drive" answer={disc.reachability === "offline" ? "reconnecting" : "one moment"} line={disc.reachability === "offline" ? "Reconnecting to the CD drive…" : "Checking the CD drive…"} />;
  }
  if (!disc.shown) {
    if (s.drivePresent === false) return <NoDisc last={null} head="No CD drive" answer="plugged in" line="Plug one in and it shows up here." />;
    return <NoDisc last={last.current} head="No disc" answer="in the drive" line={last.current ? "Put another CD in and it opens here." : "Put a CD in and it opens here, ready to rip."} />;
  }
  // a guess, an unknown disc, a part-read one, an error, the drive's permission, or "Not this album?":
  // the drive panel's own steps, which choose and confirm before anything rips
  const main = s.state === "detecting" || (s.state === "idle" && s.discPresent) || disc.sure || disc.moving || s.state === "done";
  if (choose || !main || s.permissionState === "denied") {
    return (
      <div className={d.page}>
        <PageHead title={choose ? "Which release is this?" : "Disc"} />
        <div className={d.discPanel}>
          <CdDrivePanel connected />
        </div>
      </div>
    );
  }

  const { name } = words(s, disc.sure);
  const isReading = reading(s) && !s.album;
  const tracks: TrackStatus[] = s.tracks?.length ? s.tracks : Array.from({ length: s.trackCount ?? 0 }, (_, i) => ({ position: i + 1, title: "", state: "pending" as TrackState }));
  const total = tracks.length;
  const done = ripDoneCount(s);
  const year = s.date?.slice(0, 4);
  const mine = s.state === "done" ? shelf.find((a) => norm(a.title) === norm(name) && (!s.albumArtist || norm(a.artist) === norm(s.albumArtist))) : undefined;
  const meta = [
    year,
    total ? songs(total) : null,
    disc.moving ? (s.state === "registering" ? "adding to your library" : `ripping ${done} of ${total}${s.etaSeconds ? ` · about ${Math.max(1, Math.round(s.etaSeconds / 60))} min left` : ""}`) : null,
    s.state === "done" ? "in your library" : null,
    s.state === "matched" && s.alreadyInLibrary ? "already in your library" : null,
    null,
  ]
    .filter(Boolean)
    .join(" · ");
  const ejectPill = s.discPresent && !disc.moving && s.state !== "detecting" ? <Pill word="Eject" glyph={<Glyph name="eject" size={14} />} onClick={disc.eject} disabled={disc.busy} /> : null;

  return (
    <div className={`${d.page} ${d.albumPage}`} style={tint}>
      <Hero
        art={<DiscArt cover={disc.cover} sizes="240px" spin={isReading} />}
        peek={
          // the disc in its sleeve, once there's a sleeve to be in
          isReading ? undefined : <span className={d.discPeek} data-spin={s.state === "ripping" || undefined} aria-hidden="true">
            <span className={d.discSegs} style={{ background: ringOf(tracks.map((t) => t.state)) }} />
            <span className={d.discCd} />
          </span>
        }
        title={isReading ? "Reading the disc" : name}
        answer={isReading ? undefined : s.albumArtist}
        meta={meta}
      >
        <div className={d.heroKeys}>
          {disc.moving ? (
            <Pills>
              <Pill word="Stop" glyph={<Glyph name="close" size={14} />} onClick={disc.stop} disabled={disc.busy || s.state === "registering"} />
            </Pills>
          ) : s.state === "done" ? (
            <Pills>
              {mine ? <PlayPill onClick={() => void owned.playRecord(mine.key)} /> : null}
              {ejectPill}
            </Pills>
          ) : disc.sure ? (
            <Pills>
              <Pill fill word={s.alreadyInLibrary ? "Rip again" : "Rip to library"} glyph={<Glyph name="album" size={14} />} onClick={disc.rip} disabled={disc.busy} />
              {ejectPill}
            </Pills>
          ) : (
            <Pills>{ejectPill}</Pills>
          )}
        </div>
        {disc.sure && !disc.moving && (
          <p className={d.discNot}>
            <Link href={`${DESK}/disc?choose=1`}>Not this album?</Link>
          </p>
        )}
        {mine && (
          <p className={d.discNot}>
            <Link href={deskAlbum(mine)}>Open it in your library</Link>
          </p>
        )}
      </Hero>
      {isReading && (
        <ol className={d.discTracks} aria-hidden="true">
          {Array.from({ length: Math.max(6, Math.min(12, s.trackCount ?? 0)) }, (_, i) => (
            <li key={i} className={d.discTrack} data-ghost="">
              <span className={d.discNum}>{i + 1}</span>
              <span className={d.discGhostBar} style={{ width: `${38 + ((i * 23) % 37)}%` }} />
              <span />
            </li>
          ))}
        </ol>
      )}
      <ol className={d.discTracks} aria-label={`${name}'s songs`} hidden={isReading}>
        {tracks.map((t) => (
          <li key={t.position} className={d.discTrack} data-state={t.state} data-owned={t.inLibrary || undefined}>
            <span className={d.discNum}>{t.position}</span>
            <span className={d.discTitle}>{t.title || `Track ${t.position}`}</span>
            <span className={d.discMark}>
              {t.state === "done" ? <Glyph name="check" size={13} /> : t.state === "pending" && t.inLibrary && !disc.moving ? "In your library" : TRACK_WORD[t.state]}
            </span>
          </li>
        ))}
      </ol>
      {s.state === "done" && !mine && <p className={d.quiet}>It shows in your library in a moment.</p>}
    </div>
  );
}
