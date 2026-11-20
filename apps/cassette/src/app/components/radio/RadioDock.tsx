"use client";

/**
 * RadioDock: the docked radio player, on the taste kit's terms. A floating corner (it shows over every
 * surface, the dashboard included, so it carries the taste roles itself), wearing the station's name, an
 * honest status light (the one orange while live), whatever the station's adapter can tell us about what
 * is on (the song's cover or the show's own picture over the station's square, when the show ends and
 * what comes next), and, when the record matched our catalog, a quiet link to it. The foot sends people
 * to the station: its website, then its ways to support it or buy from its shop (lib/radio/give). RadioDockView draws it from plain data; RadioDock wires it to the radio lane.
 */

import Link from "next/link";
import { AlbumCover } from "@/app/components/AlbumCover";
import { useEffect, useState, type CSSProperties } from "react";
import { Button } from "@/app/_taste/Button";
import { Icon } from "@/app/_taste/Icon";
import { giveItems, keepUsualGive, readUsualGive } from "@/lib/radio/give";
import { liveArt } from "@/lib/radio/live-art";
import type { RadioCatalogStation, RadioNowPlaying } from "@/lib/radio/types";
import { useRadioNow, type RadioStatus } from "./RadioProvider";
import { StationArt } from "@/app/_taste/radio/StationArt";
import styles from "./RadioDock.module.css";
import { inPanelFrame } from "@/lib/app-surface";
import { useRadioInRail } from "./rail-claim";

/** "7:00 PM" in the listener's own time zone. */
function clock(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** The dock wired to the radio lane: it shows while a station is tuned. */
export function RadioDock() {
  // only shows what's on, so it never asks for the station list itself (it rides on every page)
  const radio = useRadioNow();
  const inRail = useRadioInRail();
  const { station, status, nowPlaying } = radio;
  // on a wide window in the taste frame the page's right rail shows it instead (_taste/radio/RadioRail)
  if (inRail) return null;
  // in the account window's side panel the window's own dock shows it (the panel's radio is the window's)
  if (!station || status === "idle" || inPanelFrame()) return null;
  return <RadioDockView station={station} status={status} nowPlaying={nowPlaying} onStop={radio.stop} onRetry={() => radio.play(station.slug)} />;
}

/** The dock as it draws, from plain data (so every state can be seen without tuning in). */
export function RadioDockView({
  station,
  status,
  nowPlaying,
  onStop,
  onRetry,
}: {
  station: RadioCatalogStation;
  status: Exclude<RadioStatus, "idle">;
  nowPlaying: RadioNowPlaying | null;
  onStop: () => void;
  onRetry: () => void;
}) {
  const track = nowPlaying?.track ?? null;
  const show = nowPlaying?.show ?? null;
  const match = nowPlaying?.match ?? null;
  // the ways to back it, in the order every station surface uses (lib/radio/give): the usual one first
  const [usual, setUsual] = useState<string | null>(null);
  useEffect(() => setUsual(readUsualGive()), [station.slug]);
  const gives = giveItems(station, usual);

  const statusLabel = status === "playing" ? "Live" : status === "connecting" ? "Connecting" : "Couldn't connect";
  const primary = track ? track.title : show ? show.name : station.description;
  const secondary = track
    ? [track.artist, track.album, track.year].filter(Boolean).join(" · ")
    : show
      ? [show.host, show.genres?.join(", ")].filter(Boolean).join(" · ") || station.sourceLabel
      : station.sourceLabel;
  const art = liveArt(nowPlaying) ?? station.image ?? null;
  // the station's own mark wears the app icon's shape; a song's cover or a show's picture keeps a cover's corners
  const mark = !liveArt(nowPlaying);

  // When: the show's end, then the next show (or, on a station that publishes
  // its running order, the next song).
  // A feed can lag past a show's end (NTS keeps the old show up for a few
  // minutes); a time already gone says nothing useful, so it drops out.
  const future = (iso?: string | null) => (iso && Date.parse(iso) > Date.now() ? iso : null);
  const until = clock(future(show?.until));
  const upNext = nowPlaying?.next?.[0] ?? null;
  const nextTrack = nowPlaying?.nextTracks?.[0] ?? null;
  const back2back =
    !!upNext?.starts && !!show?.until && Math.abs(Date.parse(upNext.starts) - Date.parse(show.until)) < 120_000;
  const nextAt = back2back ? null : clock(future(upNext?.starts));
  const later = upNext
    ? nextAt
      ? `${nextAt}: ${upNext.name}`
      : until
        ? `then ${upNext.name}`
        : `Next: ${upNext.name}`
    : nextTrack
      ? `Next: ${nextTrack.title} · ${nextTrack.artist}`
      : null;
  const when = [until ? `Until ${until}` : null, later].filter(Boolean).join(until && back2back ? ", " : " · ");

  return (
    <div
      className={styles.dock}
      role="region"
      aria-label="Radio"
      data-state={status}
      style={{ ["--station" as string]: station.accent } as CSSProperties}
    >
      <div className={styles.line} aria-hidden="true" />
      <div className={styles.head}>
        <span className={styles.tag}>Radio</span>
        <Link href={`/radio/${station.slug}`} className={styles.station} title={station.name}>
          {station.name}
        </Link>
        <button type="button" className={styles.close} onClick={onStop} aria-label="Stop the radio">
          <Icon name="close" size={14} />
        </button>
      </div>

      <div className={styles.body}>
        <StationArt key={art ?? "tile"} src={art} name={station.name} size={56} className={mark ? `${styles.art} ${styles.mark}` : styles.art} glass={mark} />
        <div className={styles.meta}>
          <span className={styles.status} data-state={status}>
            <span className={styles.dot} aria-hidden="true" />
            {statusLabel}
            {track && show ? <span className={styles.onAir}> · {show.name}</span> : null}
          </span>
          <span className={styles.primary} title={primary}>
            {primary}
          </span>
          <span className={styles.secondary} title={secondary}>
            {secondary}
          </span>
          {when && (
            <span className={styles.when} title={when}>
              {when}
            </span>
          )}
        </div>
      </div>

      {status === "error" && (
        <div className={styles.retry}>
          <Button look="outlined" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}

      {match && (
        <Link href={`/album/${match.albumSlug}`} className={styles.match}>
          {match.coverUrl ? (
            <AlbumCover bare imageUrl={match.coverUrl} title="" size={32} sizes="32px" className={styles.matchArt} />
          ) : (
            <span className={styles.matchArt} aria-hidden="true" />
          )}
          <span className={styles.matchText}>
            <span className={styles.matchKicker}>{match.exact ? "The record" : "Looks like"}</span>
            <span className={styles.matchTitle}>
              {match.title} · {match.artistName}
            </span>
          </span>
        </Link>
      )}

      <div className={styles.foot}>
        {station.homepage && (
          <a className={styles.footLink} href={station.homepage} target="_blank" rel="noopener">
            {station.sourceLabel}
            <Icon name="out" size={11} />
          </a>
        )}
        {gives.map((g) => (
          <a key={g.give} className={styles.footLink} href={g.href} target="_blank" rel="noopener" onClick={() => {
              keepUsualGive(g.give);
              setUsual(g.give);
            }}>
            {g.word}
            <Icon name="out" size={11} />
          </a>
        ))}
        <span className={styles.kind}>{station.kind === "station" ? "Live radio" : "Channel"}</span>
      </div>
    </div>
  );
}
