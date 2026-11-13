"use client";

/**
 * The reaching row and All shelves (One Home, founder 2026-10-28). Home carries one shelf at a time
 * (lib/home/shelves: Loud ones, Quiet ones, Bops, Deep dive, Nostalgia, a corner of your library,
 * More like this month, Albums you haven't played); All shelves holds every shelf made today, and a
 * shelf opens as a page of its records. Deep dive is one record, drawn as one big card. Names only:
 * no line under a row's name says why (founder).
 */

import Link from "next/link";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { Grid, PlayPill, ShelfSection, Tile, useContextMenu, WordArt, type PlayState } from "@discovery/cassette-kit";
import type { HomeShelf } from "@/lib/home/types";
import { CoverGlass, glassHost } from "@/app/_taste/CoverGlass";
import { Art, albumCovers } from "./Art";
import { useAside } from "./DeskShell";
import { deskShelf, deskShelves, useHome, useOnMac, type OnMac } from "./home";
import { useOwned } from "./owned";
import { tintCover, useRecordDisc, useTint } from "./Player";
import { AlbumTile, PageHead, records, songs, usePlayAlbums, useRecordMenu } from "./Shelves";
import { deskAlbum, type DeskAlbum } from "./types";
import d from "./desk.module.css";

const NOSTALGIA_ACCENT = "#D4A020";

/** Nostalgia's mix: a tile that plays the songs from its years. */
function MixOfYears({ shelf, onMac }: { shelf: HomeShelf; onMac: OnMac }) {
  const owned = useOwned();
  const mix = shelf.mix ? onMac.mix(shelf.mix) : null;
  if (!mix) return null;
  return (
    <Tile
      disc="corner"
      art={<WordArt name={shelf.answer} accent={NOSTALGIA_ACCENT} />}
      title={shelf.shout}
      line={songs(mix.songs.length)}
      play={{ state: "play", label: `Play ${shelf.shout} ${shelf.answer}`, onClick: () => owned.playList(mix.songs, 0) }}
    />
  );
}

/**
 * Home's one big card: a row given to a single thing (Deep dive's record; Resume, the record or playlist
 * to pick up). A click on the picture selects it (the side view shows it), its name opens its page, its
 * pill plays.
 * `wide` is the shorter one that leads Home; `big` is Deep dive's. `glow`, a small copy of the picture,
 * lights the card with its own record as the iPhone's Resume card is (the founder, 2026-10-29). `tint` is
 * the picture its colour is read from, the same one the side view reads, so the card's wash and its
 * artist line are the colour that record wears when it is opened (the founder, 2026-11-12: one accent,
 * not the cover's other colours competing with it).
 */
export function FeatureCard({
  size,
  art,
  href,
  onLook,
  title,
  by,
  line,
  play,
  glow,
  tint,
  onContextMenu,
}: {
  size: "big" | "wide";
  art: ReactNode;
  glow?: ReactNode;
  tint?: string | null;
  href: string;
  onLook: () => void;
  title: string;
  by?: string;
  line?: string;
  play: { state: PlayState; word?: string; onClick: () => void };
  onContextMenu?: (e: MouseEvent) => void;
}) {
  const colour = useTint(tint);
  return (
    <div
      className={glow ? `${d.deepDiveCard} ${glassHost}` : d.deepDiveCard}
      data-size={size}
      style={tint === undefined ? undefined : ({ ...colour, "--glass-tint": "var(--pk-tint-glow)" } as CSSProperties)}
      onContextMenu={onContextMenu}
    >
      {glow && <CoverGlass playing={play.state === "pause"}>{glow}</CoverGlass>}
      <Link
        href={href}
        className={d.deepDiveArt}
        aria-label={title}
        onClick={(e: MouseEvent) => {
          e.preventDefault();
          onLook();
        }}
      >
        {art}
      </Link>
      <div className={d.deepDiveText}>
        {/* a name goes to its page; the picture looks (the single-click rule) */}
        <Link href={href} className={d.deepDiveTitle}>
          {title}
        </Link>
        {by && <span className={d.deepDiveArtist}>{by}</span>}
        {line && <span className={d.deepDiveLine}>{line}</span>}
        <PlayPill state={play.state} word={play.word} onClick={play.onClick} />
      </div>
    </div>
  );
}

/** Deep dive's one record, given the row. */
function DeepDive({ a, shelf }: { a: DeskAlbum; shelf: HomeShelf }) {
  const disc = useRecordDisc();
  const aside = useAside();
  const play = disc(a);
  return (
    <section className={d.deepDive}>
      <h2 className={d.deepDiveHead}>
        <span>{shelf.shout}</span> <em>{shelf.answer}</em>
      </h2>
      <FeatureCard
        size="big"
        art={<Art src={albumCovers(a, 600)} sizes="320px" />}
        glow={<Art src={albumCovers(a, 64)} sizes="64px" size={64} />}
        tint={tintCover(a)}
        href={deskAlbum(a)}
        onLook={() => aside.select({ kind: "record", key: a.key })}
        title={a.title}
        by={a.artist}
        play={{ state: play.state, onClick: play.onClick }}
      />
    </section>
  );
}

/** Home's reaching row: the one shelf the moment picked. */
export function ReachRow({ shelf }: { shelf: HomeShelf }) {
  const onMac = useOnMac();
  const menu = useRecordMenu();
  const cm = useContextMenu();
  if (!onMac) return null;
  const albums = onMac.shelf(shelf);
  if (shelf.kind === "deep-dive") return albums[0] ? <DeepDive a={albums[0]} shelf={shelf} /> : null;
  const mix = shelf.mix ? onMac.mix(shelf.mix) : null;
  if (albums.length < 2 && !mix) return null;
  const onMenu = (e: MouseEvent, a: DeskAlbum) => cm.open(e, menu(a));
  return (
    <>
      <ShelfSection shout={shelf.shout} answer={shelf.answer || undefined} href={deskShelves}>
        <MixOfYears shelf={shelf} onMac={onMac} />
        {albums.map((a) => (
          <AlbumTile key={a.key} a={a} onMenu={onMenu} />
        ))}
      </ShelfSection>
      {cm.menu}
    </>
  );
}

/**
 * The way from Home to every shelf made today: a row like any other (its name opens All shelves), of
 * the shelves Home didn't show, each one a tile into its own page. It was a lone outlined box, unlike
 * anything else on Home (founder, 2026-10-28).
 */
export function AllShelvesRow() {
  const home = useHome();
  const playAlbums = usePlayAlbums();
  const onMac = useOnMac();
  if (!home || !onMac) return null;
  const shelves = home.shelves
    .filter((s) => !s.onHome)
    .map((s) => ({ s, albums: onMac.shelf(s) }))
    .filter(({ albums }) => albums.length > 0);
  if (!shelves.length) return null;
  return (
    <ShelfSection shout="All shelves" answer="today" href={deskShelves}>
      {shelves.map(({ s, albums }) => (
        <Tile
          key={s.id}
          art={<Art src={albumCovers(albums[0], 200)} sizes="200px" />}
          title={[s.shout, s.answer].filter(Boolean).join(" ")}
          line={records(albums.length)}
          href={deskShelf(s.id)}
          disc="corner"
          play={{ state: "play", label: `Play ${[s.shout, s.answer].filter(Boolean).join(" ")}`, onClick: () => playAlbums(albums) }}
        />
      ))}
    </ShelfSection>
  );
}

/** All shelves: every shelf made today, the one on Home first. */
export function AllShelves() {
  const home = useHome();
  const playAlbums = usePlayAlbums();
  const onMac = useOnMac();
  const shelves = home && onMac ? [...home.shelves].sort((a, b) => Number(b.onHome) - Number(a.onHome)) : null;
  return (
    <div className={d.page}>
      <PageHead title="All shelves" />
      {!shelves ? null : shelves.length === 0 ? (
        <p className={d.quiet}>No shelves today.</p>
      ) : (
        <Grid min={168}>
          {shelves.map((s) => {
            const albums = onMac!.shelf(s);
            if (!albums.length) return null;
            return (
              <Tile
                key={s.id}
                art={<Art src={albumCovers(albums[0], 200)} sizes="200px" />}
                title={[s.shout, s.answer].filter(Boolean).join(" ")}
                line={s.onHome ? "On Home" : records(albums.length)}
                href={deskShelf(s.id)}
                disc="corner"
                play={{ state: "play", label: `Play ${[s.shout, s.answer].filter(Boolean).join(" ")}`, onClick: () => playAlbums(albums) }}
              />
            );
          })}
        </Grid>
      )}
    </div>
  );
}

/** One shelf, opened: its records (Nostalgia's mix first). */
export function ShelfPage({ id }: { id: string }) {
  const home = useHome();
  const onMac = useOnMac();
  const menu = useRecordMenu();
  const cm = useContextMenu();
  if (!home || !onMac) return <div className={d.page} />;
  const shelf = home.shelves.find((s) => s.id === id);
  if (!shelf) return <p className={`${d.page} ${d.quiet}`}>That shelf isn&rsquo;t in today&rsquo;s. Shelves are made fresh each day.</p>;
  const albums = onMac.shelf(shelf);
  const onMenu = (e: MouseEvent, a: DeskAlbum) => cm.open(e, menu(a));
  return (
    <div className={d.page}>
      <PageHead title={[shelf.shout, shelf.answer].filter(Boolean).join(" ")} />
      <Grid min={168}>
        <MixOfYears shelf={shelf} onMac={onMac} />
        {albums.map((a) => (
          <AlbumTile key={a.key} a={a} onMenu={onMenu} />
        ))}
      </Grid>
      {cm.menu}
    </div>
  );
}
