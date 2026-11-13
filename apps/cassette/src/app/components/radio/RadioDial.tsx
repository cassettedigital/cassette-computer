"use client";

/**
 * The Radio page's body: what's on now across your stations, a section rail to jump with, and the whole dial in
 * two columns. One page for both windows that draw it, so they stay the same page (the founder, 2026-11-09:
 * "kept the radio tab in the web view, exactly as it is in desktop view"): the Mac app's library window
 * (desk/radio, desk/Shelves Radio) and the website's account window (account/radio).
 *
 * The window says how a station is looked into (the desk's side view; the account window's panel, where the
 * station's own page opens beside the dial), what its right click offers, and its play disc. A click on a
 * station looks into it; only the play disc tunes in, so a click never changes what's on.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Heading, PlayDisc, StationRow, WordArt, type TilePlay } from "@discovery/cassette-kit";
import { Art } from "@/app/desk/Art";
import { dailyTurn } from "@/lib/radio/daily-turn";
import type { DialStation, RadioNowPlaying } from "@/lib/radio/types";
import { useRadio } from "./RadioProvider";
import r from "./RadioDial.module.css";

/** A station looked into: whether it's the one shown beside the dial, and the click that shows it. */
export type StationLook = { selected: boolean; onSelect: (e: MouseEvent) => void };

export type RadioDialProps = {
  stations: DialStation[];
  /** the person's saved stations' slugs, newest saved first */
  saved: string[];
  /** a station's play disc: tune in, or stop while it's on */
  disc: (s: Pick<DialStation, "slug" | "name">) => TilePlay;
  look: (slug: string) => StationLook;
  /** a station's right-click menu */
  menuFor?: (slug: string) => (e: MouseEvent) => void;
};

/** What's on a station now, read once when its card shows (the route caches it 15 seconds): undefined
    while asking, null when the station said nothing. */
function useOnAir(slug: string, on: boolean) {
  const [np, setNp] = useState<RadioNowPlaying | null | undefined>(on ? undefined : null);
  useEffect(() => {
    if (!on) return;
    let gone = false;
    fetch(`/api/radio/now-playing?station=${encodeURIComponent(slug)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((j) => !gone && setNp(j))
      .catch(() => !gone && setNp(null));
    return () => {
      gone = true;
    };
  }, [slug, on]);
  return np;
}

/** How long a cover gets to arrive before the card settles without it (its mark stays whole). */
const COVER_WAIT_MS = 6000;
/** The beat between one On now card settling and the next (the founder, 2026-11-07: "load sequentially"). */
const TURN_MS = 260;

/**
 * On now's cards change one after another, in reading order: a card settles once what it's playing is
 * known and its cover has fully arrived, and only after the card before it has. The list's own order
 * restarts the turns (your saved stations arriving first, say).
 */
function useTurns(order: string[]) {
  const key = order.join("|");
  const [ready, setReady] = useState<{ key: string; slugs: Set<string> }>({ key, slugs: new Set() });
  const [turn, setTurn] = useState<{ key: string; at: number }>({ key, at: 0 });
  const slugs = ready.key === key ? ready.slugs : new Set<string>();
  const at = turn.key === key ? turn.at : 0;
  useEffect(() => {
    const next = order[at];
    if (!next || !slugs.has(next)) return;
    const t = window.setTimeout(() => setTurn({ key, at: at + 1 }), TURN_MS);
    return () => window.clearTimeout(t);
  }, [key, at, slugs, order]);
  const markReady = useCallback(
    (slug: string) => setReady((x) => (x.key === key && x.slugs.has(slug) ? x : { key, slugs: new Set([...(x.key === key ? x.slugs : []), slug]) })),
    [key],
  );
  // a card has settled when its turn has come and it's ready
  const settled = (slug: string) => {
    const i = order.indexOf(slug);
    return i >= 0 && slugs.has(slug) && i <= at;
  };
  return { settled, markReady };
}

function OnAirCard({
  s,
  look,
  disc,
  onMenu,
  settled,
  onReady,
}: {
  s: DialStation;
  look: StationLook;
  disc: TilePlay;
  onMenu?: (e: MouseEvent) => void;
  settled: boolean;
  onReady: (slug: string) => void;
}) {
  const radio = useRadio();
  const np = useOnAir(s.slug, s.live);
  // what it's playing, when that has a picture of its own (a record's cover, the show's): the record
  // then wears the station's mark on its corner (the founder, 2026-11-07: "both feel relevant")
  const cover = np ? (np.match?.coverUrl ?? np.track?.coverUrl ?? np.show?.image ?? null) : null;
  const wear = cover && cover !== s.image ? cover : null;
  // the cover is drawn unseen under the mark until its picture has fully arrived
  const art = useRef<HTMLSpanElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    setLoaded(false);
    setWaited(false);
    const el = art.current;
    if (!wear || !el) return;
    const done = () => setLoaded(true);
    const seen = () => [...el.querySelectorAll("img")].some((i) => i.complete && i.naturalWidth > 0);
    if (seen()) done();
    // a picture's load doesn't bubble, but an ancestor hears it on the way down
    const on = (e: Event) => (e.target as Element).tagName === "IMG" && done();
    el.addEventListener("load", on, true);
    const t = window.setTimeout(() => setWaited(true), COVER_WAIT_MS);
    return () => {
      el.removeEventListener("load", on, true);
      window.clearTimeout(t);
    };
  }, [wear]);
  const ready = np !== undefined && (!wear || loaded || waited);
  useEffect(() => {
    if (ready) onReady(s.slug);
  }, [ready, onReady, s.slug]);
  const show = settled && ready;
  const worn = show && !!wear && loaded;
  const until = show && np?.show?.until ? new Date(np.show.until) : null;
  const now = show && np ? (np.track ? `${np.track.artist} · ${np.track.title}` : (np.show?.name ?? s.description)) : s.description;
  const on = radio.isCurrent(s.slug) && radio.status !== "idle";
  return (
    <li className={r.onAir} data-on={on || undefined} data-selected={look.selected || undefined} onContextMenu={onMenu}>
      {/* the station's mark, shaped like an app icon, until what it's playing has a cover that has fully
          arrived; then the cover fades up under it and the mark settles into the corner */}
      <span ref={art} className={r.onAirArt} data-worn={worn || undefined}>
        {wear && (
          <span className={r.onAirCover}>
            <Art src={wear} sizes="112px" />
          </span>
        )}
        <span className={r.onAirMark}>{s.image ? <Art src={s.image} sizes="112px" /> : <WordArt name={s.name} accent={s.accent} />}</span>
      </span>
      {/* a click selects the station (the window shows it beside the dial); its play disc tunes in */}
      <button type="button" className={r.onAirText} onClick={look.onSelect}>
        {/* no live dot: "On now" already says it, and the dot beside the name read as noise (the founder,
            2026-11-07) */}
        <span className={r.onAirStation}>{s.name}</span>
        {/* the words change with the picture, and fade in as they do */}
        <span key={now} className={r.onAirNow} data-fresh={(show && now !== s.description) || undefined}>
          {now}
        </span>
        <span className={r.onAirMeta}>{[s.network !== s.name ? s.network : null, until && !Number.isNaN(until.getTime()) ? `until ${until.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : null].filter(Boolean).join(" · ")}</span>
      </button>
      <span className={r.onAirPlay}>
        <PlayDisc {...disc} />
      </span>
    </li>
  );
}

/** On now, the section rail and the dial. The window draws the page's title above it. */
export function RadioDial({ stations, saved, disc, look, menuFor }: RadioDialProps) {
  const radio = useRadio();
  // on now: your stations, then the live ones that publish what's on, in a different order each day so
  // the same few don't lead for weeks (the founder, 2026-11-07), six at most
  const day = Math.floor(Date.now() / 86_400_000);
  const onAir = useMemo(
    () =>
      [
        ...stations.filter((s) => saved.includes(s.slug)),
        ...stations.filter((s) => !saved.includes(s.slug) && s.live && s.image && s.kicker.endsWith("Live")).sort((a, b) => dailyTurn(day, a.slug) - dailyTurn(day, b.slug)),
      ].slice(0, 6),
    [stations, saved, day],
  );
  const turns = useTurns(useMemo(() => onAir.map((s) => s.slug), [onAir]));
  const sections = useMemo(() => {
    const m = new Map<string, DialStation[]>();
    for (const s of stations) (m.get(s.section) ?? m.set(s.section, []).get(s.section)!).push(s);
    return [...m.entries()];
  }, [stations]);
  const idOf = (name: string) => `dial-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <>
      <section aria-labelledby="on-air-head">
        <Heading id="on-air-head" shout="On now" />
        <ol className={r.onAirGrid}>
          {onAir.map((s) => (
            <OnAirCard key={s.slug} s={s} look={look(s.slug)} disc={disc(s)} onMenu={menuFor?.(s.slug)} settled={turns.settled(s.slug)} onReady={turns.markReady} />
          ))}
        </ol>
      </section>
      <nav className={r.dialRail} aria-label="Sections of the dial">
        {sections.map(([name]) => (
          <a key={name} href={`#${idOf(name)}`} className={r.dialChip}>
            {name}
          </a>
        ))}
      </nav>
      {sections.map(([name, list]) => (
        <section key={name} id={idOf(name)} className={r.dialSection}>
          <h2 className={r.sectionLabel}>{name}</h2>
          <ol className={r.dialColumns} aria-label={name}>
            {list.map((s) => (
              <StationRow
                key={s.slug}
                mark={s.image ? <Art src={s.image} sizes="56px" size={56} /> : null}
                name={s.name}
                kicker={s.kicker}
                description={s.description}
                onAir={radio.isCurrent(s.slug) && radio.status !== "idle"}
                live={radio.status === "playing"}
                play={disc(s)}
                {...look(s.slug)}
                onContextMenu={menuFor?.(s.slug)}
              />
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}

/** The saved stations' slugs, newest saved first: the list the page came with until the radio's own list (the
 *  signed-in person's, the same follow every app writes) is known, then that one, so a station saved or taken
 *  back shows at once. */
export function useSavedOrder(initial: string[]): string[] {
  const radio = useRadio();
  return useMemo(() => {
    if (!radio.savedKnown) return initial;
    const kept = initial.filter((slug) => radio.saved.has(slug));
    // saved here since the page loaded: the set keeps them in the order they were saved
    const added = [...radio.saved].filter((slug) => !initial.includes(slug)).reverse();
    return [...added, ...kept];
  }, [initial, radio.saved, radio.savedKnown]);
}
