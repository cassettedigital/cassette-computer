"use client";

/**
 * The desktop app's window, drawn in the taste set: the library on the left, the page in the middle (a
 * size container, so the real album and artist pages lay themselves out by the room they get, exactly
 * as they do on the web), the side view on the right, and the player along the foot (the old desktop
 * app's split, 2026-10-22). One rule for every click (the founder, 2026-11-06): a word (a name, a title)
 * opens its thing in the middle; anything else you click (a cover, a row, a song) selects it, and the side
 * view shows what's selected; only a play symbol plays, so a click never changes what's on. The side view
 * changes only when you select something: nothing swaps it on its own, and its ← steps back through what it
 * showed. The bar's cover selects the record that's on. The full window (/playing) gives the player
 * everything; the side view steps aside while it does. Put away, a selection brings the side view back
 * beside the page, which makes room for it, and the thing clicked keeps its height in the window; only a
 * window too narrow for both floats it over the page.
 *
 * Two players, never dressed as each other: the bar plays the records on the Mac (owned.tsx, over the
 * dashboard's own player: the Mac's hub plays the files, this is its remote), and a record's page plays
 * YouTube previews in the booth, at the top of the side view with the side view carrying on beneath it
 * (Player.tsx). The radio plays through the site's one radio player. All three stop each other
 * (lib/audio-lane). The side view can be put away; a preview then floats as a card.
 *
 * The preview: YouTube asks for its player to be on screen while it plays, with nothing over it, and
 * moving an iframe to a new parent reloads it (the song would start over). So the preview lives in ONE
 * host, fixed over the window, above the card (BUG-613), and lays itself over the booth's slot wherever
 * the booth is, showing only as much as the booth does while it unfolds.
 *
 * The taste pages link to /album/... and /artist/...; inside this window those clicks stay in the window
 * (one capture-phase listener rewrites them), so nothing in the shared pages is edited for the desk. A
 * record you own opens as your copy (album/[id]).
 *
 * Keys: Space plays and pauses, Cmd/Ctrl + Right goes to the next song, "/" searches, Escape leaves
 * the full window (or puts a floating side view away).
 *
 * The parts are the player kit's (packages/cassette-kit), the iPhone app's components drawn for the web, under
 * one `.kit` scope so every token is in reach. Radio plays through the site's one radio player
 * (RadioProvider, mounted at the root); the bar draws it, so the site's own radio bar is hidden here.
 * The preview player and the radio already stop each other (lib/audio-lane).
 */

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import NextLink from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Glyph, KitProvider, tokens as kit, type KitLinkProps } from "@discovery/cassette-kit";
import { useRadio } from "@/app/components/radio/RadioProvider";
import { useReveal } from "@/app/_taste/reveal";
import t from "@/app/_taste/taste.module.css";
import { TASTE } from "@/app/(taste)/_kit/links";
import { PlayerProvider, usePlayer } from "@/app/(taste)/_kit/player";
import { useShell } from "@/app/dashboard/_shell/shell-context";
import { DeskDrop } from "./DeskDrop";
import type { RailAccountUser } from "@/app/components/RailAccountMenu";
import { Sidebar, WindowUpdate } from "./Sidebar";
import { useDesktopUpdate } from "@/app/components/UpdatePill";
import { Booth, PlayerBar, Preview } from "./Player";
import { Rail } from "./Rail";
import { EditorsProvider } from "./Editors";
import { Away } from "./Away";
import { Greeting, HereStrip, SwitchScreen, ThisComputerProvider, useNotMain, useThisComputer } from "./ThisComputer";
import { HUB_IN_REACH, SIDECAR_SAME_ORIGIN } from "@/lib/playback-remote";
import { OwnedProvider, useOwned } from "./owned";
import { KeepPlayingProvider } from "./keep-playing";
import { useOnline } from "./network";
import { loadSongs, rereadLibrary } from "./songs";
import { inField, spaceIsTheFocus, watchFocusArrival } from "@/lib/keys";
import { DESK, type DeskData } from "./types";
import { DiscProvider, useDisc } from "./disc";
import { openOutside } from "@/lib/open-outside";
import { PUBLIC_SITE_URL } from "@/lib/urls";
import { collectInputFiles, pickMusicInApp, startIngest } from "@/lib/library-ingest";
import { ladderSrc } from "@/lib/images/picture";
import d from "./desk.module.css";

const DataCtx = createContext<DeskData | null>(null);

/** Who's signed in, for the rail's account menu (the same one every rail has). Not cached with the data. */
export type DeskAccount = { user: RailAccountUser; isCreator: boolean; isAdmin: boolean };
const AccountCtx = createContext<DeskAccount | null>(null);
export const useDeskAccount = () => useContext(AccountCtx);
export function useDesk(): DeskData {
  const v = useContext(DataCtx);
  if (!v) throw new Error("useDesk outside DeskShell");
  return v;
}

const KitLink = ({ href, ...rest }: KitLinkProps) => <NextLink href={href} {...rest} />;

/* ── the side view: put away (remembered), and the record it's looking into ── */

/** A media query, live. False on the server (the wide layout), matched on the client. */
function useMedia(q: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(q);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(q).matches,
    () => false,
  );
}

/** What the side view can look into: anything in the library you click once. */
export type Look =
  | { kind: "record"; key: string }
  | { kind: "playlist"; id: string }
  | { kind: "artist"; name: string; slug: string | null }
  | { kind: "station"; slug: string }
  | { kind: "mix"; id: string };
export const sameLook = (a: Look | null, b: Look) =>
  !!a &&
  a.kind === b.kind &&
  (a.kind === "record"
    ? a.key === (b as typeof a).key
    : a.kind === "playlist" || a.kind === "mix"
      ? a.id === (b as typeof a).id
      : a.kind === "artist"
        ? a.name === (b as typeof a).name
        : a.slug === (b as typeof a).slug);

type Aside = {
  away: boolean;
  setAway: (v: boolean) => void;
  /** what the side view shows; null follows the record that's on */
  focus: Look | null;
  /** select something (a click on anything but a word or a play symbol): the side view shows it,
      floating over the page if it was put away */
  select: (look: Look) => void;
  /** it's what the side view is showing right now (a lit tile) */
  showing: (look: Look) => boolean;
  /** back to the record that's on (the bar's cover) */
  follow: () => void;
  tab: "look" | "queue";
  setTab: (t: "look" | "queue") => void;
  /** the bar's Up next key: the queue in the side view, or back to the record */
  showQueue: (on: boolean) => void;
};
const AsideCtx = createContext<Aside | null>(null);
export function useAside(): Aside {
  const v = useContext(AsideCtx);
  if (!v) throw new Error("useAside outside DeskShell");
  return v;
}
const ASIDE_KEY = "desk-taste-deck-hidden";

/** Leaving the full-window player: back to the page it was opened from (Esc or its key), Home when there's none. */
const RoomExitCtx = createContext<() => void>(() => {});
export const useLeaveRoom = () => useContext(RoomExitCtx);

/* ── the preview's one host and the slots it lays itself over ── */

const SlotCtx = createContext<((el: HTMLElement, on: boolean) => void) | null>(null);

/** Where the preview should sit. The last slot to mount wins. */
export function PreviewSlot({ className }: { className?: string }) {
  const register = useContext(SlotCtx);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !register) return;
    register(el, true);
    return () => register(el, false);
  }, [register]);
  return <div ref={ref} className={className} data-slot="" />;
}

function PreviewHost({ slot }: { slot: HTMLElement | null }) {
  const { track } = usePlayer();
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (!slot) {
      el.style.visibility = "hidden";
      return;
    }
    let frame = 0;
    // the booth the slot is in (data-clip) can show less than the whole slot while it unfolds: the
    // video is cut to what the booth shows, and hidden until enough of it is there to be the player
    const clip = slot.closest<HTMLElement>("[data-clip]");
    const place = () => {
      frame = 0;
      const r = slot.getBoundingClientRect();
      const c = clip?.getBoundingClientRect();
      const top = c ? Math.max(0, c.top - r.top) : 0;
      const bottom = c ? Math.max(0, r.bottom - c.bottom) : 0;
      const corners = getComputedStyle(slot).borderRadius; // the slot's own corners (the booth's are a picture's)
      el.style.visibility = r.width > 0 && r.height - top - bottom > 8 ? "visible" : "hidden";
      el.style.transform = `translate(${r.left}px, ${r.top}px)`;
      el.style.width = `${r.width}px`;
      el.style.height = `${r.height}px`;
      el.style.borderRadius = corners;
      el.style.clipPath = top || bottom ? `inset(${top}px 0 ${bottom}px 0 round ${corners})` : "";
    };
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    const ro = new ResizeObserver(soon);
    ro.observe(slot);
    if (clip) ro.observe(clip);
    window.addEventListener("resize", soon);
    window.addEventListener("scroll", soon, true); // the page and the deck scroll inside the window
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      window.removeEventListener("resize", soon);
      window.removeEventListener("scroll", soon, true);
    };
  }, [slot]);
  return (
    <div ref={host} className={d.previewHost} style={{ backgroundImage: track?.cover ? `url("${ladderSrc(track.cover, 800)}")` : undefined }} hidden={!track}>
      <Preview />
    </div>
  );
}

/* ── the toolbar: back and forward through the pages you've been on (a desktop app keeps its own
      history, as a browser does), and the page's name once its big title has scrolled away ── */

function useHistoryStack(pathname: string) {
  const router = useRouter();
  const stack = useRef<string[]>([]);
  const at = useRef(-1);
  const moving = useRef<number | null>(null);
  const [, bump] = useState(0);
  useEffect(() => {
    const here = pathname + window.location.search;
    if (moving.current !== null) {
      at.current = moving.current;
      moving.current = null;
    } else if (stack.current[at.current] !== here) {
      stack.current = [...stack.current.slice(0, at.current + 1), here];
      at.current = stack.current.length - 1;
    }
    bump((n) => n + 1);
  }, [pathname]);
  const go = useCallback(
    (by: -1 | 1) => {
      const to = at.current + by;
      const href = stack.current[to];
      if (!href) return;
      moving.current = to;
      router.push(href);
    },
    [router],
  );
  return { canBack: at.current > 0, canForward: at.current < stack.current.length - 1, go };
}

function Toolbar({
  pane,
  pathname,
  nav,
  update,
}: {
  pane: RefObject<HTMLElement | null>;
  pathname: string;
  nav: ReturnType<typeof useHistoryStack>;
  update: ReturnType<typeof useDesktopUpdate>;
}) {
  // the history is the window's, kept while the player fills the window and the toolbar is gone
  const { canBack, canForward, go } = nav;
  const [scrolled, setScrolled] = useState(false);
  const [title, setTitle] = useState("");
  // the page's own name, from its <title> ("Albums · Cassette"), read once the new page has set it
  useEffect(() => {
    const read = () => {
      const t = document.title.replace(/\s*·\s*Cassette$/, "").trim();
      setTitle(!t || t === "Cassette" ? "Home" : t);
    };
    read();
    const el = document.querySelector("title");
    const mo = el ? new MutationObserver(read) : null;
    if (el && mo) mo.observe(el, { childList: true, characterData: true, subtree: true });
    const t = window.setTimeout(read, 120);
    return () => {
      mo?.disconnect();
      window.clearTimeout(t);
    };
  }, [pathname]);
  useEffect(() => {
    const el = pane.current;
    if (!el) return;
    const on = () => setScrolled(el.scrollTop > 64);
    on();
    el.addEventListener("scroll", on, { passive: true });
    return () => el.removeEventListener("scroll", on);
  }, [pane, pathname]);
  // the bar runs to where the page's scroll track starts: the column's edge when the Mac draws its
  // scrollbars over the page (nothing to keep clear of), short of the track when it gives them their own
  // lane. A fixed gap left a notch either way (the founder, 2026-11-07)
  const [gutter, setGutter] = useState(0);
  useEffect(() => {
    const el = pane.current;
    if (!el) return;
    const read = () => setGutter(Math.max(0, el.offsetWidth - el.clientWidth));
    read();
    // the content box narrows when a lane-taking scrollbar appears, so this hears it come and go
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pane]);
  // Cmd/Ctrl + [ and ] go back and forward, as in every Mac app with history
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "[") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "]") {
        e.preventDefault();
        go(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);
  return (
    <div className={d.toolbar} data-scrolled={scrolled || undefined} data-tauri-drag-region="deep" style={{ marginRight: gutter }}>
      <div className={d.history}>
        <button type="button" className={d.navKey} aria-label="Back" title="Back (⌘[)" disabled={!canBack} onClick={() => go(-1)}>
          <Glyph name="chevronRight" size={15} className={d.flip} />
        </button>
        <button type="button" className={d.navKey} aria-label="Forward" title="Forward (⌘])" disabled={!canForward} onClick={() => go(1)}>
          <Glyph name="chevronRight" size={15} />
        </button>
      </div>
      <p className={d.toolTitle} aria-hidden={!scrolled}>
        {title}
      </p>
      {/* a newer app, at the toolbar's right end on Windows and Linux (on the Mac, by the lights) */}
      <WindowUpdate {...update} place="bar" />
    </div>
  );
}

const SLIM_KEY = "desk-taste-rail-slim";
/** How old the window's library is before coming back to the window reads it again. */
const REREAD_AFTER_MS = 3 * 60_000;
const PAGE_LINK = new RegExp(`^(?:${TASTE.replace(/[/]/g, "\\/")})?/(album|artist)/(.+)$`);

function Window({ children }: { children: ReactNode }) {
  const preview = usePlayer();
  const owned = useOwned();
  const radio = useRadio();
  const { toast, showToast } = useShell();
  // a newer app, shown by the window's own buttons (WindowUpdate: by the Mac's lights, or in the toolbar)
  const update = useDesktopUpdate();
  const [asideHidden, setAsideHiddenState] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(ASIDE_KEY) === "1") setAsideHiddenState(true);
    } catch {}
  }, []);
  const setAsideHidden = useCallback((v: boolean) => {
    setAsideHiddenState(v);
    try {
      localStorage.setItem(ASIDE_KEY, v ? "1" : "0");
    } catch {}
  }, []);
  // A YouTube preview never plays on with the window minimized or the app hidden (YouTube's rules: no
  // background play, BUG-572). The page goes hidden then; the person presses play again on their return.
  // The records on the Mac (the player bar) are the person's own music and play on.
  const { status: previewStatus, toggle: togglePreview } = preview;
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && previewStatus === "playing") togglePreview();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [previewStatus, togglePreview]);
  const router = useRouter();
  const pathname = usePathname();
  // a satellite or a spare takes no drop-ins: music is added on the main computer (ThisComputer)
  const notMain = useNotMain();
  // The library the window opened with stays until something reads it again (BUG-760): coming back to
  // the window (from another app, the Dock, a closed window) reads it again once what it holds is a few
  // minutes old, so a record that arrived meanwhile (a rip, a drop, a phone's change) is on the shelf.
  const lastRead = useRef(Date.now());
  useEffect(() => {
    const back = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastRead.current < REREAD_AFTER_MS) return;
      lastRead.current = Date.now();
      rereadLibrary(router);
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
    };
  }, [router]);
  // The side view docked beside the page, or not: put away by hand, or a narrow window. Put away in a
  // wide window, a selection docks it again and the page makes room (the founder, 2026-11-12: floated
  // over the page, as BUG-873 had it, the grid looked broken under it). What was clicked keeps its height
  // in the window, so the reflow doesn't carry it off (BUG-873's worry). A window too narrow for both
  // floats it over the page instead; Escape, a click on the page, or the next page puts it back.
  const narrowAside = useMedia("(max-width: 979.98px)");
  const [floatOpen, setFloatOpen] = useState(false);
  useEffect(() => setFloatOpen(false), [narrowAside]);
  useEffect(() => setFloatOpen(false), [pathname]);
  const [focus, setFocus] = useState<Look | null>(null);
  // An empty library with nothing picked or playing gives the side view nothing to show ("Click a record
  // and it opens here" beside no records; the founder, 2026-11-18): it stays put away until something is
  // picked or plays, or the person opens it by hand.
  const { shelf } = useDesk();
  const [askedFor, setAskedFor] = useState(false);
  const nothingYet = shelf.length === 0 && !focus && !owned.track && radio.status === "idle" && !preview.track && !askedFor;
  const docked = !narrowAside && !asideHidden && !nothingYet;
  const asideAway = !docked && !floatOpen;
  const asideOver = !docked && floatOpen;
  const setAway = useCallback(
    (v: boolean) => {
      if (!v) setAskedFor(true);
      if (narrowAside) return setFloatOpen(!v);
      setAsideHidden(v);
      setFloatOpen(false);
    },
    [narrowAside, setAsideHidden],
  );
  const appRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLElement>(null);
  // the last thing pressed, and where it sat when a selection brought the side view back
  const pressed = useRef<{ el: Element; at: number } | null>(null);
  const anchor = useRef<{ el: Element; top: number } | null>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Element) pressed.current = { el: e.target, at: performance.now() };
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, []);
  // the page has made room: scroll it so the thing clicked sits where it was
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    const pane = paneRef.current;
    if (!docked || !a || !pane || !a.el.isConnected) return;
    pane.scrollTop += a.el.getBoundingClientRect().top - a.top;
  }, [docked]);
  const [tab, setTab] = useState<"look" | "queue">("look");
  // no back key: the side view shows what's picked and nothing else; to go back, pick the earlier thing
  // in the page, where it still is (the founder, 2026-11-07: the side view is meant to feel temporary)
  const aside = useMemo<Aside>(() => {
    const open = () => {
      setAskedFor(true);
      if (docked) return;
      if (narrowAside) return setFloatOpen(true);
      // the click (or, from the keyboard, the focus) that asked for it, if it's in the page
      const p = pressed.current;
      const hit = p && performance.now() - p.at < 1000 ? p.el : document.activeElement;
      // the tile or row it's in, which outlives the reflow (a cover's picture can be swapped for a
      // bigger one when the tiles grow)
      const el = hit?.closest("li, [role='row']") ?? hit;
      const pane = paneRef.current;
      anchor.current = el && pane?.contains(el) ? { el, top: el.getBoundingClientRect().top } : null;
      setAsideHidden(false);
    };
    return {
      away: asideAway,
      setAway,
      focus,
      select: (look) => {
        setFocus(look);
        setTab("look");
        open();
      },
      showing: (look) => !asideAway && tab === "look" && sameLook(focus, look),
      follow: () => {
        setFocus(null);
        setTab("look");
        open();
      },
      tab,
      setTab,
      showQueue: (on) => {
        setTab(on ? "queue" : "look");
        if (on) open();
      },
    };
  }, [asideAway, setAway, focus, tab, docked, narrowAside, setAsideHidden]);
  const room = pathname === `${DESK}/playing`;
  const nav = useHistoryStack(pathname);
  const leaveRoom = useCallback(() => (nav.canBack ? nav.go(-1) : router.push(DESK)), [nav, router]);
  // floating over the page, the side view goes back where it was put at a click on the page itself (not
  // on something there to click, which may be the next thing to look at)
  useEffect(() => {
    const pane = paneRef.current;
    if (!asideOver || !pane) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest?.("a, button, input, textarea, select, label, [role='row'], [role='button'], [role='menu']")) setAway(true);
    };
    pane.addEventListener("pointerdown", onDown);
    return () => pane.removeEventListener("pointerdown", onDown);
  }, [asideOver, setAway]);
  // The Mac's menu bar (lib.rs menu_bar): each of its own items arrives as a "cassette:menu" event
  const disc = useDisc();
  const pickFiles = useRef<HTMLInputElement>(null);
  const onMenu = useRef<(id: string) => void>(() => {});
  onMenu.current = (id) => {
    switch (id) {
      case "settings":
        router.push(`${DESK}/settings/account`);
        break;
      case "update":
        void update
          .checkNow()
          .then((v) => showToast(v ? `Cassette ${v} is ready: Update is in the sidebar` : "Cassette is up to date"))
          .catch(() => showToast("Couldn't check for updates", { variant: "error" }));
        break;
      case "add-music":
        // the app's own picker, whose picks it can move; the page's file input elsewhere
        if (!pickMusicInApp()) pickFiles.current?.click();
        break;
      case "rip":
        // one press rips only a disc known for sure and not already yours; anything else opens its page,
        // whose own steps choose and confirm first (nothing rips unasked)
        if (disc.sure && !disc.moving && !disc.status?.alreadyInLibrary) disc.rip();
        else router.push(`${DESK}/disc`);
        break;
      case "eject":
        if (disc.status?.discPresent && !disc.moving) disc.eject();
        break;
      case "search":
        router.push(`${DESK}/search`);
        break;
      case "now-playing":
        aside.follow();
        break;
      case "play-pause":
        if (radio.station && radio.status !== "idle") radio.stop();
        else if (preview.track) preview.toggle();
        else owned.toggle();
        break;
      case "next":
        if (preview.track) preview.next();
        else owned.next();
        break;
      case "previous":
        owned.previous();
        break;
      case "help":
        openOutside(`${PUBLIC_SITE_URL}/help`);
        break;
    }
  };
  useEffect(() => {
    const events = (globalThis as { __TAURI__?: { event?: { listen?: (name: string, cb: (e: { payload: unknown }) => void) => Promise<() => void> } } }).__TAURI__?.event;
    if (!events?.listen) return;
    let off: (() => void) | null = null;
    let gone = false;
    void events.listen("cassette:menu", (e) => onMenu.current(String(e.payload))).then((u) => (gone ? u() : (off = u)));
    return () => {
      gone = true;
      off?.();
    };
  }, []);
  useReveal(paneRef);

  // the rail folded to its icons, remembered
  const [slim, setSlimState] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(SLIM_KEY) === "1") setSlimState(true);
    } catch {}
  }, []);
  const setSlim = useCallback((v: boolean) => {
    setSlimState(v);
    try {
      localStorage.setItem(SLIM_KEY, v ? "1" : "0");
    } catch {}
  }, []);
  // a narrow window: the rail folds to its icons on its own; opened by hand it floats over the page,
  // and folds again on the next page. Leaving narrow drops the override.
  const narrowRail = useMedia("(max-width: 1179.98px)");
  const [railOpenNarrow, setRailOpenNarrow] = useState(false);
  useEffect(() => {
    if (!narrowRail) setRailOpenNarrow(false);
  }, [narrowRail]);
  useEffect(() => setRailOpenNarrow(false), [pathname]);
  const slimNow = narrowRail ? !railOpenNarrow : slim;
  const railOver = narrowRail && railOpenNarrow;
  const onSlim = useCallback((v: boolean) => (narrowRail ? setRailOpenNarrow(!v) : setSlim(v)), [narrowRail, setSlim]);

  const slots = useRef<HTMLElement[]>([]);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const register = useCallback((el: HTMLElement, on: boolean) => {
    slots.current = slots.current.filter((x) => x !== el);
    if (on) slots.current.push(el);
    setSlot(slots.current.at(-1) ?? null);
  }, []);

  // keep the Mac's song list saved in the browser whenever the window is online (BUG-542): with no
  // internet, any record then starts from it, not only the ones played here before. Once the window
  // has settled, and again on coming back online.
  const online = useOnline();
  // the network gone: a station's stream has nothing to play, so the radio stops rather than sit "live"
  useEffect(() => {
    if (!online && radio.station && radio.status !== "idle") radio.stop();
  }, [online, radio]);
  // the list itself is read at once from the kept copy (tracklists then come straight from memory)
  // (the first read also asks the cloud, so the timed refresh is for coming back online)
  const firstRead = useRef(true);
  useEffect(() => {
    void loadSongs().catch(() => {});
  }, []);
  useEffect(() => {
    if (firstRead.current) {
      firstRead.current = false;
      return;
    }
    if (!online) return;
    const t = window.setTimeout(() => void loadSongs({ fresh: true }).catch(() => {}), 4000);
    return () => window.clearTimeout(t);
  }, [online]);

  // the desk's palette on the page itself while it's open: the old library's parts it still mounts
  // (the record editor, the cover pickers, the photo cropper, settings, the CD panel) draw from the old
  // palette (--cs-*), which desk.module.css .deskBody re-roots in the kit's (--pk-*). On the body, not
  // the window, because their pop-ups are drawn outside the window (portals at the body). The window and
  // the body both follow the reader's device, light or dark (kit.follow); a review link holds one paper
  // on both (?paper=light or ?paper=dark)
  useEffect(() => {
    const on = [kit.kit, kit.follow, d.deskBody];
    document.body.classList.add(...on);
    const asked = new URLSearchParams(window.location.search).get("paper");
    const held = asked === "light" || asked === "dark" ? asked : null;
    if (held) {
      document.body.dataset.paper = held;
      if (appRef.current) appRef.current.dataset.paper = held;
    }
    return () => {
      document.body.classList.remove(...on);
      if (held) delete document.body.dataset.paper;
    };
  }, []);

  // a new page starts at its top (the page scrolls inside the window, not the window itself)
  useEffect(() => {
    if (!window.location.hash) paneRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  // the shared pages' links stay inside the window
  useEffect(() => {
    const el = appRef.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank") return;
      // the record and artist pages link to themselves at /proto/taste/... today and at /album and
      // /artist once they're the site's own pages; inside this window either stays in the window
      const href = a.getAttribute("href") ?? "";
      const m = href.match(PAGE_LINK);
      if (!m) return;
      e.preventDefault();
      router.push(`${DESK}/${m[1]}/${m[2]}`);
    };
    el.addEventListener("click", onClick, true);
    return () => el.removeEventListener("click", onClick, true);
  }, [router]);

  // the desktop keys, never while typing (BUG-604), and Space never where it belongs to the focus: a
  // field, a menu, or a button the keyboard brought the focus to (lib/keys.ts, BUG-603; one rule with
  // the shell's). Space for the Mac's player is the shell's own (shell-context); the radio and a preview
  // come first, so theirs is heard before it, in the capture phase, and goes no further.
  useEffect(() => {
    watchFocusArrival();
    const onSpace = (e: KeyboardEvent) => {
      if (e.key !== " " || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (spaceIsTheFocus(e.target)) return;
      if (radio.station && radio.status !== "idle") radio.stop();
      else if (preview.track) preview.toggle();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // Cmd-arrows in a field move the cursor to the line's ends; they skip songs everywhere else
      const skip = (e.metaKey || e.ctrlKey) && !inField(el);
      if (e.key === "ArrowRight" && skip && (preview.track || owned.track)) {
        e.preventDefault();
        if (preview.track) preview.next();
        else owned.next();
      } else if (e.key === "ArrowLeft" && skip && owned.track && !preview.track) {
        e.preventDefault();
        owned.previous();
      } else if (e.key === "Escape" && room && !el?.closest?.("[role='menu']")) {
        leaveRoom();
      } else if (e.key === "Escape" && asideOver && !el?.closest?.("[role='menu'], input, textarea")) {
        setAway(true);
      }
    };
    window.addEventListener("keydown", onSpace, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onSpace, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [preview, owned, room, leaveRoom, radio, asideOver, setAway]);

  return (
    <KitProvider link={KitLink}>
    <AsideCtx.Provider value={aside}>
    <RoomExitCtx.Provider value={leaveRoom}>
    <SlotCtx.Provider value={register}>
      {/* the bar plays the radio here, so the site's own radio bar steps aside while this window is open */}
      <style>{`[role="region"][aria-label="Radio"]{display:none!important}`}</style>
      <div
        ref={appRef}
        className={`${t.root} ${t.follows} ${kit.kit} ${kit.follow} ${d.app}`}
        data-follows=""
        data-titlebar="own" /* lays out its own top in the Mac app's window (lib/desktop-shell) */
        data-room={room || undefined}
        data-slim={slimNow || railOver || undefined /* the grid keeps the folded column; an open rail floats */}
        data-rail-over={railOver || undefined}
        data-aside={asideAway ? "away" : asideOver ? "over" : undefined}
        data-update={update.version ? "" : undefined /* folded, the toolbar steps right for it */}
      >
        <Sidebar slim={slimNow} onSlim={onSlim} />
        <WindowUpdate {...update} place="lights" />
        <main ref={paneRef} className={`${t.body} ${d.pane}`}>
          {/* not the main computer: Home says where the music comes from, Devices keeps the switch (ThisComputer) */}
          {(pathname === DESK || pathname === `${DESK}/devices`) && <HereStrip always={pathname !== DESK} />}
          {children}
        </main>
        {!room && <Toolbar pane={paneRef} pathname={pathname} nav={nav} update={update} />}
        {/* the right column: the side view, a preview's video at its top (Rail); put away, or the
            player filling the window, the video floats as a card instead */}
        {!room && !asideAway && <Rail />}
        {(room || asideAway) && <Booth floating />}
        {!room && <PlayerBar />}
        <PreviewHost slot={slot} />
        {/* drop an album folder anywhere in the window to add it to the Mac; files dropped while the
            Mac can't be reached wait in the outbox and go when it's back (the dashboard's own) */}
        {!notMain && <DeskDrop quietOn={`${DESK}/devices`} />}
        {/* File > Add to Library… (the menu bar) */}
        <input
          ref={pickFiles}
          type="file"
          accept=".flac,.mp3,audio/flac,audio/mpeg"
          multiple
          hidden
          onChange={(e) => {
            const files = collectInputFiles(e.target.files);
            if (files.length) void startIngest(files);
            e.target.value = "";
          }}
        />
        {toast && (
          <div className={d.toast} role="status" data-variant={toast.variant}>
            {toast.msg}
          </div>
        )}
      </div>
    </SlotCtx.Provider>
    </RoomExitCtx.Provider>
    </AsideCtx.Provider>
    </KitProvider>
  );
}

/**
 * Where this window is: the desktop app holds the library. The website in a regular browser never
 * reaches the person's computer (lib/hub-origin, the founder 2026-10-29), so it gets Away from the start
 * instead of a library that can't play: it points to the app. Local development reaches its own hub,
 * and there the hub's own answer decides (the shell's hubReachable).
 */
function Where({ desktop, children }: { desktop: boolean; children: ReactNode }) {
  const { reachable } = useOwned();
  const { mac } = useDesk();
  const here = useThisComputer();
  // once this page has reached the hub it's on it: a missed answer later is a blip (the side view
  // says so), not a reason to take the window away
  const seen = useRef(false);
  if (reachable === true) seen.current = true;
  if (!desktop && !HUB_IN_REACH) return <Away mac={mac} />;
  // a second computer: greeted first, and the switch screen fills the window when asked for (ThisComputer)
  if (here?.status?.role === "spare" && !here.status.declined) return <Greeting />;
  if (here?.switchOpen || here?.restarting) return <SwitchScreen />;
  // still asking (the shell's probe waits while the window is out of sight, so this can last): the
  // window as it is, rather than a blank one; Away only once the Mac has really not answered
  if (desktop || SIDECAR_SAME_ORIGIN || seen.current || reachable === null) return children;
  return <Away mac={mac} />;
}

export function DeskShell({ data, account, desktop, children }: { data: DeskData; account: DeskAccount; desktop: boolean; children: ReactNode }) {
  return (
    <DataCtx.Provider value={data}>
    <AccountCtx.Provider value={account}>
      <PlayerProvider>
        <OwnedProvider shelf={data.shelf}>
          <KeepPlayingProvider>
          <EditorsProvider>
          <DiscProvider>
            <ThisComputerProvider>
              <Where desktop={desktop}>
                <Window>{children}</Window>
              </Where>
            </ThisComputerProvider>
          </DiscProvider>
          </EditorsProvider>
          </KeepPlayingProvider>
        </OwnedProvider>
      </PlayerProvider>
    </AccountCtx.Provider>
    </DataCtx.Provider>
  );
}
