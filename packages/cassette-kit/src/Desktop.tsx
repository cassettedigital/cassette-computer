"use client";

/**
 * The parts a pointer and a keyboard want: the desktop app and the web player. The phone does these
 * jobs its own way (a swipe scrolls a shelf, a long press opens a menu, a tap plays), so these have no
 * iPhone twin; they are drawn from the same tokens so they sit beside the shared parts without a seam.
 *
 *   SongTable     songs as a table: number (a play glyph under the pointer), title with its art, artist,
 *                 record, length. A click picks a row, Shift and Command pick several (select.ts); only
 *                 the play glyph or Enter plays (the founder, 2026-11-06: a click never changes what's
 *                 on); the arrows move, a right click opens the menu for every picked row. The header
 *                 stays put while the list scrolls. With `onMove` a long press lifts a row to drag to a
 *                 new place (a line shows where it'll land); with `dragOut` a press that slides off at once
 *                 drags the picked rows out (onto a playlist; the host follows the pointer); with
 *                 `onDelete` the Delete key takes the picked rows out.
 *   ContextMenu   useContextMenu(): the right-click menu, at the pointer, kept inside the window,
 *                 arrows and Escape, closes on any click away or scroll; a few of its lines can wait
 *                 on an answer and change in place when it comes; a line can open a submenu beside it
 *                 (pointing at it, a click, or the right arrow), as a Mac's own menus do
 *   ShelfSection  a shelf's heading with paddles at its end (a mouse has no swipe), disabled at the ends;
 *                 whole tiles only, as many as the width holds, a paddle press a page of them
 *                 (with `flip`, a shelf of versions of itself: a paddle turns to the next version, one row of each)
 *   QuickCard     a compact card: small art, the name and one line, a play glyph at its end under the
 *                 pointer. Many at once, to get back into something in one click.
 *   Volume        the player's own loudness, a slim line between a quiet and a loud speaker (a Mac's
 *                 keys move the whole Mac; this moves the music). The phone leaves it to its buttons.
 *   Segmented     the one switch between a few choices: a sort, a view, a side view's tabs, a list's
 *                 filter. A thumb slides to the lit choice. `clearable` lets the lit one be pressed
 *                 again to light none (a filter that can show everything). `fill` stretches it to its
 *                 column; given `narrow` glyphs, it swaps its words for them when the words won't fit.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { Glyph } from "./Glyph";
import { TransportGlyph } from "./Glyph";
import { NOTHING_PICKED, pick, pickForMenu, pickHow, type Picked } from "./select";
import { PlayOver } from "./PlayOver";
import { useKitLink } from "./KitProvider";
import { Heading, Waveform } from "./Parts";
import s from "./kit.module.css";

/* ── the right-click menu ── */

/** A menu's line: an action, a quiet caption that isn't one (an account's address at its head), or a rule.
    Or lines still being asked about (a song's Copy Link while the cloud says whether it can be sent):
    `until` shows at once, and the answer's lines take their place when `later` settles, menu open.
    Or a line that opens a submenu of its own lines beside it ("Add to playlist" and every playlist, the
    founder 2026-11-21: one line instead of the whole list in the menu). */
export type MenuItem =
  | { label: string; onSelect: () => void; disabled?: boolean }
  | { label: string; submenu: MenuItem[]; disabled?: boolean }
  | { caption: string }
  | { later: Promise<MenuItem[]>; until: MenuItem[] }
  | "separator";
type MenuLine = Exclude<MenuItem, { later: Promise<MenuItem[]> }>;
type SubLine = Extract<MenuItem, { submenu: MenuItem[] }>;
const isLater = (it: MenuItem): it is Extract<MenuItem, { later: Promise<MenuItem[]> }> => typeof it === "object" && "later" in it;
const isSub = (it: MenuLine): it is SubLine => typeof it === "object" && "submenu" in it;
const settledLines = (list: MenuItem[]): MenuLine[] => list.flatMap((it) => (isLater(it) ? settledLines(it.until) : [it]));
/** the lines one level of a menu moves through with the arrows (not its submenu's) */
const linesOf = (el: HTMLElement | null, level: string) => Array.from(el?.querySelectorAll<HTMLElement>(`[data-level="${level}"]:not([disabled])`) ?? []);

export function useContextMenu() {
  const [at, setAt] = useState<{ x: number; y: number; items: MenuItem[]; n: number } | null>(null);
  const open = useCallback((e: MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    // a fresh menu each time, so an answer meant for the last one never lands in this one
    setAt((was) => ({ x: e.clientX, y: e.clientY, items, n: (was?.n ?? 0) + 1 }));
  }, []);
  const close = useCallback(() => setAt(null), []);
  const menu = at ? <ContextMenu key={at.n} x={at.x} y={at.y} items={at.items} onClose={close} /> : null;
  return { open, menu };
}

function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  // the answers that have come in, by the place of the line that asked
  const [settled, setSettled] = useState<ReadonlyMap<number, MenuItem[]>>(() => new Map());
  useEffect(() => {
    let open = true;
    items.forEach((it, i) => {
      if (isLater(it)) it.later.then((got) => open && setSettled((m) => new Map(m).set(i, got)), () => {});
    });
    return () => {
      open = false;
    };
  }, [items]);
  const lines = settledLines(items.flatMap((it, i) => (isLater(it) ? (settled.get(i) ?? it.until) : [it])));
  // the line whose submenu is open. Pointing at another line closes it after a moment, so the pointer can
  // cross a line or two on its way into the submenu without losing it; pointing into it keeps it.
  const [sub, setSub] = useState<number | null>(null);
  // opened from the keys (the right arrow, Enter): its first line takes them as it's drawn
  const [subKeys, setSubKeys] = useState(false);
  const leaving = useRef<number | undefined>(undefined);
  const point = (i: number | null) => {
    window.clearTimeout(leaving.current);
    setSubKeys(false);
    if (i !== null) setSub(i);
    else leaving.current = window.setTimeout(() => setSub(null), 260);
  };
  useEffect(() => () => window.clearTimeout(leaving.current), []);
  // kept inside the window: flip left or up when it would run off the edge (again if an answer grows it)
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: x + r.width > window.innerWidth - 8 ? Math.max(8, x - r.width) : x,
      top: y + r.height > window.innerHeight - 8 ? Math.max(8, y - r.height) : y,
    });
  }, [x, y, lines.length]);
  useLayoutEffect(() => {
    linesOf(ref.current, "top")[0]?.focus();
  }, [x, y]);
  useEffect(() => {
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // a long submenu scrolls on its own; any other scroll closes the menu
    const scrolled = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", away, true);
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = linesOf(ref.current, "top");
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setSub(null);
      list[(i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]?.focus();
    }
  };
  return (
    <div ref={ref} role="menu" className={s.cmenu} style={{ left: pos.left, top: pos.top }} onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()}>
      <MenuLines
        lines={lines}
        level="top"
        onClose={onClose}
        openSub={sub}
        point={point}
        renderSub={(it, i) => (
          <Submenu
            items={it.submenu}
            takeKeys={subKeys}
            onClose={onClose}
            onStay={() => point(i)}
            onBack={() => {
              setSub(null);
              linesOf(ref.current, "top").find((el) => el.dataset.line === String(i))?.focus();
            }}
          />
        )}
        openWithKey={(i) => {
          window.clearTimeout(leaving.current);
          setSubKeys(true);
          setSub(i);
        }}
      />
    </div>
  );
}

/** One level of a menu's lines. A line with a submenu holds it beside itself while it's open. */
function MenuLines({
  lines,
  level,
  onClose,
  openSub = null,
  point,
  renderSub,
  openWithKey,
}: {
  lines: MenuLine[];
  level: "top" | "sub";
  onClose: () => void;
  openSub?: number | null;
  point?: (i: number | null) => void;
  renderSub?: (it: SubLine, i: number) => ReactNode;
  openWithKey?: (i: number) => void;
}) {
  return (
    <>
      {lines.map((it, i) =>
        it === "separator" ? (
          <hr key={`sep-${i}`} className={s.cmenuSep} />
        ) : "caption" in it ? (
          <p key={`cap-${i}`} className={s.cmenuCaption}>
            {it.caption}
          </p>
        ) : isSub(it) ? (
          <div key={`sub-${i}-${it.label}`} className={s.cmenuHas} onMouseEnter={() => !it.disabled && point?.(i)} onMouseLeave={() => point?.(null)}>
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={openSub === i}
              data-level={level}
              data-line={i}
              data-open={openSub === i || undefined}
              className={`${s.cmenuItem} ${s.cmenuOpener}`}
              disabled={it.disabled}
              onClick={() => openWithKey?.(i)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  openWithKey?.(i);
                }
              }}
            >
              <span>{it.label}</span>
              <Glyph name="chevronRight" size={12} />
            </button>
            {openSub === i && renderSub?.(it, i)}
          </div>
        ) : (
          <button
            // two playlists can share a name
            key={`${i}-${it.label}`}
            type="button"
            role="menuitem"
            data-level={level}
            className={s.cmenuItem}
            disabled={it.disabled}
            onMouseEnter={() => point?.(null)}
            onClick={() => {
              onClose();
              it.onSelect();
            }}
          >
            {it.label}
          </button>
        ),
      )}
    </>
  );
}

/**
 * A submenu, beside the line that opened it: to its right, or to its left when the window's edge is near,
 * and lifted when it would run off the bottom; a long one scrolls. The arrows move in it; the left arrow
 * (or Escape) goes back to the line it came from.
 */
function Submenu({ items, takeKeys, onClose, onStay, onBack }: { items: MenuItem[]; takeKeys: boolean; onClose: () => void; onStay: () => void; onBack: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (takeKeys) linesOf(ref.current, "sub")[0]?.focus();
  }, [takeKeys]);
  const [place, setPlace] = useState<{ flip: boolean; lift: number }>({ flip: false, lift: 0 });
  const lines = settledLines(items);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const flip = r.right > window.innerWidth - 8;
    const lift = Math.max(0, r.bottom - (window.innerHeight - 8));
    setPlace({ flip, lift: Math.min(lift, Math.max(0, r.top - 8)) });
  }, [lines.length]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = linesOf(ref.current, "sub");
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      list[(i + (e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length]?.focus();
    } else if (e.key === "ArrowLeft" || e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onBack();
    }
  };
  return (
    <div
      ref={ref}
      role="menu"
      className={`${s.cmenu} ${s.cmenuSub}`}
      data-flip={place.flip || undefined}
      style={{ marginTop: -place.lift }}
      onMouseEnter={onStay}
      onKeyDown={onKey}
    >
      <MenuLines lines={lines} level="sub" onClose={onClose} />
    </div>
  );
}

/* ── the song table ── */

export type SongRow = {
  key: string;
  title: string;
  art?: ReactNode;
  artist: string;
  artistHref?: string;
  album?: string;
  albumHref?: string;
  length?: string | null;
  /** can play here (else dimmed, and Enter does nothing) */
  playable: boolean;
  /** this is the song playing; `live` when sound is coming */
  playing?: boolean;
  live?: boolean;
};

export function SongTable({
  rows,
  onPlay,
  menu,
  showAlbum = true,
  showArtist = true,
  label,
  onMove,
  dragOut,
  onDelete,
  look = "table",
}: {
  rows: SongRow[];
  onPlay: (index: number) => void;
  /** the right-click menu: the row clicked, and every row picked (it among them) */
  menu?: (index: number, picked: number[]) => MenuItem[];
  showAlbum?: boolean;
  /** off where every song is one artist's (their own page) */
  showArtist?: boolean;
  label: string;
  /** a row dragged from `from` to land before the row now at `to` (rows.length: at the end) */
  onMove?: (from: number, to: number) => void;
  /** a press that slides away before a long press would lift the row: the row pressed, every row picked (it
      among them), and the pointer, for the host to drag them out from (pointer events: see TrackRow) */
  dragOut?: (index: number, picked: number[], e: globalThis.PointerEvent) => void;
  /** the Delete or Backspace key: the row the keyboard is on, and every row picked */
  onDelete?: (index: number, picked: number[]) => void;
  /** "record": a record's own page, its songs and nothing else to sort them by: no column heads, roomier
      rows, the song that's on lit in the record's colour */
  look?: "table" | "record";
}) {
  const Link = useKitLink();
  const [picked, setPicked] = useState<Picked>(NOTHING_PICKED);
  // a new list (another record, a playlist reordered) starts with nothing picked
  const listKey = rows.map((r) => r.key).join("\u0000");
  useEffect(() => setPicked(NOTHING_PICKED), [listKey]);
  const at = picked.anchor;
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const cm = useContextMenu();
  const body = useRef<HTMLDivElement>(null);
  const id = useId();
  const focusRow = (i: number) => body.current?.querySelector<HTMLElement>(`[data-row="${i}"]`)?.focus();
  const onKey = (e: KeyboardEvent<HTMLDivElement>, i: number) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
      // Shift and an arrow pick the run from the row first picked, as a Mac list does
      setPicked((was) => (e.shiftKey ? pick({ rows: [], anchor: was.anchor }, n, "range") : pick(was, n, "one")));
      focusRow(n);
    } else if (e.key === "Enter" && rows[i]?.playable) {
      e.preventDefault();
      onPlay(i);
    } else if ((e.key === "Delete" || e.key === "Backspace") && onDelete) {
      e.preventDefault();
      onDelete(i, picked.rows.includes(i) ? picked.rows : [i]);
    }
  };
  // A move starts with a long press (a third of a second, held still), anywhere on the row: a click,
  // a double click and a quick press-and-slip never drag (2026-10-22: rows kept dragging when a song
  // was only being played). Then the row follows the pointer, the line goes above the row under it
  // (or below, past its middle), and letting go drops it there. Pointer events, not HTML drag and
  // drop: a browser decides at the press whether it can become a drag, too early for a long press.
  const press = useRef<{ i: number; x: number; y: number; timer: number } | null>(null);
  // the long press has lifted the row to move it: a slide now moves it, never drags it out
  const lifted = useRef(false);
  const dropAtFrom = (y: number) => {
    const list = Array.from(body.current?.querySelectorAll<HTMLElement>("[data-row]") ?? []);
    for (let j = 0; j < list.length; j++) {
      const r = list[j].getBoundingClientRect();
      if (y < r.top + r.height / 2) return j;
    }
    return list.length;
  };
  const endPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  const onPressStart = (e: PointerEvent<HTMLDivElement>, i: number) => {
    if ((!onMove && !dragOut) || e.button !== 0 || e.pointerType === "touch") return;
    const el = e.currentTarget;
    const pointer = e.pointerId;
    endPress();
    lifted.current = false;
    // a slide before the long press drags the picked rows out (the row alone when it isn't picked), watched on
    // the window, since a quick slide is off the row by its first move
    if (dragOut) {
      const x0 = e.clientX;
      const y0 = e.clientY;
      const was = picked;
      const slid = (ev: globalThis.PointerEvent) => {
        if (lifted.current) return stop();
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) <= 5) return;
        stop();
        endPress();
        const now = pickForMenu(was, i);
        setPicked(now);
        dragOut(i, now.rows, ev);
      };
      const stop = () => {
        window.removeEventListener("pointermove", slid);
        window.removeEventListener("pointerup", stop);
        window.removeEventListener("pointercancel", stop);
      };
      window.addEventListener("pointermove", slid);
      window.addEventListener("pointerup", stop);
      window.addEventListener("pointercancel", stop);
    }
    press.current = {
      i,
      x: e.clientX,
      y: e.clientY,
      timer: onMove
        ? window.setTimeout(() => {
            lifted.current = true;
            setDragFrom(i);
            setPicked({ rows: [i], anchor: i });
            setDropAt(i);
            el.setPointerCapture?.(pointer);
          }, 330)
        : 0,
    };
  };
  const onPressMove = (e: PointerEvent<HTMLDivElement>) => {
    if (dragFrom !== null) {
      setDropAt(dropAtFrom(e.clientY));
      return;
    }
    const p = press.current;
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 5) endPress();
  };
  const onPressEnd = () => {
    endPress();
    if (dragFrom !== null && dropAt !== null && dropAt !== dragFrom && dropAt !== dragFrom + 1) onMove?.(dragFrom, dropAt);
    setDragFrom(null);
    setDropAt(null);
  };
  return (
    <div className={s.table} role="grid" aria-multiselectable="true" aria-label={label} data-album={showAlbum || undefined} data-artist={showArtist || undefined} data-look={look} aria-describedby={`${id}-help`}>
      <span id={`${id}-help`} hidden>
        Press a song's number, or Enter, to play it. Shift or Command picks several.
      </span>
      <div className={s.tHead} role="row">
        <span role="columnheader" className={s.tNum}>
          #
        </span>
        <span role="columnheader">Title</span>
        {showArtist && <span role="columnheader">Artist</span>}
        {showAlbum && <span role="columnheader">Album</span>}
        <span role="columnheader" className={s.tLen}>
          Time
        </span>
      </div>
      <div ref={body} role="rowgroup">
        {rows.map((r, i) => (
          <div
            key={r.key}
            role="row"
            tabIndex={at === i || (at === null && i === 0) ? 0 : -1}
            data-row={i}
            aria-selected={picked.rows.includes(i)}
            data-on={r.playing || undefined}
            data-dim={!r.playable || undefined}
            // pointed at, the row shows its play triangle where the number is (the one hover-play)
            data-play-host={r.playable && !r.playing ? "" : undefined}
            className={s.tRow}
            data-movable={onMove ? "" : undefined}
            data-drag={dragFrom === i || undefined}
            data-drop={dragFrom === null ? undefined : dropAt === i ? "before" : dropAt === i + 1 && i === rows.length - 1 ? "after" : undefined}
            onPointerDown={onMove || dragOut ? (e) => onPressStart(e, i) : undefined}
            onPointerMove={onMove || dragOut ? onPressMove : undefined}
            onPointerUp={onMove || dragOut ? onPressEnd : undefined}
            onPointerCancel={onMove || dragOut ? onPressEnd : undefined}
            // the row's art and links never start the browser's own drag (it would take the pointer away)
            onDragStart={dragOut ? (e) => e.preventDefault() : undefined}
            onClick={(e) => setPicked((was) => pick(was, i, pickHow(e)))}
            // Shift-click picks a run of rows, not the text between them
            onMouseDown={(e) => e.shiftKey && e.preventDefault()}
            onKeyDown={(e) => onKey(e, i)}
            onContextMenu={
              menu
                ? (e) => {
                    const now = pickForMenu(picked, i);
                    setPicked(now);
                    cm.open(e, menu(i, now.rows));
                  }
                : undefined
            }
          >
            <span role="gridcell" className={s.tNum}>
              {r.playing ? (
                <Waveform live={!!r.live} />
              ) : (
                <>
                  <span className={s.tIndex}>{i + 1}</span>
                  {r.playable && (
                    <button
                      type="button"
                      className={s.tPlay}
                      tabIndex={-1}
                      aria-label={`Play ${r.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onPlay(i);
                      }}
                    >
                      <PlayOver bare size={14} align="center" />
                    </button>
                  )}
                </>
              )}
            </span>
            <span role="gridcell" className={s.tTitle}>
              {r.art && <span className={s.tArt}>{r.art}</span>}
              <span className={s.tTitleText}>{r.title}</span>
            </span>
            {showArtist && (
              <span role="gridcell" className={s.tCell}>
                {r.artistHref ? (
                  <Link href={r.artistHref} className={s.tLink} tabIndex={-1}>
                    {r.artist}
                  </Link>
                ) : (
                  r.artist
                )}
              </span>
            )}
            {showAlbum && (
              <span role="gridcell" className={s.tCell}>
                {r.albumHref ? (
                  <Link href={r.albumHref} className={s.tLink} tabIndex={-1}>
                    {r.album}
                  </Link>
                ) : (
                  r.album
                )}
              </span>
            )}
            <span role="gridcell" className={s.tLen}>
              {r.length}
            </span>
          </div>
        ))}
      </div>
      {cm.menu}
    </div>
  );
}

/* ── a shelf with paddles ── */

/** The tiles in a shelf's view come in one after another (kit.module.css .shelf > li[data-in]): each takes its
 *  place in the order as --in, and the mark is taken off and put back so a second turn plays it again. */
function cascade(el: HTMLElement) {
  const view = el.getBoundingClientRect();
  let i = 0;
  for (const li of Array.from(el.children) as HTMLElement[]) {
    li.removeAttribute("data-in");
    const r = li.getBoundingClientRect();
    if (r.width === 0 || r.right <= view.left + 1 || r.left >= view.right - 1) continue;
    li.style.setProperty("--in", String(i++));
    void li.offsetWidth;
    li.setAttribute("data-in", "");
  }
}

export function ShelfSection({
  shout,
  answer,
  href,
  head,
  flip,
  children,
}: {
  shout: string;
  answer?: string;
  href?: string;
  /** A heading of the host's own in place of the kit's (Discover's lanes, with their play key). The
      shout still names the paddles and the list for a screen reader. */
  head?: ReactNode;
  /** A shelf of several versions of itself (Discover's: one genre heard several ways): the paddles turn to the
      version before or after instead of paging along the tiles, and a computer shows one whole row of each (a
      phone still swipes it). `at` is the version on show, so a turn starts its row at the beginning. */
  flip?: { at: number; back: () => void; next: () => void; backLabel: string; nextLabel: string };
  children: ReactNode;
}) {
  const list = useRef<HTMLOListElement>(null);
  const [ends, setEnds] = useState({ start: true, end: true });
  // a new version starts at its beginning and comes in as a page does (never on the shelf's first drawing)
  const drawn = useRef(false);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    el.scrollTo({ left: 0 });
    if (drawn.current) cascade(el);
    drawn.current = true;
  }, [flip?.at]);
  // the paddles' ends, set only when they change (a fresh object every read would draw the shelf again for nothing)
  const readEnds = useRef<() => void>(() => {});
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const read = () => {
      const start = el.scrollLeft <= 2;
      const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
      setEnds((was) => (was.start === start && was.end === end ? was : { start, end }));
    };
    readEnds.current = read;
    read();
    el.addEventListener("scroll", read, { passive: true });
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", read);
      ro.disconnect();
    };
  }, []);
  // a page is the tiles in view: the shelf shows whole tiles, so the next page starts on a whole one. It turns
  // at once and the new tiles come in one after another, never a slide (the founder, 2026-11-18: every shelf
  // pages the way a shelf of versions turns, "cascade/fade in, rather than slide")
  const page = (dir: 1 | -1) => {
    const el = list.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const inner = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    el.scrollBy({ left: dir * (inner + parseFloat(cs.columnGap || "0")), behavior: "instant" });
    cascade(el);
  };
  // whole pages only, on a computer: fewer than two pages' worth shows one page and no paddles; more shows as many
  // whole pages as it fills. A phone swipes, so it keeps them all. Read again whenever the width (so the columns) or
  // the tiles change.
  // (only when the width or the tiles change: a ResizeObserver and a MutationObserver, never every drawing)
  const isFlip = !!flip;
  useLayoutEffect(() => {
    const el = list.current;
    if (!el || isFlip) return;
    let cols = -1;
    let count = -1;
    const fit = () => {
      const c = Number(getComputedStyle(el).getPropertyValue("--cols")) || 0;
      const kids = Array.from(el.children) as HTMLElement[];
      if (c === cols && kids.length === count) return;
      cols = c;
      count = kids.length;
      const n = kids.length;
      const pointer = window.matchMedia("(hover: hover)").matches;
      const keep = !pointer || !c || n <= c ? n : n < 2 * c ? c : Math.floor(n / c) * c;
      kids.forEach((li, i) => {
        if (li.hasAttribute("data-cull") !== i >= keep) li.toggleAttribute("data-cull", i >= keep);
      });
      readEnds.current();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    const mo = new MutationObserver(fit);
    mo.observe(el, { childList: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [isFlip]);
  const still = ends.start && ends.end;
  return (
    <section className={s.shelfSection} data-flip={flip ? "" : undefined}>
      <div className={s.shelfHead}>
        {head ?? <Heading shout={shout} answer={answer} href={href} />}
        {flip ? (
          <span className={s.paddles}>
            <button type="button" className={s.paddle} aria-label={flip.backLabel} onClick={flip.back}>
              <Glyph name="chevronRight" size={13} className={s.paddleBack} />
            </button>
            <button type="button" className={s.paddle} aria-label={flip.nextLabel} onClick={flip.next}>
              <Glyph name="chevronRight" size={13} />
            </button>
          </span>
        ) : !still && (
          <span className={s.paddles}>
            <button type="button" className={s.paddle} aria-label={`Back through ${shout}`} disabled={ends.start} onClick={() => page(-1)}>
              <Glyph name="chevronRight" size={13} className={s.paddleBack} />
            </button>
            <button type="button" className={s.paddle} aria-label={`More ${shout}`} disabled={ends.end} onClick={() => page(1)}>
              <Glyph name="chevronRight" size={13} />
            </button>
          </span>
        )}
      </div>
      <ol ref={list} className={s.shelf} aria-label={`${shout} ${answer ?? ""}`.trim()}>
        {children}
      </ol>
    </section>
  );
}

/* ── the quick card ── */

export function QuickCard({
  art,
  title,
  line,
  href,
  playing,
  live,
  onPlay,
  playLabel,
  tint,
  onContextMenu,
  selected,
  onSelect,
  onOpen,
}: {
  art: ReactNode;
  title: string;
  line?: string;
  href?: string;
  playing?: boolean;
  live?: boolean;
  onPlay?: () => void;
  playLabel?: string;
  /** the record's colour: the card takes a wash of it under the pointer */
  tint?: string;
  onContextMenu?: (e: MouseEvent) => void;
  /** as Tile's: a click on the card selects it (onSelect), a click on the name goes to its page (with no
      href the card is a button that selects); onOpen is a double click, for a host that wants one */
  selected?: boolean;
  onSelect?: (e: MouseEvent) => void;
  onOpen?: () => void;
}) {
  const Link = useKitLink();
  const plain = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
  const onName = (e: MouseEvent) => !!href && !!(e.target as Element).closest?.(`.${s.qTitle}`);
  const pick = onSelect ? (e: MouseEvent) => plain(e) && !onName(e) && onSelect(e) : undefined;
  const open = onOpen
    ? (e: MouseEvent) => {
        if (!plain(e) || onName(e)) return;
        e.preventDefault();
        onOpen();
      }
    : undefined;
  const face = (
    <>
      <span className={s.qArt}>{art}</span>
      <span className={s.qText}>
        <span className={s.qTitle}>{title}</span>
        {line && <span className={s.qLine}>{line}</span>}
      </span>
    </>
  );
  return (
    <li className={s.quick} data-on={playing || undefined} data-selected={selected || undefined} style={tint ? ({ "--q": tint } as CSSProperties) : undefined} onContextMenu={onContextMenu}>
      {href ? (
        <Link href={href} className={s.qBody} onClick={pick} onDoubleClick={open}>
          {face}
        </Link>
      ) : onSelect ? (
        <button type="button" className={s.qBody} onClick={pick} onDoubleClick={open}>
          {face}
        </button>
      ) : (
        <span className={s.qBody} onClick={pick} onDoubleClick={open}>
          {face}
        </span>
      )}
      <span className={s.qEnd}>
        {playing ? (
          <Waveform live={!!live} />
        ) : (
          onPlay && (
            <button type="button" className={s.qPlay} aria-label={playLabel ?? `Play ${title}`} onClick={onPlay}>
              <TransportGlyph name="play" size={14} />
            </button>
          )
        )}
      </span>
    </li>
  );
}

/* ── the volume ── */

/** A loudness slider. The quiet speaker mutes, and pressed again brings back the level it was at. */
export function Volume({ value, onChange, label = "Volume" }: { value: number; onChange: (v: number) => void; label?: string }) {
  const v = Math.max(0, Math.min(1, value));
  const before = useRef(v > 0 ? v : 0.5);
  if (v > 0) before.current = v;
  return (
    <span className={s.volume}>
      <button
        type="button"
        className={s.volumeMute}
        aria-label={v > 0 ? "Mute" : "Unmute"}
        title={v > 0 ? "Mute" : "Unmute"}
        aria-pressed={v === 0}
        onClick={() => onChange(v > 0 ? 0 : before.current)}
      >
        <Glyph name={v > 0 ? "volumeLow" : "volumeMute"} size={13} />
      </button>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={Math.round(v * 100)}
        aria-label={label}
        aria-valuetext={`${Math.round(v * 100)}%`}
        onChange={(e) => onChange(Number(e.currentTarget.value) / 100)}
        onKeyDown={(e) => e.stopPropagation()}
        style={{ "--v": `${v * 100}%` } as CSSProperties}
      />
      <Glyph name="volumeHigh" size={13} />
    </span>
  );
}

/* ── the segmented switch ── */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "regular",
  clearable,
  fill,
  narrow,
}: {
  value: T | null;
  /** [value, word] or [value, word, glyph]: with a glyph the word is the spoken name and the tooltip */
  options: Array<[T, string] | [T, string, ReactNode]>;
  onChange: (v: T | null) => void;
  label: string;
  size?: "regular" | "small";
  /** pressing the lit choice lights none */
  clearable?: boolean;
  /** stretch to the column's width, the choices sharing it */
  fill?: boolean;
  /** glyphs to show in place of the words when the column is too narrow for them */
  narrow?: Partial<Record<T, ReactNode>>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  const keys = options.map((o) => o[0]).join("|");
  const [tight, setTight] = useState(false);
  const hasNarrow = !!narrow;
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      // too narrow for the words: each choice's word wider than its share of the switch
      if (hasNarrow) {
        const words = Array.from(el.querySelectorAll<HTMLElement>("[data-word]"));
        const need = words.reduce((n, w) => n + w.scrollWidth + 18, 6);
        setTight(need > el.clientWidth + 1);
      }
      const on = el.querySelector<HTMLElement>('[aria-checked="true"]');
      const next = on ? { x: on.offsetLeft, w: on.offsetWidth } : null;
      setThumb((t) => (t?.x === next?.x && t?.w === next?.w ? t : next));
    };
    measure();
    // the switch and each choice: a choice's width settles late (its font arrives, the window was
    // out of sight while it was laid out), and the thumb follows it
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.querySelectorAll("button").forEach((b) => ro.observe(b));
    document.fonts?.ready.then(measure).catch(() => {});
    return () => ro.disconnect();
  }, [value, keys, hasNarrow, tight]);
  return (
    <div ref={box} className={s.seg} data-size={size} data-fill={fill || undefined} data-tight={tight || undefined} role="radiogroup" aria-label={label}>
      {/* drawn once it's measured (no fade in: a window out of sight runs no transitions, and a thumb
          fading in from nothing stayed invisible until it was looked at) */}
      {thumb && <i className={s.segThumb} style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w }} aria-hidden="true" />}
      {options.map(([v, text, glyph]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          aria-label={glyph || tight ? text : undefined}
          title={glyph || tight ? text : undefined}
          data-glyph={glyph ? "" : undefined}
          onClick={() => onChange(clearable && value === v ? null : v)}
        >
          {glyph ?? (
            <>
              <span data-word="">{text}</span>
              {narrow?.[v] && <span data-narrow="">{narrow[v]}</span>}
            </>
          )}
        </button>
      ))}
    </div>
  );
}
