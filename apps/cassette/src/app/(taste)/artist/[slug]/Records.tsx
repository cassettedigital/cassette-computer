"use client";

/**
 * 2. The records: every release in one list, studio albums newest first by default, with the view
 * options (a small sliders key right after the head, the shared menu) to sort it the other way or show
 * their EPs and singles, live records or everything (each kind offered only when they have one; the
 * choice is remembered). A row is the title and the year; when the view mixes kinds (Everything, and EPs
 * & singles holding both) every row also says what it is, Album included, in one aligned column. The open record is marked with
 * the printer's pointing hand and shows its cover (the way into its page), its size, then two buttons
 * side by side, Preview album and the way into its reviews (or its page), always at the same height,
 * then one writer's line from that album's own reviews when one reads cleanly here (the shared inline
 * quote). Wide: beside the list, every record's view in one grid cell so nothing jumps. Phone: under its
 * row. Each row carries its record's colour (the same one its album page shows) for the hand and the
 * quote's chip. The record's two buttons are Preview album and Buy (the album page's own Buy menu, the
 * founder, 2026-11-06: "buy albums right from the artist page"); its reviews are a line under the quote.
 *
 * A long discography opens on its best-known records (the founder, 2026-11-06: a list like David Bowie's is
 * too long to focus on). Past LONG_AT rows in the default view, only the TOP most popular studio albums show,
 * in the list's own order, with the next few fading away under them and one "All N albums" to open the rest.
 * Opening it fills in the whole sequence where it belongs, each record growing open between the ones already
 * there, top to bottom, and only then do the view options come in beside the head: they are for the whole
 * list. A remembered view (Everything, oldest first) still opens on the best-known, in that view's order,
 * and is what the whole list opens in (the founder had Everything remembered and never saw the opening).
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Icon } from "@/app/_taste/Icon";
import { useSession } from "next-auth/react";
import { ArrowLink } from "@/app/_taste/Button";
import { BuyMenu } from "@/app/(taste)/album/[slug]/BuyMenu";
import type { Surface } from "@/lib/app-surface";
import Link from "next/link";
import { buttonClass } from "@/app/_taste/Button";
import { accentVars } from "@/app/_taste/colour";
import { CoverArt } from "@/app/_taste/Cover";
import { PlayButton } from "@/app/_taste/PlayButton";
import { PointingHand } from "@/app/_taste/PointingHand";
import { Quote } from "@/app/_taste/Quote";
import { SectionHead } from "@/app/_taste/SectionHead";
import { Sleeve } from "@/app/_taste/Sleeve";
import k from "@/app/_taste/taste.module.css";
import { albumHref } from "@/app/_taste/links";
import { usePlayer } from "@/app/_taste/player";
import { DEFAULT_VIEW, arrange, landShow, selectionLine, showOptions, showsKinds } from "../_lib/rules";
import type { ArtistPayload, RecordItem, RecordLine, RecordShow, RecordSort } from "../_lib/types";
import { ViewMenu } from "./ViewMenu";
import s from "./artist.module.css";

const VIEW_KEY = "proto-taste.records-view";
type View = { sort: RecordSort; show: RecordShow };

/** A list longer than this, in the default view, opens on its best-known records. */
const LONG_AT = 12;
/** How many of the most popular studio albums it opens on: as many as stand beside the record's panel, so
 *  the two sides balance, and never fewer than MIN_TOP (the founder, 2026-11-06); a phone, with no panel
 *  beside the list, opens on MIN_TOP. TOP_FEWEST: the fewest best-known in a view that make it worth doing. */
const MIN_TOP = 6;
const TOP_FEWEST = 4;
/** How many of the rest show under them, fading away. */
const TAIL = 2;

/** One writer's line, credited: the shared inline quote, beside the list or under a row. */
function Line({ l }: { l: RecordLine }) {
  return <Quote size="inline" className={s.line} quote={l.quote} length={l.size} by={{ outlet: l.outlet, url: l.url, icon: l.icon, glyph: l.glyph }} />;
}

/**
 * Preview album: the shared play button on one line (the founder, 2026-10-21: the song's name beside
 * "Read all reviews" was more than the row could hold). It plays the record from its start song and
 * round, as Hear it does on the album page, and says Playing or Paused while a song of it is docked.
 */
function Preview({ r }: { r: RecordItem }) {
  const { track, status, playList, toggle } = usePlayer();
  if (!r.hear) return null;
  const { queue, start } = r.hear;
  const mine = !!track && queue.some((x) => x.trackId === track.trackId);
  return (
    <PlayButton
      className={s.act}
      state={mine ? status : "idle"}
      verb="Preview album"
      aria-pressed={mine && status === "playing"}
      aria-label={!mine ? `Preview ${r.title}, from ${queue[start].title}` : status === "paused" ? `Resume ${r.title}` : `Pause ${r.title}`}
      onClick={() => (mine ? toggle() : playList(queue, start, { wrap: true }))}
    />
  );
}

/** The way into its reviews (or its page): a plain arrow line under the quote, no longer a button. */
function ReadLink({ r }: { r: RecordItem }) {
  return (
    <ArrowLink href={r.read.href} className={s.readMore}>
      {r.read.label}
    </ArrowLink>
  );
}

/** Buy: the album page's own menu, each record its own list. Signed in or out says whether the artist's own
 *  store checks out here or asks to sign in first. */
function Buy({ r, surface }: { r: RecordItem; surface: Surface }) {
  const { status } = useSession();
  if (!r.buy) return null;
  return <BuyMenu slug={r.slug} options={r.buy.options} pick={r.buy.pick} apple={r.buy.apple} signedIn={status === "authenticated"} surface={surface} />;
}

/** The record's two buttons, Preview album and Buy, side by side while they fit, each its own row on a
 *  phone; with neither (no preview, nowhere sells it), the way into the album stands in. */
function Acts({ r, surface }: { r: RecordItem; surface: Surface }) {
  return (
    <div className={s.viewActs}>
      <Preview r={r} />
      <Buy r={r} surface={surface} />
      {!r.hear && !r.buy && (
        <Link href={albumHref(r.slug)} className={buttonClass("outlined", s.act)}>
          Open the album
        </Link>
      )}
    </div>
  );
}

/** The record's cover, a link into its page; with no cover, the kit's dark box with the title typeset. Its box is
 *  320px in the panel beside the list and 104px under an open row (artist.module.css .viewCover, .inlineCover), so
 *  the panel asks for the same size as the header's lead cover and the two share one download; and it loads lazily,
 *  so the copy a screen hides (the panel on a phone, the open row on a wide screen) is never fetched (BUG-998). */
function Cover({ r, big, className, mounted }: { r: RecordItem; big: boolean; className: string; mounted: boolean }) {
  return (
    <Link href={albumHref(r.slug)} className={className} aria-label={`Open ${r.title}`}>
      <CoverArt>
        <Sleeve
          src={mounted ? (big ? (r.cover ?? r.coverSmall) : (r.coverSmall ?? r.cover)) : null}
          title={r.title}
          sizes={big ? "320px" : "104px"}
        />
      </CoverArt>
    </Link>
  );
}

/** A record beside the list (wide). Its cover mounts once it has been pointed at or opened, and stays. */
function RecordView({ r, on, mounted, colour, surface }: { r: RecordItem; on: boolean; mounted: boolean; colour: string | undefined; surface: Surface }) {
  return (
    <article
      id={`rec-${r.slug}`}
      className={s.view}
      data-on={on || undefined}
      aria-hidden={!on || undefined}
      inert={!on || undefined}
      style={colour ? accentVars(colour) : undefined}
    >
      <Cover r={r} big className={s.viewCover} mounted={mounted} />
      <p className={s.viewMeta}>{r.meta ?? ""}</p>
      <Acts r={r} surface={surface} />
      {r.line && <Line l={r.line} />}
      <ReadLink r={r} />
    </article>
  );
}

/** The open record under its row (phone): the row above already names it and its year. The cover with
 *  its size beside it, the two buttons, then the line. */
function InlineRecord({ r, surface }: { r: RecordItem; surface: Surface }) {
  return (
    <>
      <div className={s.inlineTop}>
        <Cover r={r} big={false} className={s.inlineCover} mounted />
        {r.meta && <p className={s.viewMeta}>{r.meta}</p>}
      </div>
      <Acts r={r} surface={surface} />
      {r.line && <Line l={r.line} />}
      <ReadLink r={r} />
    </>
  );
}

export function Records({
  p,
  colours,
  onWant,
  surface = "web",
}: {
  p: ArtistPayload;
  colours: Record<string, string>;
  onWant: (slug: string) => void;
  surface?: Surface;
}) {
  const { records } = p;
  const shows = useMemo(() => showOptions(records), [records]);
  const [view, setView] = useState<View>(() => ({ sort: DEFAULT_VIEW.sort, show: landShow(DEFAULT_VIEW.show, shows) }));
  const rows = useMemo(() => arrange(records, view), [records, view]);
  const firstOf = (list: RecordItem[]) => (list.some((r) => r.slug === p.leadSlug) ? p.leadSlug : (list[0]?.slug ?? null));
  const [open, setOpen] = useState<string | null>(() => firstOf(rows));
  const [seen, setSeen] = useState<Set<string>>(() => new Set(open ? [open] : []));
  // the whole list, once asked for; the records filling in as it opens, each with its place in the cascade
  const [full, setFull] = useState(false);
  const [entering, setEntering] = useState<Map<string, number> | null>(null);
  const [topN, setTopN] = useState(MIN_TOP);
  const top = useMemo(() => new Set(p.albums.slice(0, topN)), [p.albums, topN]);
  // whatever view is remembered, a long list opens on its best-known records in that view's order; the view
  // itself (Everything, oldest first) is what the whole list opens in
  const topRows = rows.filter((r) => top.has(r.slug));
  const brief = !full && rows.length > LONG_AT && topRows.length >= TOP_FEWEST;
  const listed = brief ? topRows : rows;
  const tail = brief ? rows.filter((r) => !top.has(r.slug)).slice(0, TAIL) : [];

  /** Open the whole list: the records not shown yet grow in where they belong, top to bottom. */
  const showAll = () => {
    const shownNow = new Set(listed.map((r) => r.slug));
    const order = new Map<string, number>();
    rows.forEach((r) => {
      if (!shownNow.has(r.slug)) order.set(r.slug, order.size);
    });
    setEntering(order);
    setFull(true);
  };
  // the first record that came in takes the focus (the button that asked is gone); the cascade's marks
  // come off once it has played, so a later re-render never plays it again
  // While it grows, the window keeps still: the browser's scroll anchoring would otherwise hold whatever is
  // below the list in place and carry the page down as the list grows above it.
  useEffect(() => {
    if (!entering) return;
    const root = document.documentElement;
    root.style.overflowAnchor = "none";
    const first = [...entering.entries()].find(([, i]) => i === 0)?.[0];
    if (first) document.getElementById(`row-${first}`)?.querySelector("button")?.focus({ preventScroll: true });
    const t = window.setTimeout(() => setEntering(null), 1600);
    return () => {
      window.clearTimeout(t);
      root.style.overflowAnchor = "";
    };
  }, [entering]);

  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The opening's length, in single-line rows: as tall as the panel beside it (its tallest record: every view
  // shares one cell), but never so tall that the head and "All N" can't share the window under the masthead
  // (the founder asked for both, 2026-11-06), and never under MIN_TOP. Measured again as either changes size.
  useEffect(() => {
    const panel = panelRef.current;
    const list = listRef.current;
    const head = list?.closest("section")?.querySelector("h2");
    if (!panel || !list || !head) return;
    const measure = () => {
      const rows = [...list.querySelectorAll<HTMLElement>(":scope > ol:first-child > li")];
      const rowH = Math.min(...rows.map((li) => li.getBoundingClientRect().height).filter((h) => h > 0), 56);
      const tailH = list.querySelector<HTMLElement>(":scope > ol:nth-of-type(2)")?.getBoundingClientRect().height ?? 0;
      const moreH = list.querySelector<HTMLElement>(":scope > button")?.getBoundingClientRect().height ?? 0;
      const panelH = panel.getBoundingClientRect().height;
      if (panelH <= 0) return setTopN(MIN_TOP); // a phone: no panel beside the list
      const besidePanel = Math.floor((panelH - tailH - moreH - 8) / rowH);
      // the masthead's room at the window's top (it shows again on any scroll up), or where the panel sticks
      const masthead = Math.max(parseFloat(getComputedStyle(panel).top) || 0, 72);
      const headRoom = list.getBoundingClientRect().top - head.getBoundingClientRect().top;
      const onScreen = Math.floor((window.innerHeight - masthead - headRoom - tailH - moreH - 24) / rowH);
      setTopN(Math.max(MIN_TOP, Math.min(besidePanel, onScreen)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(panel);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  const anchor = useRef<{ slug: string; top: number } | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  const isWide = () => (listRef.current?.closest("main")?.clientWidth ?? window.innerWidth) >= 760;
  const touch = (slug: string) => {
    onWant(slug);
    setSeen((x) => (x.has(slug) ? x : new Set(x).add(slug)));
  };

  /** A new view; when the open record is not in it, the lead or the first row opens instead (a phone
   *  the person is tapping on closes it rather than opening something they did not pick). */
  const apply = (next: View, byHand: boolean) => {
    setView(next);
    const list = arrange(records, next);
    if (list.some((r) => r.slug === openRef.current)) return;
    const to = byHand && !isWide() ? null : firstOf(list);
    setOpen(to);
    if (to) touch(to);
  };

  // the remembered view, applied once mounted (storage may be blocked or empty: the default stands)
  useEffect(() => {
    let saved: Partial<View> | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(VIEW_KEY) ?? "null") as Partial<View> | null;
    } catch {
      saved = null;
    }
    if (!saved || typeof saved !== "object") return;
    const next: View = { sort: saved.sort === "oldest" ? "oldest" : "newest", show: landShow(saved.show, shows) };
    if (next.sort !== DEFAULT_VIEW.sort || next.show !== landShow(DEFAULT_VIEW.show, shows)) apply(next, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const change = (next: View) => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(next));
    } catch {
      // storage blocked: the choice lasts this visit
    }
    apply(next, true);
  };

  const pick = (slug: string, btn: HTMLElement) => {
    touch(slug);
    if (isWide()) {
      setOpen(slug);
      return;
    }
    // a phone: tapping the open row closes it; the tapped row stays under the finger
    anchor.current = { slug, top: btn.getBoundingClientRect().top };
    setOpen((o) => (o === slug ? null : slug));
  };
  useLayoutEffect(() => {
    const a = anchor.current;
    anchor.current = null;
    if (!a) return;
    const btn = document.getElementById(`row-${a.slug}`)?.querySelector("button");
    if (!btn) return;
    const d = btn.getBoundingClientRect().top - a.top;
    // instant: the site scrolls smoothly by default, which would carry the row away and back
    if (Math.abs(d) > 1) window.scrollBy({ top: d, behavior: "instant" });
  }, [open]);

  // wide: the panel always shows one record, the open one or else the first row
  const shown = open ?? rows[0]?.slug ?? null;
  // the record on show beside the list wears its colour
  useEffect(() => {
    if (shown) onWant(shown);
  }, [shown, onWant]);
  // what each row is, in one aligned column, when the view mixes kinds; sized to the longest word
  const kinds = showsKinds(rows);
  const kindChars = kinds ? Math.max(...rows.map((r) => r.kind.length)) : 0;

  if (records.length === 0) return null;

  return (
    <section className={`${k.ed} ${s.records}`} aria-labelledby="records-title">
      <div className={k.wrap}>
        <SectionHead
          id="records-title"
          after={
            !brief &&
            (records.length > 1 || shows.length > 0) && (
              <span className={s.viewIn} data-in={entering ? "" : undefined}>
                <ViewMenu view={view} shows={shows} onChange={change} />
              </span>
            )
          }
        >
          The records.
        </SectionHead>

        <div className={s.recBody}>
          <div
            ref={listRef}
            className={s.list}
            data-long={rows.length > 10 || undefined}
            data-kinds={kinds || undefined}
            style={kinds ? ({ "--kn": kindChars } as CSSProperties) : undefined}
          >
            <ol className={s.rows}>
              {listed.map((r) => {
                const isOpen = r.slug === open;
                const colour = colours[r.slug];
                const enter = entering?.get(r.slug);
                return (
                  <li
                    key={r.slug}
                    id={`row-${r.slug}`}
                    className={s.row}
                    data-open={isOpen || undefined}
                    data-in={enter !== undefined || undefined}
                    style={{ ...(colour ? accentVars(colour) : {}), ...(enter !== undefined ? { "--in": enter } : {}) } as CSSProperties}
                  >
                    <button
                      type="button"
                      className={s.rowBtn}
                      aria-expanded={isOpen}
                      aria-controls={`rec-${r.slug} rec-${r.slug}-inline`}
                      onClick={(e) => pick(r.slug, e.currentTarget)}
                      onPointerEnter={() => touch(r.slug)}
                      onFocus={() => touch(r.slug)}
                    >
                      <PointingHand on={isOpen} />
                      <span className={s.rowTitle}>{r.title}</span>
                      {kinds && <span className={s.rowKind}>{r.kind}</span>}
                      <span className={s.rowYear}>{r.year ?? ""}</span>
                    </button>
                    <div id={`rec-${r.slug}-inline`} className={s.inline} hidden={!isOpen}>
                      {isOpen && <InlineRecord r={r} surface={surface} />}
                    </div>
                  </li>
                );
              })}
            </ol>
            {brief && (
              <>
                {/* the rest, fading away under the best-known: a glimpse, not a way in */}
                <ol className={`${s.rows} ${s.tail}`} aria-hidden="true">
                  {tail.map((r) => (
                    <li key={r.slug} className={s.row}>
                      <span className={s.rowBtn}>
                        <span className={s.rowTitle}>{r.title}</span>
                        {kinds && <span className={s.rowKind}>{r.kind}</span>}
                        <span className={s.rowYear}>{r.year ?? ""}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                <button type="button" className={s.more} onClick={showAll}>
                  All {rows.length} {view.show === "album" ? "albums" : "records"}
                  <Icon name="chevron" size={12} />
                </button>
              </>
            )}
            {p.recordsOf != null && selectionLine(records.length, p.recordsOf) && (
              <p className={s.selection}>{selectionLine(records.length, p.recordsOf)}</p>
            )}
          </div>

          <div ref={panelRef} className={s.panel}>
            {records.map((r) => (
              <RecordView key={r.slug} r={r} on={r.slug === shown} mounted={seen.has(r.slug) || r.slug === shown} colour={colours[r.slug]} surface={surface} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
