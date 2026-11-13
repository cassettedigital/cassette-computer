"use client";

/**
 * The player: the playing video (or whatever the page puts in the frame), then the song: its cover, the
 * title and a line of who and what, with Close at the end of that line, set apart from the playing keys.
 * Under it the keys: a big filled play and next on the left, the song's own actions (share, enlarge) on the
 * right. No progress line and no "playing / from YouTube" line (the founder, 2026-11-06): YouTube's own
 * controls scrub and say where it comes from, and the play key says whether it plays. A note shows only when
 * something went wrong ("Can't play here"). It only draws: the page frame wires it to its player
 * (PlayerDock.tsx) and passes the pieces in.
 *
 * Two shapes (the founder's pick, 2026-10-26): on a wide window a panel down the right (`mode` "rail"),
 * the video at its top and under it a list the page hands it (the album page's previews); on a narrower
 * one, pinned along the top of the window ("top"), the video the full width. Either way the video is never
 * smaller than 200 by 200 and nothing is laid over it, YouTube's rules for its player
 * (developers.google.com/youtube/terms/required-minimum-functionality): its own controls, links and end
 * screen stay where YouTube puts them.
 *
 * The video can be enlarged (the founder, 2026-10-21: "sometimes I want to see the video larger"): the
 * Expand key (DockExpand, placed among the keys by the page) lifts the same frame into a large centred view
 * over a dimmed page, about 16:9 and at most min(960px, 90vw) wide. Nothing is moved in the document, only
 * restyled, so the player is never reloaded and keeps its place in the song. Collapse, Escape or a click
 * on the dimmed page puts it back. While it is large the focus stays inside it (the Collapse key and the
 * video), and it goes back to the Expand key after.
 *
 * A shared song arrives in the rail before anything plays (the founder, 2026-11-06: "make it a right rail,
 * just like our player"): `lead` puts who sent it and their note at the top, above the video's place, and
 * the frame is DockCue, the song's still with one big Play, so the press turns it into the player in place.
 *
 * Between songs on a shared song's visit, the page puts DockUpNext where the title was (`upNext`): what
 * plays next, with a countdown, Play now, Stop and autoplay for this computer, beside the video and never
 * over it, so YouTube's own end screen shows.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { Icon } from "./Icon";
import { ladderSrc } from "@/lib/images/picture";
import s from "./dock.module.css";

type Big = { big: boolean; expand: () => void; expandKey: RefObject<HTMLButtonElement | null> };
const BigCtx = createContext<Big | null>(null);

export function Dock({
  ref,
  mode,
  cover,
  frame,
  title,
  by,
  note,
  keys,
  actions,
  dismiss,
  upNext,
  lead,
  list,
  listRef,
  listStyle,
  foot,
  bigAsk = 0,
}: {
  ref?: Ref<HTMLElement>;
  /** "rail": a panel down the right of a wide window; "top": pinned along the top of a narrower one. */
  mode: "rail" | "top";
  /** The song's cover: beside its title, and behind the frame while the video loads. */
  cover: string | null;
  frame: ReactNode;
  title: ReactNode;
  by: ReactNode;
  /** A word when something went wrong ("Can't play here"), or nothing. */
  note?: ReactNode;
  /** The playing keys, left: a big play (DockKey `big`) and next. */
  keys?: ReactNode;
  /** The song's own actions, right: share, enlarge (DockExpand). */
  actions?: ReactNode;
  /** Close, at the end of the title's line, apart from the playing keys. */
  dismiss?: ReactNode;
  /** In place of the title, between songs (DockUpNext). */
  upNext?: ReactNode;
  /** The rail's top, above the video: a shared song's sender and note (Arrival.tsx, through the Cue). */
  lead?: ReactNode;
  /** The rail's list under the video (what plays next); a page may portal its own into `listRef` instead. */
  list?: ReactNode;
  listRef?: Ref<HTMLDivElement>;
  /** The page's colour on the list (accentVars), so its hover-play draws in it. */
  listStyle?: CSSProperties;
  /** The player's footer: the rail's last line, or a slim line under the bar along the top (Open on YouTube). */
  foot?: ReactNode;
  /** The player's count of asks for the video large: each new one enlarges it. */
  bigAsk?: number;
}) {
  const [big, setBig] = useState(false);
  useEffect(() => {
    if (bigAsk > 0) setBig(true);
  }, [bigAsk]);
  const stage = useRef<HTMLDivElement>(null);
  const shut = useRef<HTMLButtonElement>(null);
  const expandKey = useRef<HTMLButtonElement>(null);
  const backTo = useRef(false);

  const expand = useCallback(() => setBig(true), []);
  const collapse = useCallback(() => {
    backTo.current = true;
    setBig(false);
  }, []);

  // Large: the focus goes to Collapse, Escape puts it back, and the focus may not leave the frame.
  // Small again: the focus goes back to the Expand key.
  useEffect(() => {
    if (!big) {
      if (backTo.current) {
        backTo.current = false;
        expandKey.current?.focus();
      }
      return;
    }
    shut.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        collapse();
      }
    };
    const onFocus = (e: FocusEvent) => {
      if (!stage.current?.contains(e.target as Node)) shut.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
    };
  }, [big, collapse]);

  // the loop's two ends: past the video back to Collapse, before Collapse round to the video
  const toVideo = () => stage.current?.querySelector("iframe")?.focus();
  const toShut = () => shut.current?.focus();

  // The cover behind the video frame, at the image ladder's large size (docs/reference/CASSETTE_IMAGES.md).
  const backdrop: CSSProperties = { backgroundImage: cover ? `url("${ladderSrc(cover, 800)}")` : undefined };
  // and beside the title, at the ladder's small size (64 across, sharp on a 2x screen)
  const art: CSSProperties = { backgroundImage: cover ? `url("${ladderSrc(cover, 240)}")` : undefined };
  return (
    <BigCtx.Provider value={{ big, expand, expandKey }}>
      <section ref={ref} className={s.dock} role="region" aria-label="Player" data-mode={mode} data-big={big || undefined}>
        <div className={s.dim} hidden={!big} onClick={collapse} aria-hidden="true" />
        {lead ? <div className={s.lead}>{lead}</div> : null}
        {/* the frame's place stays while the frame itself is lifted out */}
        <div className={s.slot}>
          <div
            ref={stage}
            className={s.stage}
            role={big ? "dialog" : undefined}
            aria-modal={big || undefined}
            aria-label={big ? "The video, enlarged" : undefined}
          >
            <span className={s.trap} tabIndex={big ? 0 : -1} hidden={!big} onFocus={toVideo} />
            <button ref={shut} type="button" className={s.shut} hidden={!big} onClick={collapse}>
              <Icon name="collapse" size={16} />
              Collapse
            </button>
            <div className={s.frame} style={backdrop}>
              {frame}
            </div>
            <span className={s.trap} tabIndex={big ? 0 : -1} hidden={!big} onFocus={toShut} />
          </div>
        </div>
        <div className={s.bar}>
          {upNext ?? (
            <div className={s.now}>
              <span className={s.art} style={art} aria-hidden="true" />
              <div className={s.meta}>
                <p className={s.title} aria-live="polite">
                  {title}
                </p>
                <p className={s.by}>{by}</p>
                {note ? <p className={s.note}>{note}</p> : null}
              </div>
              {dismiss ? <div className={s.dismiss}>{dismiss}</div> : null}
            </div>
          )}
          <div className={s.keys}>
            {keys ? <div className={s.transport}>{keys}</div> : null}
            {actions ? <div className={s.actions}>{actions}</div> : null}
          </div>
        </div>
        {mode === "rail" && (
          <div ref={listRef} className={s.list} style={listStyle}>
            {list}
          </div>
        )}
        {foot ? <div className={s.foot}>{foot}</div> : null}
      </section>
    </BigCtx.Provider>
  );
}

/** One round key on the player: play, pause, previous, next or close. `big` is the one filled play key; a
 *  key with nothing to do yet (previous, before anything has played) stays in its place, greyed. */
export function DockKey({
  glyph,
  label,
  onClick,
  big = false,
  disabled = false,
}: {
  glyph: "play" | "pause" | "prev" | "next" | "close";
  label: string;
  onClick: () => void;
  big?: boolean;
  disabled?: boolean;
}) {
  return (
    <button type="button" className={big ? s.play : undefined} aria-label={label} onClick={onClick} disabled={disabled}>
      <Icon name={glyph} />
    </button>
  );
}

/**
 * A song waiting for its first press, in the video's place: its still (YouTube's, else the cover behind the
 * frame shows) with one big Play in the middle. Never a video: nothing is laid over YouTube's player, which
 * only arrives on the press.
 */
export function DockCue({ videoId, title, onPlay }: { videoId: string; title: string; onPlay: () => void }) {
  const [fail, setFail] = useState(false);
  return (
    <button type="button" className={s.cue} onClick={onPlay} aria-label={`Play ${title}`}>
      {!fail && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`} alt="" onError={() => setFail(true)} />
      )}
      <span className={s.cueDisc} aria-hidden="true">
        <Icon name="play" size={28} />
      </span>
    </button>
  );
}

/** The whole seconds left until `at` (ms epoch), ticking; 0 with no `at`. */
function useSecondsLeft(at: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!at) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [at]);
  return at ? Math.max(0, Math.ceil((at - now) / 1000)) : 0;
}

/**
 * Between songs on a shared song's visit (the player's `waiting`), where the title was: what plays next,
 * with Play now, Stop, and the countdown with autoplay off (or back on) for this computer under them.
 */
export function DockUpNext({
  title,
  album,
  at,
  onPlay,
  onStop,
  onAutoplay,
}: {
  title: string;
  album: string | null;
  /** When it plays by itself (ms epoch), or null while waiting for a press (autoplay off). */
  at: number | null;
  onPlay: () => void;
  onStop: () => void;
  onAutoplay: (on: boolean) => void;
}) {
  const left = useSecondsLeft(at);
  const autoplay = at !== null;
  return (
    <div className={s.next} role="group" aria-label="Up next">
      <p className={s.nextLabel}>
        Up next
        {album ? (
          <>
            {" "}
            on <em>{album}</em>
          </>
        ) : null}
      </p>
      <p className={s.nextTitle}>{title}</p>
      <div className={s.nextKeys}>
        <button type="button" className={`${s.nextPlay} ${s.nextPlay}`} onClick={onPlay}>
          <Icon name="play" size={14} />
          Play now
        </button>
        <button type="button" className={`${s.nextStop} ${s.nextStop}`} onClick={onStop}>
          Stop
        </button>
      </div>
      <p className={s.nextWhen}>
        {autoplay ? `Plays in ${left}` : "Autoplay is off on this computer"}
        {" · "}
        <button type="button" className={`${s.nextAuto} ${s.nextAuto}`} onClick={() => onAutoplay(!autoplay)}>
          {autoplay ? "Turn off autoplay" : "Turn it back on"}
        </button>
      </p>
    </div>
  );
}

/** The Expand key: enlarges the video. Inside a Dock only. */
export function DockExpand() {
  const v = useContext(BigCtx);
  if (!v) throw new Error("DockExpand outside a Dock");
  return (
    <button ref={v.expandKey} type="button" aria-label="Enlarge the video" aria-haspopup="dialog" aria-expanded={v.big} onClick={v.expand}>
      <Icon name="expand" />
    </button>
  );
}
