"use client";

/**
 * The masthead's matches (part of P12), hanging under its pill while someone types. One listbox the field
 * drives: the field keeps the focus, the arrows move the lit row, Enter opens it.
 *
 * When the search is sure what was meant (Ozzy Osbourne for "ozzy osbourne"), that one result leads on
 * its own, lifted: its face large, what it is over its name, and a Preview key when it can play (an
 * artist's own best-known songs, or a song). It is lit, so Enter opens it. When the search isn't sure,
 * nothing leads and "Search everything" is lit, so Enter never opens a stranger. Then the groups, in the
 * order the search chose: each match its face (an artist's photo round, a record's cover square, the kit's
 * Sleeve when there is none), its name (an artist's in the display face, a record's or a song's in the
 * serif) and its facts in the meta type. A song row ends with its length and a round preview key; the
 * docked song shows the playing bars. The last row is always "Search everything", held at the foot of the
 * panel while the rest scrolls, with the keys spelled out beside it on a desktop.
 *
 * The panel takes the page's paper (light or dark, following the device), not the pill's dark. On a phone
 * it is a sheet from under the pill to the bottom of the screen, as a phone's own search is. The preview
 * keys only appear where the page has a player, and they are for the pointer: from the keyboard,
 * Cmd/Ctrl-Enter previews the lit row. A song whose preview isn't known yet looks it up when pressed, as
 * /search's song rows do; the named artist's own songs arrive with theirs. Picking a song opens the record
 * it's on with the song on top (its song address, lib/share/song-link.ts).
 */

import { useCallback, useMemo, useState, type ReactNode, type RefObject } from "react";
import { ArtistPhoto } from "@/app/components/ArtistPhoto";
import type { Typeahead } from "@/lib/search/use-typeahead";
import { songPath } from "@/lib/share/song-link";
import { Bars } from "./Bars";
import { Icon } from "./Icon";
import { PlayButton, type PlayState } from "./PlayButton";
import { Sleeve } from "./Sleeve";
import { albumHref, artistHref } from "./links";
import { usePlayerMaybe } from "./player";
import type { Playable } from "./play";
import s from "./searchpanel.module.css";

export type HitKind = "artist" | "album" | "song";

export type SearchHit = {
  /** `${kind}:${id}`, the row's id in the listbox (and what the search's `top` names) */
  id: string;
  kind: HitKind;
  href: string;
  name: string;
  /** what it is, in the meta type: an artist's genre and country, a record's artist and year, a song's artist and record */
  facts: string[];
  /** an artist's photo, drawn round */
  photo: string | null;
  /** a cover, drawn square: a record's or a song's own, or an artist's best-known when they have no photo */
  image: string | null;
  /** what a face with no picture shows the first letter of */
  sleeve: string;
  /** a song's length */
  seconds: number | null;
  /** a song as the dock would play it, all but its preview */
  song: Omit<Playable, "videoId" | "fallbackVideoIds"> | null;
  /** a song's preview when the search brought it (the named artist's own songs) */
  play: Playable | null;
  /** the artist's slug, where the search knows it (an artist, a record, the named artist's own songs) */
  artistSlug: string | null;
};

const GROUP: Record<HitKind, string> = { artist: "Artists", album: "Albums", song: "Songs" };
const KIND: Record<HitKind, string> = { artist: "Artist", album: "Album", song: "Song" };

const regions = (() => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" });
  } catch {
    return null;
  }
})();
/** "GB" as "United Kingdom"; anything else as it came. */
function place(code: string | null | undefined): string | null {
  const c = code?.trim();
  if (!c) return null;
  if (!/^[a-z]{2}$/i.test(c) || !regions) return c;
  try {
    return regions.of(c.toUpperCase()) ?? c;
  } catch {
    return c;
  }
}
const year = (date: string | null | undefined) => (date && /^\d{4}/.test(date) ? date.slice(0, 4) : null);
/** An EP, a single, a live record: said, since a search for a name turns up all of them. An album isn't. */
function kindOf(type: string | null | undefined): string | null {
  const t = type?.trim().toLowerCase();
  if (!t || t === "album") return null;
  return t === "ep" ? "EP" : t.charAt(0).toUpperCase() + t.slice(1);
}
const shown = (xs: Array<string | null | undefined>) => xs.filter((x): x is string => !!x && !!x.trim());

/** The search's matches as rows, in the order its groups came. */
export function toHits(ta: Pick<Typeahead, "artists" | "albums" | "songs" | "order">): SearchHit[] {
  const by: Record<Typeahead["order"][number], SearchHit[]> = {
    artists: ta.artists.map((a) => ({
      id: `artist:${a.id}`,
      kind: "artist" as const,
      href: artistHref(a.slug),
      name: a.name,
      facts: shown([a.genre, place(a.country)]),
      photo: a.imageUrl ?? null,
      image: a.cover ?? null,
      sleeve: a.name.replace(/^the\s+/i, ""),
      seconds: null,
      song: null,
      play: null,
      artistSlug: a.slug,
    })),
    albums: ta.albums.map((a) => ({
      id: `album:${a.id}`,
      kind: "album" as const,
      href: albumHref(a.slug),
      name: a.title,
      facts: shown([a.artistName, year(a.releaseDate), kindOf(a.releaseType)]),
      photo: null,
      image: a.coverArtUrl ?? null,
      sleeve: a.title.replace(/^the\s+/i, ""),
      seconds: null,
      song: null,
      play: null,
      artistSlug: a.artistSlug ?? null,
    })),
    // there is no song page: a song opens the record it's on with the song on top, by its catalog id (the
    // title form needs the whole tracklist to rule out a clash); `via=search` says a search sent it, not a
    // friend, so the page names no sender
    songs: ta.songs.map((x) => {
      const song = {
        trackId: Number(x.id),
        title: x.title,
        artist: x.artistName ?? "",
        artistSlug: x.artistSlug ?? "",
        album: x.albumTitle ?? null,
        albumSlug: x.albumSlug || null,
        cover: x.coverArtUrl ?? null,
        seconds: x.duration ?? null,
      };
      return {
        id: `song:${x.id}`,
        kind: "song" as const,
        href: `${songPath(x.albumSlug, String(x.id))}&via=search`,
        name: x.title,
        facts: shown([x.artistName, x.albumTitle]),
        photo: null,
        image: x.coverArtUrl ?? null,
        sleeve: (x.albumTitle || x.title).replace(/^the\s+/i, ""),
        seconds: x.duration ?? null,
        song,
        play: x.videoId ? { ...song, videoId: x.videoId, fallbackVideoIds: x.fallbackVideoIds ?? [] } : null,
        artistSlug: x.artistSlug ?? null,
      };
    }),
  };
  return ta.order.flatMap((g) => by[g]);
}

/** A song's preview, looked up when it is pressed (/api/preview/youtube, as /search's song rows do). */
async function lookUp(song: NonNullable<SearchHit["song"]>): Promise<Playable | null> {
  const res = await fetch(`/api/preview/youtube?trackId=${encodeURIComponent(song.trackId)}`);
  const data = (await res.json()) as { videoId?: string | null; fallbackVideoIds?: string[] };
  if (!data?.videoId) return null;
  return { ...song, videoId: data.videoId, fallbackVideoIds: data.fallbackVideoIds ?? [] };
}

/** What a row's preview is doing: none to be had, not playing, being looked up, or docked (and how). */
export type PreviewState = "none" | "pending" | PlayState;

export type Preview = {
  /** false when the page has no player to preview into */
  on: boolean;
  can: (id: string) => boolean;
  state: (id: string) => PreviewState;
  press: (id: string) => void;
};

/**
 * The panel's previews, in the page's dock. An artist plays their own best-known songs that came with the
 * search; a song plays "this one, then onward" through the songs whose previews are known, or looks its
 * own up. Pressing what is docked pauses and resumes it.
 */
export function useSearchPreview(hits: SearchHit[]): Preview {
  const player = usePlayerMaybe();
  const [found, setFound] = useState<Map<string, Playable>>(() => new Map());
  const [missing, setMissing] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState<string | null>(null);

  const byId = useMemo(() => new Map(hits.map((h) => [h.id, h])), [hits]);
  const known = useMemo(() => hits.filter((h) => h.kind === "song" && h.play).map((h) => h.play!), [hits]);
  const ownOf = useCallback((slug: string | null) => (slug ? known.filter((p) => p.artistSlug === slug) : []), [known]);
  const songOf = useCallback((h: SearchHit) => h.play ?? found.get(h.id) ?? null, [found]);
  const docked = useCallback(
    (list: Playable[]): PlayState => {
      if (!player || !list.some((p) => player.isCurrent(p.trackId))) return "idle";
      return player.status;
    },
    [player],
  );

  const can = useCallback(
    (id: string) => {
      const h = byId.get(id);
      if (!player || !h) return false;
      if (h.kind === "artist") return ownOf(h.artistSlug).length > 0;
      return h.kind === "song" && !missing.has(id);
    },
    [player, byId, ownOf, missing],
  );

  const state = useCallback(
    (id: string): PreviewState => {
      const h = byId.get(id);
      if (!h) return "idle";
      if (h.kind === "artist") return docked(ownOf(h.artistSlug));
      if (missing.has(id)) return "none";
      if (pending === id) return "pending";
      const p = songOf(h);
      return p ? docked([p]) : "idle";
    },
    [byId, docked, ownOf, missing, pending, songOf],
  );

  const press = useCallback(
    (id: string) => {
      const h = byId.get(id);
      if (!player || !h || !can(id)) return;
      if (h.kind === "artist") {
        const own = ownOf(h.artistSlug);
        if (docked(own) !== "idle") return player.toggle();
        return player.playList(own, 0);
      }
      const p = songOf(h);
      if (p && player.isCurrent(p.trackId)) return player.toggle();
      if (h.play) return player.playList(known, known.indexOf(h.play));
      if (p) return player.play(p);
      if (pending != null || !h.song) return;
      setPending(id);
      lookUp(h.song)
        .then((got) => {
          if (got) {
            setFound((m) => new Map(m).set(id, got));
            player.play(got);
          } else setMissing((m) => new Set(m).add(id));
        })
        .catch(() => setMissing((m) => new Set(m).add(id)))
        .finally(() => setPending(null));
    },
    [player, byId, can, ownOf, docked, songOf, known, pending],
  );

  return { on: !!player, can, state, press };
}

/** m:ss, or nothing. */
function time(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const r = Math.round(seconds % 60);
  return r === 60 ? `${m + 1}:00` : `${m}:${String(r).padStart(2, "0")}`;
}

/**
 * A match's face: an artist's photo round; with no photo (or a broken one) their best-known cover, square
 * as covers are (ArtistRows' rule); a record's cover; the kit's sleeve when there is nothing to show.
 */
function Face({ hit, big }: { hit: SearchHit; big?: boolean }) {
  const [photoGone, setPhotoGone] = useState<string | null>(null);
  const sizes = big ? "96px" : "64px";
  if (hit.photo && photoGone !== hit.photo) {
    return (
      <span className={s.face} data-round="">
        <ArtistPhoto imageUrl={hit.photo} name={hit.name} bare sizes={sizes} onError={() => setPhotoGone(hit.photo)} />
      </span>
    );
  }
  return (
    <span className={s.face}>
      <Sleeve src={hit.image} title={hit.sleeve} small sizes={sizes} />
    </span>
  );
}

/** The round preview key at a song row's end: for the pointer (the keyboard's is Cmd/Ctrl-Enter). */
function PreviewKey({ hit, st, onPress }: { hit: SearchHit; st: PreviewState; onPress: () => void }) {
  const moving = st === "playing" || st === "loading";
  return (
    <button
      type="button"
      className={s.key}
      tabIndex={-1}
      aria-hidden="true"
      title={moving ? "Pause" : `Preview ${hit.name}`}
      onClick={(e) => {
        e.stopPropagation();
        onPress();
      }}
    >
      <Icon name={moving ? "pause" : "play"} size={14} />
    </button>
  );
}

type RowProps = {
  id: string;
  role: "option";
  "aria-selected": boolean;
  "data-lit"?: true;
  onMouseDown: (e: { preventDefault: () => void }) => void;
  onMouseEnter: () => void;
  onClick: () => void;
};

function Row({ hit, row, preview }: { hit: SearchHit; row: RowProps; preview: Preview }) {
  const st = preview.state(hit.id);
  const docked = st === "playing" || st === "paused" || st === "loading";
  let end: ReactNode = null;
  if (hit.kind === "song") {
    end = (
      <span className={s.end}>
        {docked ? <Bars live={st === "playing"} /> : <span className={s.time}>{st === "pending" ? "…" : time(hit.seconds)}</span>}
        {preview.can(hit.id) && <PreviewKey hit={hit} st={st} onPress={() => preview.press(hit.id)} />}
      </span>
    );
  }
  return (
    <div className={s.row} {...row}>
      <Face hit={hit} />
      <span className={s.text}>
        <span className={s.name} data-kind={hit.kind}>
          {hit.name}
        </span>
        {(st === "none" || hit.facts.length > 0) && <span className={s.meta}>{st === "none" ? "No preview" : hit.facts.join(" · ")}</span>}
      </span>
      {end}
    </div>
  );
}

export function SearchPanel({
  id,
  panelRef,
  query,
  top,
  hits,
  namesakes,
  loading,
  failed = false,
  lit,
  preview,
  onLight,
  onPick,
}: {
  id: string;
  /** The panel itself, so the masthead can tell a click in it from a click away. */
  panelRef: RefObject<HTMLDivElement | null>;
  query: string;
  /** The one result the search is sure of, leading on its own; null when it isn't sure. */
  top: SearchHit | null;
  /** Every other match, in the order the search chose. */
  hits: SearchHit[];
  /** A quiet line when obscure namesakes of the leading artist were folded away. */
  namesakes: string | null;
  loading: boolean;
  /** The search itself failed (not "nothing matched"): say so, and leave the way on. */
  failed?: boolean;
  lit: string;
  preview: Preview;
  onLight: (id: string) => void;
  onPick: (id: string) => void;
}) {
  const groups: Array<{ kind: HitKind; list: SearchHit[] }> = [];
  for (const h of hits) {
    const g = groups.find((x) => x.kind === h.kind);
    if (g) g.list.push(h);
    else groups.push({ kind: h.kind, list: [h] });
  }
  const row = (rid: string): RowProps => ({
    id: `${id}-${rid}`,
    role: "option",
    "aria-selected": lit === rid,
    "data-lit": lit === rid || undefined,
    onMouseDown: (e) => e.preventDefault(),
    onMouseEnter: () => onLight(rid),
    onClick: () => onPick(rid),
  });
  const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const topState = top ? preview.state(top.id) : "idle";
  const empty = !top && groups.length === 0;

  return (
    <div ref={panelRef} className={s.panel} data-loading={loading || undefined}>
      <div id={id} role="listbox" aria-label="Matches" className={s.list}>
        {top && (
          <div className={s.top} {...row(top.id)}>
            <Face hit={top} big />
            <span className={s.text}>
              <span className={s.kicker}>{[KIND[top.kind], ...top.facts].join(" · ")}</span>
              <span className={s.topName}>{top.name}</span>
            </span>
            {preview.can(top.id) && (
              <PlayButton
                className={s.topPlay}
                state={topState === "none" || topState === "pending" ? "idle" : topState}
                verb="Preview"
                tabIndex={-1}
                aria-hidden="true"
                onClick={(e) => {
                  e.stopPropagation();
                  preview.press(top.id);
                }}
              />
            )}
          </div>
        )}
        {top && namesakes && <p className={s.hint}>{namesakes}</p>}
        {groups.map(({ kind, list }) => (
          <div key={kind} role="group" aria-label={GROUP[kind]} className={s.group}>
            <p className={s.head} aria-hidden="true">
              {GROUP[kind]}
            </p>
            {list.map((h) => (
              <Row key={h.id} hit={h} row={row(h.id)} preview={preview} />
            ))}
            {!top && kind === "artist" && namesakes && <p className={s.hint}>{namesakes}</p>}
          </div>
        ))}
        {empty && (
          <p className={s.hint}>
            {loading
              ? "Searching"
              : failed
                ? "Search is having trouble. Try again in a moment, or search everything below."
                : "No names match. Search everything for it below."}
          </p>
        )}
        <div className={`${s.row} ${s.all}`} {...row("all")}>
          <span className={s.allKey} aria-hidden="true">
            <Icon name="search" size={16} />
          </span>
          <span className={s.text}>
            <span className={s.name}>Search everything for “{query}”</span>
            <span className={s.meta}>Genres, moods and vibes too</span>
          </span>
          <span className={s.keys} aria-hidden="true">
            <kbd>↑↓</kbd> move <kbd>↵</kbd> open{preview.on && (
              <>
                {" "}
                <kbd>{mac ? "⌘↵" : "Ctrl ↵"}</kbd> preview
              </>
            )}{" "}
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
