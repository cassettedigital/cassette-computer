"use client";

/**
 * A station looked into, in the side view: one drawing for the Mac app's right column (desk/Rail.tsx, a station
 * selected) and the website's right rail (_taste/radio/RadioRail.tsx, a station tuned in), so the two never
 * drift (the founder, 2026-11-16: "we should make an effort to unify these"). It draws in the player kit's
 * look, so its host puts it inside the kit's scope (the desk is; the website wraps it).
 *
 * The founder's calls it keeps (2026-10-27, 10-29): its art, its name and where it's from, Tune in and Save
 * side by side (the phone's way), a few quiet chips (what kind of station, what it plays), then what's on
 * the air as a log down a thread: the show on now with its picture, the song on now, the songs before it at
 * their times with their covers, the shows coming up; then the stations like it. No about text: its website
 * and where to support it are in the station's "…" menu, as on the phone.
 *
 * It only draws. Each host passes what differs: its own pictures (the desk's come through its hub-aware Art,
 * the website's through the image ladder), its keys, what a click on a song does (the desk opens the record
 * in its middle column; the website goes to the record's page) and on a station like it (the desk shows it
 * here; the website opens its page). A song wears the record we carry first, then the station's own cover,
 * the one order every radio picture keeps (lib/radio/live-art).
 */

import Link from "next/link";
import { useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { WordArt } from "@discovery/cassette-kit";
import type { RadioMatch, RadioNowPlaying, RadioStationPage } from "@/lib/radio/types";
import s from "./station-side.module.css";

/** How often a station looked into is read again while it stays in view. */
const STATION_PAGE_MS = 30_000;

/** A song in the log, as a click on it needs it. */
export type SideSong = { title: string; artist: string; match?: RadioMatch | null };

/** What a click does: go somewhere, or the host's own action; a right click for the host's menu. */
export type SideHit = { href?: string; onClick?: () => void; onContextMenu?: (e: MouseEvent) => void; label: string };

/** A station like this one, as the host has it (its art and its line from the host's own list). */
export type SideStation = { slug: string; name: string; image: string | null; accent: string; line: string };

/**
 * The station's page (lib/radio/station-page, the route the phones read too): what's on, where it's from and
 * what it plays, its latest songs each matched to its record on Cassette, the stations like it. Read when it's
 * looked into, again every half minute while it stays there, and as soon as the radio hears the song change
 * (`song`); the last answer stays up meanwhile. Null until the first answers.
 */
export function useStationPage(slug: string | null, song: string | null): RadioStationPage | null {
  const [got, setGot] = useState<{ slug: string; page: RadioStationPage | null } | null>(null);
  useEffect(() => {
    if (!slug) return;
    let gone = false;
    const read = () => {
      if (document.visibilityState !== "visible") return;
      fetch(`/api/radio/station/${encodeURIComponent(slug)}`)
        .then((r) => (r.ok ? (r.json() as Promise<RadioStationPage>) : null))
        .then(
          (page) => !gone && setGot((was) => (page || was?.slug !== slug ? { slug, page } : was)),
          () => {},
        );
    };
    read();
    const id = window.setInterval(read, STATION_PAGE_MS);
    return () => {
      gone = true;
      window.clearInterval(id);
    };
  }, [slug, song]);
  return slug && got?.slug === slug ? got.page : null;
}

const clock = (iso: string | null | undefined) => {
  if (!iso) return null;
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? null : t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

const same = (a: { artist: string; title: string }, b: { artist: string; title: string }) =>
  a.artist.trim().toLowerCase() === b.artist.trim().toLowerCase() && a.title.trim().toLowerCase() === b.title.trim().toLowerCase();

/** The row's key over the whole row: a link where the host gives one, else a button. */
function Hit({ hit }: { hit: SideHit }) {
  return hit.href ? (
    <Link href={hit.href} className={s.stHit} onContextMenu={hit.onContextMenu} aria-label={hit.label} title={hit.label} prefetch={false} />
  ) : (
    <button type="button" className={s.stHit} onClick={hit.onClick} onContextMenu={hit.onContextMenu} aria-label={hit.label} title={hit.label} />
  );
}

export function StationSide({
  station,
  page,
  live,
  keys,
  picture,
  songHit,
  similar,
  stationHit,
  titleHref,
  style,
  classNames,
}: {
  station: { slug: string; name: string; image: string | null; accent: string; kicker: string };
  /** The station's page read (useStationPage), null until it answers. */
  page: RadioStationPage | null;
  /** What's on: the radio's own line while it's tuned (it keeps itself fresh), else the page's. */
  live: RadioNowPlaying | null;
  /** Tune in (or Stop) and Save, the host's own. */
  keys: ReactNode;
  /** A picture filling a box `px` across: the host's own way to draw one. */
  picture: (src: string, px: number, opts?: { priority?: boolean }) => ReactNode;
  /** What a click on a song in the log does. */
  songHit: (song: SideSong) => SideHit;
  /** The stations like it, as the host has them; the page's when it has none of its own. */
  similar?: SideStation[];
  stationHit: (x: SideStation) => SideHit;
  /** Where the station's name goes (the website: its page); the desk's name is plain. */
  titleHref?: string;
  /** The station's colour on the column (the host's tint). */
  style?: CSSProperties;
  /** The host's own classes beside these, for its own rules (the desk draws the head small under a video). */
  classNames?: Partial<Record<"look" | "art" | "text" | "title", string>>;
}) {
  const cx = (mine: string, theirs?: string) => (theirs ? `${mine} ${theirs}` : mine);
  const st = page?.station ?? null;
  // the line under the name already says where it's from, so the chips say only what it plays
  const chips = st ? [st.kind === "station" ? "Live shows" : "One sound, all day", ...st.genres.slice(0, 3)] : [];
  const show = live?.show ?? null;
  const track = live?.track ?? null;
  // a song wears the record we carry, else the station's cover for it, else the station's own mark
  const nowCover = live?.match?.coverUrl || track?.coverUrl || station.image || null;
  const later = (page?.live?.next ?? []).slice(0, 2);
  // the radio can hear a new song before the page catches up: never the song on now twice
  const recent = (page?.recent ?? []).filter((p) => !track || !same(p, track)).slice(0, 6);
  const like: SideStation[] =
    similar ?? (page?.similar ?? []).map((x) => ({ slug: x.slug, name: x.name, image: x.image, accent: x.accent, line: [x.sourceLabel, x.cityLabels[0]].filter(Boolean).join(" · ") }));

  return (
    <div className={cx(s.look, classNames?.look)} style={style}>
      <span className={cx(s.lookArt, classNames?.art)} data-app="">
        {station.image ? picture(station.image, 380, { priority: true }) : <WordArt name={station.name} accent={station.accent} />}
      </span>
      <div className={cx(s.lookText, classNames?.text)}>
        <h2 className={cx(s.lookTitle, classNames?.title)}>{titleHref ? <Link href={titleHref}>{station.name}</Link> : station.name}</h2>
        {station.kicker && <p className={s.lookBy}>{station.kicker}</p>}
      </div>
      {keys}
      {chips.length > 0 && (
        <ul className={s.stChips} aria-label="About the station">
          {chips.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}

      {(show || track || recent.length > 0) && (
        <section className={s.stSection} aria-label="On the air">
          <h3 className={s.stHead}>On the air</h3>
          {show && (
            <div className={s.stShow}>
              <span className={s.stShowArt}>{show.image ? picture(show.image, 48) : <WordArt name={show.name} accent={station.accent} />}</span>
              <span className={s.stShowText}>
                <span className={s.stShowName}>{show.name}</span>
                <span className={s.stShowLine}>{[show.host ? `with ${show.host}` : null, clock(show.until) ? `until ${clock(show.until)}` : null].filter(Boolean).join(" · ")}</span>
              </span>
            </div>
          )}
          {(track || recent.length > 0) && (
            <ol className={s.stLog}>
              {track && (
                <li data-now="">
                  <span className={s.stWhen}>
                    <i className={s.liveDot} aria-hidden="true" />
                    Now
                  </span>
                  <span className={s.stBead}>{nowCover ? picture(nowCover, 44) : <i aria-hidden="true" />}</span>
                  <span className={s.stSong}>
                    <span className={s.stSongTitle}>{track.title}</span>
                    <span className={s.stSongArtist}>{track.artist}</span>
                  </span>
                  <Hit hit={songHit({ title: track.title, artist: track.artist, match: live?.match ?? null })} />
                </li>
              )}
              {recent.map((p, i) => {
                const cover = p.match?.coverUrl || p.coverUrl || null;
                return (
                  <li key={`${p.artist}-${p.title}-${i}`}>
                    <span className={s.stWhen}>{clock(p.playedAt) ?? ""}</span>
                    <span className={s.stBead}>{cover ? picture(cover, 40) : <i aria-hidden="true" />}</span>
                    <span className={s.stSong}>
                      <span className={s.stSongTitle}>{p.title}</span>
                      <span className={s.stSongArtist}>{p.artist}</span>
                    </span>
                    <Hit hit={songHit(p)} />
                  </li>
                );
              })}
            </ol>
          )}
          {later.length > 0 && <h3 className={`${s.stHead} ${s.stHeadLater}`}>Coming up</h3>}
          {later.length > 0 && (
            <ol className={s.stLater} aria-label="Coming up">
              {later.map((x, i) => (
                <li key={`${x.name}-${x.starts}-${i}`}>
                  <span className={s.stWhen}>{clock(x.starts) ?? ""}</span>
                  <span className={s.stLaterName}>
                    {x.name}
                    {x.host ? <span className={s.stSongArtist}> with {x.host}</span> : null}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {like.length > 0 && (
        <section className={s.stSection} aria-label="Stations like it">
          <h3 className={s.stHead}>Stations like it</h3>
          <ul className={s.stLike}>
            {like.slice(0, 4).map((x) => {
              const hit = stationHit(x);
              const face = (
                <>
                  <span className={s.stLikeArt}>{x.image ? picture(x.image, 40) : <WordArt name={x.name} accent={x.accent} />}</span>
                  <span className={s.stLikeText}>
                    <span className={s.stLikeName}>{x.name}</span>
                    <span className={s.stLikeLine}>{x.line}</span>
                  </span>
                </>
              );
              return (
                <li key={x.slug}>
                  {hit.href ? (
                    <Link href={hit.href} className={s.stLikeKey} aria-label={hit.label} prefetch={false}>
                      {face}
                    </Link>
                  ) : (
                    <button type="button" className={s.stLikeKey} onClick={hit.onClick} aria-label={hit.label}>
                      {face}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
