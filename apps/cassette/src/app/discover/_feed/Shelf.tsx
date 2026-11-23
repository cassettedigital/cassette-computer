"use client";

/**
 * Discover's shelves, every one of them on the shared parts: the section head the album and artist pages use
 * (_taste/SectionHead), its last word a menu when the shelf holds several versions of itself (_taste/Menu's "word"
 * trigger, the artist page's "Artists like The Strokes, for *the downtown minimalist purists*"), and the player kit's
 * shelf, tiles and paddles (@discovery/cassette-kit ShelfSection, Tile). A shelf of versions takes the kit shelf's
 * `flip`: its paddles turn to the next version, and a computer shows one whole row of each. The head's word takes the
 * colour of the shelf's first cover (Accent), as the album page sets a word in its record's colour.
 *
 * Two ways to listen, on every shelf (the founder, 2026-11-20), both the shared play pieces:
 *   the shelf    the shared play button, its glyph alone, after the head's words: the shelf as a run, one song from
 *                each record in the shelf's order (the player names it in the dock, "Up next in" the shelf)
 *   a record     the kit's play key on its cover: that record in full, as Preview album plays it on its own page
 *                (_taste/hear-record.ts asks for its songs on the press)
 * A record's tile is lit while a song of it is playing, whichever of the two started it. In the desktop app a record
 * the person owns is their own copy (own.tsx): its key plays it from their computer and its picture looks into it.
 *
 * Covers come in at the size the tile is drawn (the image ladder's rung the browser picks for the tile), and once a
 * shelf is near the screen the covers it would show next are fetched at that same size, the next and the previous
 * version or the next page, so a turn or a page shows covers that are already here (the founder, 2026-11-18: "The
 * album covers load really slow").
 */

import Link from "next/link";
import { forwardRef, useEffect, useRef, useState, type AnchorHTMLAttributes, type ReactNode } from "react";
import { KitProvider, ShelfSection, Tile, tokens as kit, type KitLinkProps } from "@discovery/cassette-kit";
import { IMAGE_RUNGS } from "@discovery/cassette-kit/images";
import { Sleeve } from "@/app/_taste/Sleeve";
import { useHearRecord } from "@/app/_taste/hear-record";
import { albumHref } from "@/app/_taste/links";
import { Menu, MenuRadio } from "@/app/_taste/Menu";
import { PlayButton } from "@/app/_taste/PlayButton";
import { SectionHead } from "@/app/_taste/SectionHead";
import { usePlayerMaybe, type PlayerState } from "@/app/_taste/player";
import { ladderSrc } from "@/lib/images/picture";
import type { LanePlayable, LaneRecord } from "@/lib/discover/lane-playable";
import { Accent } from "./Accent";
import { useOwnedHere } from "./own";
import o from "./order.module.css";

/** One version of a shelf: its head ("Albums like Green Day's" and the word "90s pop-punk"), what its menu line says
 *  ("Green Day's 90s pop-punk"), and its records. A shelf with one version and no word is a plain head. */
export type ShelfVersion = { key: string; lead: string; word?: string; item?: string; records: LaneRecord[] };
export type ShelfModel = { id: string; menu?: string; versions: ShelfVersion[] };

const KitLink = forwardRef<HTMLAnchorElement, KitLinkProps>(function KitLink({ href, ...rest }, ref) {
  return <Link ref={ref} href={href} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)} />;
});

/** A run of shelves at a shelf's gap from one another; `after` is the run's last part (the Radio band), at the same gap. */
export function Shelves({ shelves, after }: { shelves: ShelfModel[]; after?: ReactNode }) {
  return (
    <KitProvider link={KitLink}>
      <div className={`${kit.kit} ${kit.follow} ${o.shelves}`}>
        {shelves.map((s) => (
          <Shelf key={s.id} shelf={s} />
        ))}
        {after}
      </div>
    </KitProvider>
  );
}

/** The shelf as a run: one song from each record, in the shelf's order, from the first. */
function playRun(player: PlayerState, key: string, label: string, songs: LanePlayable[]) {
  player.playList(songs, 0, { lane: { key, label } });
}

/** How many covers a page or a version shows at most (the kit shelf's widest row is eight). */
const ROW = 8;
const warmed = new Set<string>();

/** Fetches covers at the rung the shelf's drawn tiles use, once each, so they are in the browser when shown. */
function warm(root: HTMLElement | null, covers: (string | null)[]) {
  const shown = root?.querySelector<HTMLImageElement>("ol > li img");
  const drawn = shown?.currentSrc ? Number(/\/i\/(\d+)\//.exec(shown.currentSrc)?.[1]) : NaN;
  const rung = IMAGE_RUNGS.find((r) => r === drawn);
  if (!rung) return;
  for (const c of covers) {
    const url = c ? ladderSrc(c, rung) : null;
    if (!url || warmed.has(url)) continue;
    warmed.add(url);
    const img = new Image();
    img.decoding = "async";
    img.src = url;
  }
}

function Shelf({ shelf }: { shelf: ShelfModel }) {
  const [at, setAt] = useState(0);
  const player = usePlayerMaybe();
  const owned = useOwnedHere();
  const { asking, preview } = useHearRecord();
  const box = useRef<HTMLDivElement>(null);
  const near = useRef(false);
  const n = shelf.versions.length;
  const v = shelf.versions[at];
  const label = [v.lead, v.word].filter(Boolean).join(" ");
  const laneKey = `${shelf.id}:${v.key}`;
  const songs = v.records.flatMap((r) => (r.song ? [r.song] : []));
  // this shelf's run is what's playing
  const mine = !!player && player.lane?.key === laneKey;
  const docked = player?.track ?? null;
  const turn = (to: number) => setAt(((to % n) + n) % n);

  // the shelf's key: its run, or pause and resume while the run is on
  const runKey =
    player && songs.length > 0 ? (
      <span className={o.key}>
        <PlayButton
          round
          state={mine ? player.status : "idle"}
          verb="Preview"
          aria-pressed={mine && player.status === "playing"}
          aria-label={!mine ? `Preview ${label}, a song from each record` : player.status === "paused" ? `Resume ${label}` : `Pause ${label}`}
          onClick={() => (mine ? player.toggle() : playRun(player, laneKey, label, songs))}
        />
      </span>
    ) : undefined;

  // what this shelf shows next: the versions either side of this one, or this one's next page
  const upcoming = () =>
    n > 1
      ? [shelf.versions[(at + 1) % n], shelf.versions[(at - 1 + n) % n]].flatMap((x) => x.records.slice(0, ROW).map((r) => r.cover))
      : v.records.slice(ROW, ROW * 2).map((r) => r.cover);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e?.isIntersecting) return;
        near.current = true;
        // after the tiles in view have taken their own covers
        setTimeout(() => warm(el, upcoming()), 600);
        io.disconnect();
      },
      { rootMargin: "300px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (near.current) warm(box.current, upcoming());
  }, [at]); // eslint-disable-line react-hooks/exhaustive-deps
  // a pointer on the shelf is the moment someone might turn it more than once: everything it can show, warmed
  const everything = () => (n > 1 ? shelf.versions.flatMap((x) => x.records.slice(0, ROW).map((r) => r.cover)) : v.records.map((r) => r.cover));

  const head =
    n > 1 && v.word ? (
      <SectionHead
        size="small"
        inline
        after={
          <span className={o.word}>
            <Menu trigger="word" align="start" label={shelf.menu ?? label} title={v.word}>
              {shelf.versions.map((x, i) => (
                <MenuRadio key={x.key} checked={i === at} onPick={() => turn(i)}>
                  {x.item ?? x.word}
                </MenuRadio>
              ))}
            </Menu>
          </span>
        }
        trail={runKey}
      >
        {v.lead}
      </SectionHead>
    ) : (
      <SectionHead size="small" trail={runKey}>
        {label}
      </SectionHead>
    );

  return (
    <Accent cover={v.records[0]?.cover} ref={box} onPointerEnter={() => warm(box.current, everything())}>
      <ShelfSection
        shout={label}
        head={head}
        flip={
          n > 1
            ? {
                at,
                back: () => turn(at - 1),
                next: () => turn(at + 1),
                backLabel: `Before: ${shelf.versions[(at - 1 + n) % n].item ?? ""}`,
                nextLabel: `Next: ${shelf.versions[(at + 1) % n].item ?? ""}`,
              }
            : undefined
        }
      >
        {v.records.map((r) => {
          // a song of this record is playing (lit), and the record itself, its Preview album, is (its key pauses it);
          // while a run plays one of its songs the key still offers the whole record
          const lit = !!docked && docked.albumSlug === r.slug;
          const whole = lit && !player?.lane;
          // in the desktop app, a record you own is your copy (own.tsx): its key plays it from your computer
          const yours = owned(r.slug);
          if (yours)
            return (
              <Tile
                key={r.id}
                disc="corner"
                art={<Sleeve src={r.cover} title={r.title} sizes="(max-width: 560px) 45vw, 200px" />}
                title={r.title}
                line={r.artist}
                href={albumHref(r.slug)}
                playing={yours.playing || lit}
                play={yours.play}
                selected={yours.selected}
                onSelect={yours.onSelect}
                onContextMenu={yours.onMenu}
                onMore={yours.onMenu}
              />
            );
          return (
            <Tile
              key={r.id}
              art={<Sleeve src={r.cover} title={r.title} sizes="(max-width: 560px) 45vw, 200px" />}
              title={r.title}
              line={r.artist}
              href={albumHref(r.slug)}
              playing={lit}
              play={
                player && r.song
                  ? {
                      state: whole && player.status !== "paused" ? "pause" : "play",
                      busy: asking === r.id,
                      label: !whole ? `Preview album, ${r.title}` : player.status === "paused" ? `Resume ${r.title}` : `Pause ${r.title}`,
                      onClick: () => (whole ? player.toggle() : void preview(r.id, r.song)),
                    }
                  : null
              }
            />
          );
        })}
      </ShelfSection>
    </Accent>
  );
}
