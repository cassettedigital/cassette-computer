"use client";

/**
 * The kit's lists and blocks, one per iPhone component:
 *
 *   Heading     CassetteHeading: the shout in caps and the answer in the serif italic on one line
 *               ("ON REPEAT lately"), a chevron when it goes somewhere. tone "quiet" = Settings' heads
 *   Shelf       AlbumCarousel: one row of 150pt tiles, 12pt apart, that scrolls sideways
 *   Grid        the Library grid: tiles filling the width
 *   Tile        AlbumCollectionCell / MoodDoorRow / RadioShelfCell / ArtistCircle: the art (3pt corners and
 *               a faint ring, or a circle), the play disc 8pt in from its corner, the name and one line
 *   TrackRow    PlayableTableCell: 76pt, 48pt art (or the track number), title, a line, the length; the
 *               playing song shows the waveform; no lines between rows
 *   StationRow  RadioStationCell: 56pt mark, name (orange while on air), kicker, two lines of description,
 *               the play disc or the waveform
 *   HubRow      Settings' HubRow: a 36pt tile with the machine's glyph, its name, a line, a chevron
 *   StripRow    Settings' StripRow: 46pt covers that fade out from 78% of the width
 *   Waveform    WaveformAnimatedView: three 3pt bars in the record's tint
 *   Hero        GenericDetailTableHeader: the 240pt cover in its own light, the page title, the answer
 *               line, the meta line and the pills
 *   Ambient     AmbientCoverBackdrop: the cover blurred big behind a player, under two scrims
 *   WordArt     a station with no picture (CarPlayStyle phoneWordArt): its colour run into the dark at
 *               140 degrees, its name set on it
 *
 * Pictures arrive as nodes (the app's own image pipeline); links through the KitProvider. The record's
 * colour arrives as --pk-tint-text and --pk-tint-glow on any ancestor.
 */

import type { CSSProperties, DragEvent, MouseEvent, ReactNode } from "react";
import { Glyph, type Concept } from "./Glyph";
import { PlayDisc, type PlayState } from "./Controls";
import { useKitLink } from "./KitProvider";
import { PlayOver } from "./PlayOver";
import { wordInitials } from "./word-initials";
import s from "./kit.module.css";

export function Heading({
  shout,
  answer,
  href,
  tone = "accent",
  as: Tag = "h2",
  id,
}: {
  shout: string;
  answer?: string;
  href?: string;
  tone?: "accent" | "quiet";
  as?: "h1" | "h2" | "h3";
  id?: string;
}) {
  const Link = useKitLink();
  const body = (
    <>
      <span className={s.shout}>{shout}</span>
      {answer && <span className={s.answer}> {answer}</span>}
      {href && (
        <span className={s.headChev} aria-hidden="true">
          <Glyph name="chevronRight" size={13} />
        </span>
      )}
    </>
  );
  return (
    <Tag id={id} className={s.heading} data-tone={tone}>
      {href ? (
        <Link href={href} className={s.headLink}>
          {body}
        </Link>
      ) : (
        body
      )}
    </Tag>
  );
}

export function Shelf({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ol className={s.shelf} aria-label={label}>
      {children}
    </ol>
  );
}

export function Grid({ children, min = 150 }: { children: ReactNode; min?: number }) {
  return (
    <ol className={s.grid} style={{ "--min": `${min}px` } as CSSProperties}>
      {children}
    </ol>
  );
}

export type TilePlay = { state: PlayState; label: string; busy?: boolean; onClick: () => void };

export function Tile({
  art,
  title,
  line,
  href,
  play,
  shape = "square",
  playing,
  onContextMenu,
  onMore,
  selected,
  onSelect,
  onOpen,
  disc,
  count,
}: {
  art: ReactNode;
  title: string;
  line?: ReactNode;
  /** How many the thing holds, as a small number on the picture's edge, like an unread count (an
      artist's albums; the host gives it only when there are several). It sits on the art, so the tile
      keeps the footprint of its neighbours (the founder, 2026-11-07). `label` is what it says aloud. */
  count?: { value: number; label: string };
  href?: string;
  play?: TilePlay | null;
  /** "corner": the play disc keeps to the art's corner when pointed at, the art undimmed (the Mac app,
      where the rest of the picture shows the thing in the side view); else it grows into the middle */
  disc?: "corner";
  /** square (a record), circle (an artist's photo), app (a station's mark, rounded like an app icon),
      loose (the art draws its own shape, e.g. a fan of covers) */
  shape?: "square" | "circle" | "app" | "loose";
  /** This tile's music is what's playing: its disc stays lit. */
  playing?: boolean;
  /** A pointer's right click (desktop and web): the host opens its menu. */
  onContextMenu?: (e: MouseEvent) => void;
  /** The "more" key in the art's other corner (desktop and web): the same menu, for a left click. */
  onMore?: (e: MouseEvent) => void;
  /** Desktop (the founder, 2026-11-06: a word opens a thing, anything else selects it, only a play symbol
      plays): a click on the picture calls onSelect (the host shows it in the side view, keeping the link
      from going); a click on the name lets the link go to its page. With no href, the whole tile selects.
      Cmd-click and the like stay the link's own. onOpen is a double click, for a host that wants one. */
  selected?: boolean;
  onSelect?: (e: MouseEvent) => void;
  onOpen?: () => void;
}) {
  const Link = useKitLink();
  const plain = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
  // a click on the name, where there's a page to go to
  const onName = (e: MouseEvent) => !!href && !!(e.target as Element).closest?.(`.${s.tileTitle}`);
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
      <span className={s.tileArt} data-shape={shape} data-station-glass={shape === "app" ? "" : undefined}>
        {art}
      </span>
      {count && (
        <span className={s.tileCountAt} data-shape={shape} aria-hidden="true">
          <span className={s.tileCount}>{count.value}</span>
        </span>
      )}
      <span className={s.tileTitle}>{title}</span>
      {count && <span className={s.tileCountSay}>, {count.label}</span>}
      {line && <span className={s.tileLine}>{line}</span>}
    </>
  );
  return (
    <li className={s.tile} data-playing={playing || undefined} data-selected={selected || undefined} data-looks={onSelect ? "" : undefined} data-disc={disc} onContextMenu={onContextMenu}>
      {href ? (
        <Link href={href} className={s.tileLink} onClick={pick} onDoubleClick={open}>
          {face}
        </Link>
      ) : onSelect ? (
        <button type="button" className={s.tileLink} onClick={pick} onDoubleClick={open}>
          {face}
        </button>
      ) : (
        <span className={s.tileLink} onClick={pick} onDoubleClick={open}>
          {face}
        </span>
      )}
      {play && (
        <span className={s.tileDisc} data-shape={shape}>
          <PlayDisc state={play.state} label={play.label} busy={play.busy} onClick={play.onClick} />
        </span>
      )}
      {/* "more" sits in the art's top-right corner (a square the art's size places it) */}
      {onMore && (
        <span className={s.tileMoreAt}>
          <button
            type="button"
            className={s.tileMore}
            aria-label={`More for ${title}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onMore(e);
            }}
          >
            <Glyph name="more" size={16} />
          </button>
        </span>
      )}
    </li>
  );
}

export function Waveform({ live }: { live: boolean }) {
  return (
    <span className={s.wave} data-live={live || undefined} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function TrackRow({
  art,
  number,
  title,
  line,
  length,
  playing,
  live,
  dim,
  onClick,
  plays = false,
  label,
  onContextMenu,
  onDragStart,
  onSelect,
  onPlay,
  selected,
}: {
  art?: ReactNode;
  number?: string | number;
  title: string;
  line?: string | null;
  length?: string | null;
  /** This is the song playing (live = moving, else held still). */
  playing?: boolean;
  live?: boolean;
  /** Can't play here (no preview, not on this device). */
  dim?: boolean;
  onClick?: () => void;
  /** The click plays the song (not opens it): pointed at, the shared hover-play (a plain triangle in the
   *  record's colour) takes the number's place, unless it is the one playing. A row with no number has it
   *  in the length's place at the end. Every song list counts, so it stands in one place everywhere. */
  plays?: boolean;
  label?: string;
  /** desktop: a right click opens the host's menu */
  onContextMenu?: (e: MouseEvent) => void;
  /** desktop: the row can be dragged (the host fills the drag, e.g. songs onto a playlist) */
  onDragStart?: (e: DragEvent) => void;
  /** The Mac's rows (the founder, 2026-11-06): a click picks the row (Shift and Command for several, the
   *  host keeps the picks, kit select.ts) and only the play symbol on its number plays (`onPlay`; on the
   *  song playing, the host's pause), so a click never changes what's on. `selected` lights a picked row. */
  onSelect?: (e: MouseEvent) => void;
  onPlay?: () => void;
  selected?: boolean;
}) {
  const counted = number != null;
  if (onSelect) {
    const can = !!onPlay && !dim;
    const key = (
      <button
        type="button"
        className={s.rowPlay}
        aria-label={playing ? `Pause ${title}` : (label ?? `Play ${title}`)}
        onClick={(e) => {
          e.stopPropagation();
          onPlay?.();
        }}
      />
    );
    // the triangle sits in the cell, not the key, so it stands exactly where the number does
    const tri = can && !playing ? <PlayOver bare size={16} align="end" /> : null;
    return (
      <li onContextMenu={onContextMenu} draggable={onDragStart ? true : undefined} onDragStart={onDragStart} aria-selected={selected || false}>
        <div
          className={s.row}
          data-picks=""
          data-play-host={can && !playing ? "" : undefined}
          data-art={art ? (counted ? "counted" : "") : undefined}
          data-on={playing || undefined}
          data-dim={dim || undefined}
          data-selected={selected || undefined}
          onClick={onSelect}
          // Shift-click picks a run of rows, not the text between them
          onMouseDown={(e) => e.shiftKey && e.preventDefault()}
        >
          {(counted || !art) && (
            <span className={s.rowNum} data-over={(can && counted && !playing) || undefined}>
              {playing ? <Waveform live={!!live} /> : number}
              {counted && tri}
              {can && counted && key}
            </span>
          )}
          {art && (
            <span className={s.rowArt}>
              {art}
              {playing && !counted && (
                <span className={s.rowArtScrim}>
                  <Waveform live={!!live} />
                </span>
              )}
            </span>
          )}
          <span className={s.rowText}>
            <span className={s.rowTitle}>{title}</span>
            {line && <span className={s.rowLine}>{line}</span>}
          </span>
          {(length || (can && !counted)) && (
            <span className={s.rowLen} data-over={(can && !counted && !playing) || undefined}>
              {length}
              {!counted && tri}
              {can && !counted && key}
            </span>
          )}
        </div>
      </li>
    );
  }
  const over = !!(plays && onClick && !playing && !dim);
  const body = (
    <>
      {(counted || !art) && (
        <span className={s.rowNum} data-over={(over && counted) || undefined}>
          {playing ? <Waveform live={!!live} /> : number}
          {over && counted && <PlayOver bare size={16} align="end" />}
        </span>
      )}
      {art && (
        <span className={s.rowArt}>
          {art}
          {playing && !counted && (
            <span className={s.rowArtScrim}>
              <Waveform live={!!live} />
            </span>
          )}
        </span>
      )}
      <span className={s.rowText}>
        <span className={s.rowTitle}>{title}</span>
        {line && <span className={s.rowLine}>{line}</span>}
      </span>
      {(length || (over && !counted)) && (
        <span className={s.rowLen} data-over={(over && !counted) || undefined}>
          {length}
          {over && !counted && <PlayOver bare size={16} align="end" />}
        </span>
      )}
    </>
  );
  return (
    <li onContextMenu={onContextMenu} draggable={onDragStart ? true : undefined} onDragStart={onDragStart}>
      {onClick ? (
        <button type="button" className={s.row} data-art={art ? (counted ? "counted" : "") : undefined} data-on={playing || undefined} data-dim={dim || undefined} onClick={onClick} aria-label={label}>
          {body}
        </button>
      ) : (
        <span className={s.row} data-art={art ? (counted ? "counted" : "") : undefined} data-on={playing || undefined} data-dim={dim || undefined}>
          {body}
        </span>
      )}
    </li>
  );
}

export function Rows({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ol className={s.rows} aria-label={label}>
      {children}
    </ol>
  );
}

export function StationRow({
  mark,
  name,
  kicker,
  description,
  href,
  selected,
  onSelect,
  onOpen,
  onContextMenu,
  onAir,
  live,
  play,
}: {
  /** The station's mark, or null for its initials on the raised fill. */
  mark: ReactNode | null;
  name: string;
  kicker: string;
  description?: string;
  href?: string;
  /** Desktop: the row is looked into somewhere else (lit while it is), and opened on a double click. */
  selected?: boolean;
  onSelect?: (e: MouseEvent) => void;
  onOpen?: () => void;
  /** Desktop: the station's menu (a right click anywhere on the row). */
  onContextMenu?: (e: MouseEvent) => void;
  /** This station is tuned in (live = sound is coming). */
  onAir?: boolean;
  live?: boolean;
  play: TilePlay;
}) {
  const Link = useKitLink();
  const initials = name
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  const body = (
    <>
      <span className={s.stMark} data-station-glass="">{mark ?? <span className={s.stInitials}>{initials}</span>}</span>
      <span className={s.stText}>
        <span className={s.stName}>{name}</span>
        <span className={s.stKicker}>{kicker}</span>
        {description && <span className={s.stDesc}>{description}</span>}
      </span>
    </>
  );
  return (
    <li className={s.station} data-on={onAir || undefined} data-selected={selected || undefined} onContextMenu={onContextMenu}>
      {href ? (
        <Link href={href} className={s.stBody}>
          {body}
        </Link>
      ) : onSelect ? (
        <button type="button" className={s.stBody} onClick={onSelect} onDoubleClick={onOpen}>
          {body}
        </button>
      ) : (
        <span className={s.stBody}>{body}</span>
      )}
      <span className={s.stEnd}>{onAir && live ? <Glyph name="waveform" size={15} className={s.stWave} /> : <PlayDisc {...play} />}</span>
    </li>
  );
}

export function HubRow({ glyph, name, line, href, light }: { glyph: Concept; name: string; line: string; href?: string; light?: "live" | "idle" | "offline" }) {
  const Link = useKitLink();
  const body = (
    <>
      <span className={s.hubTile}>
        <Glyph name={glyph} size={17} />
        {light && <i className={s.hubLight} data-light={light} aria-hidden="true" />}
      </span>
      <span className={s.hubText}>
        <span className={s.hubName}>{name}</span>
        <span className={s.hubLine}>{line}</span>
      </span>
      {href && (
        <span className={s.hubChev} aria-hidden="true">
          <Glyph name="chevronRight" size={15} />
        </span>
      )}
    </>
  );
  return <li>{href ? <Link href={href} className={s.hub}>{body}</Link> : <span className={s.hub}>{body}</span>}</li>;
}

export function StripRow({ covers, label }: { covers: Array<{ key: string; art: ReactNode; href?: string; title: string }>; label: string }) {
  const Link = useKitLink();
  return (
    <ol className={s.strip} aria-label={label}>
      {covers.map((c) => (
        <li key={c.key}>
          {c.href ? (
            <Link href={c.href} className={s.stripCover} title={c.title}>
              {c.art}
            </Link>
          ) : (
            <span className={s.stripCover} title={c.title}>
              {c.art}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

export function Hero({
  art,
  title,
  answer,
  meta,
  kind = "album",
  peek,
  children,
}: {
  art: ReactNode;
  /** The name; a page that edits it in place passes its field here. */
  title: ReactNode;
  answer?: ReactNode;
  meta?: string;
  /** Albums take 3pt corners, playlists 5, stations 4. */
  kind?: "album" | "playlist" | "station";
  /** Something tucked behind the cover and showing past its edge (a disc in its sleeve); placed by
      its own class against the cover's box, which doesn't clip it. */
  peek?: ReactNode;
  /** The pills. */
  children?: ReactNode;
}) {
  return (
    <header className={s.hero}>
      {peek ? (
        <span className={s.heroStage}>
          {peek}
          <span className={s.heroArt} data-kind={kind}>
            {art}
          </span>
        </span>
      ) : (
        <span className={s.heroArt} data-kind={kind}>
          {art}
        </span>
      )}
      <span className={s.heroText}>
        <h1 className={s.heroTitle}>{title}</h1>
        {answer && <span className={s.heroAnswer}>{answer}</span>}
        {meta && <span className={s.heroMeta}>{meta}</span>}
        {children && <span className={s.heroPills}>{children}</span>}
      </span>
    </header>
  );
}

export function Ambient({ art, playing, contained }: { art: ReactNode; playing: boolean; contained?: boolean }) {
  return (
    <span className={s.ambient} data-playing={playing || undefined} data-contained={contained || undefined} aria-hidden="true">
      <span className={s.ambientArt}>{art}</span>
      <span className={s.ambientScrim} />
    </span>
  );
}

export function WordArt({ name, accent }: { name: string; accent: string }) {
  return (
    <span className={s.wordArt} style={{ "--word": accent } as CSSProperties}>
      {/* in a tile too small to read a name (kit.module.css), the full name hides and the initials show */}
      <span className={s.wordFull}>{name}</span>
      <span className={s.wordInitials} aria-hidden="true">
        {wordInitials(name)}
      </span>
    </span>
  );
}
