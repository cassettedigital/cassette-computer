"use client";

/**
 * The tracklist with its previews beside it, YouTube's shape (the September page, founder 2026-09-14):
 * the numbered list on the left, a "Preview the album" up-next pane on the right in track order, the
 * two columns one height, the pane scrolling inside itself. Every song plays in the shared dock: the one
 * you click, then the rest of the record. The docked song shows the shared playing bars (orange and
 * moving only while it plays); pointing at a song shows the play glyph. No per-row dots; a song without
 * a preview is plain text.
 * Five songs or fewer: one column, the list and then the previews as a row of tiles (September's rule).
 * Copied from preview/hobby/[slug]/HobbyBackCover.tsx:43-129, with the shared dock in place of its own.
 *
 * A song a claimed artist uploaded their own music video for (`videoUrl`) plays that video ahead of YouTube: its
 * row opens the video under the song (one at a time, the dock pauses while it plays), and the song's YouTube
 * tile leaves the preview pane (BUG-539). Only on the website (`share`): the apps carry no inline video.
 *
 * While the player is the panel down the right of a wide window, the previews become that panel (the
 * founder, 2026-10-26: "the 'preview on youtube' thumbnails effectively BECOMES the right rail"): the pane
 * is portalled under the video (useRailSlot) and the list here has the column to itself, so there is only
 * ever one list of previews on screen.
 */

import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bars } from "@/app/_taste/Bars";
import { SectionHead } from "@/app/_taste/SectionHead";
import k from "@/app/_taste/taste.module.css";
import { fmtTime } from "@/app/(taste)/_kit/format";
import type { Playable } from "@/app/_taste/play";
import { usePlayer, useRailSlot } from "@/app/_taste/player";
import { ShareSong } from "@/app/_taste/ShareSong";
import { Picture } from "@discovery/cassette-kit/picture";
import { PlayOver } from "@discovery/cassette-kit/play-over";
import { picture } from "@/lib/images/picture";
import { previewPane } from "./shape";
import type { AlbumPage, AlbumTrack } from "./types";
import a from "./album.module.css";

/** YouTube's own still for the upload; if YouTube gives none, the record's cover, whole, with nothing over it. */
function Thumb({ x, over = false }: { x: Playable; over?: boolean }) {
  const [fail, setFail] = useState(false);
  const [gone, setGone] = useState(false);
  return (
    <span className={a.thumb} data-fail={fail || undefined}>
      {!fail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`https://i.ytimg.com/vi/${x.videoId}/mqdefault.jpg`} alt="" width={120} height={68} loading="lazy" onError={() => setFail(true)} />
      ) : x.cover && !gone ? (
        // the cover whole in the 16:9 tile (168px wide and up), so as wide as the tile is tall
        <Picture {...picture(x.cover, "cover")} sizes="170px" alt="" width={120} height={68} onError={() => setGone(true)} />
      ) : null}
      {x.seconds ? <span className={a.dur}>{fmtTime(x.seconds)}</span> : null}
      {over && <PlayOver />}
    </span>
  );
}

export function Tracklist({ p, share = true }: { p: AlbumPage; share?: boolean }) {
  const { track, status, playList, toggle, isCurrent } = usePlayer();
  const paneRef = useRef<HTMLUListElement>(null);
  const slot = useRailSlot();
  // the artist's own videos win: those songs have no YouTube tile in the pane, and the dock steps aside for them
  const ownVideo = new Map(p.tracks.flatMap((t) => (share && t.videoUrl ? [[t.id, t.videoUrl] as const] : [])));
  const [watching, setWatching] = useState<number | null>(null);
  // anything the dock starts to play closes the video, so one thing plays at a time
  useEffect(() => {
    if (status === "playing") setWatching(null);
  }, [status]);
  const pane = previewPane(p.playables, ownVideo);
  const hasPane = pane.length > 0;
  // the previews are the player's panel: the list has the page's column to itself, in one column
  const inRail = hasPane && !!slot;
  const stacked = hasPane && !inRail && p.tracks.length <= 5;
  const cols = !inRail && ((!hasPane && p.tracks.length >= 8) || (hasPane && !stacked && p.tracks.length >= 21));

  // the queue moved on: the pane scrolls itself (never the page) so the docked song is in view
  const docked = track?.trackId;
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane || docked == null) return;
    const el = pane.querySelector<HTMLElement>(`[data-id="${docked}"]`);
    if (!el) return;
    if (pane.scrollWidth > pane.clientWidth + 1) {
      if (el.offsetLeft < pane.scrollLeft || el.offsetLeft + el.offsetWidth > pane.scrollLeft + pane.clientWidth)
        pane.scrollTo({ left: el.offsetLeft - 20, behavior: "smooth" });
    } else if (pane.scrollHeight > pane.clientHeight + 1) {
      if (el.offsetTop < pane.scrollTop || el.offsetTop + el.offsetHeight > pane.scrollTop + pane.clientHeight)
        pane.scrollTo({ top: el.offsetTop - 8, behavior: "smooth" });
    }
  }, [docked]);

  const row = (t: AlbumTrack) => {
    const i = p.playables.findIndex((x) => x.trackId === t.id);
    const own = ownVideo.get(t.id) ?? null;
    const open = own != null && watching === t.id;
    const cur = isCurrent(t.id);
    const inner = (
      <>
        <span className={a.n}>
          <b>{t.n}</b>
          {/* the docked song's bars; any other row with a preview, the kit's one hover-play on its number */}
          {cur ? <Bars live={status === "playing"} className={a.nMark} /> : (i >= 0 || own != null) && <PlayOver bare size={14} />}
        </span>
        <span className={a.t}>
          {/* the title's own line, which carries the leader to the length on a wide page */}
          <span className={a.tLine}>
            <span>{t.title}</span>
            {t.featured.length > 0 && <span className={a.feat}> feat. {t.featured.join(", ")}</span>}
          </span>
          {p.songWords[String(t.id)] && <span className={a.songWords}>{p.songWords[String(t.id)].join(" · ")}</span>}
        </span>
        <span className={a.len}>{fmtTime(t.seconds)}</span>
      </>
    );
    return (
      <li key={t.id} className={share ? a.item : undefined}>
        {own != null ? (
          <button
            type="button"
            className={a.row}
            aria-pressed={open}
            aria-label={open ? `Close the ${t.title} music video` : `Watch the ${t.title} music video`}
            onClick={() => {
              // the dock pauses while the artist's own video plays
              if (!open && status === "playing") toggle();
              setWatching(open ? null : t.id);
            }}
          >
            {inner}
          </button>
        ) : i >= 0 ? (
          <button
            type="button"
            className={a.row}
            data-status={cur ? status : undefined}
            aria-pressed={cur}
            aria-label={cur && status !== "paused" ? `Pause ${t.title}` : `Play ${t.title}`}
            onClick={() => (cur ? toggle() : playList(p.playables, i))}
          >
            {inner}
          </button>
        ) : (
          <div className={a.row}>{inner}</div>
        )}
        {/* beside the row, never inside its button; a song with no video says so before sending */}
        {share && (
          <ShareSong albumSlug={p.slug} trackId={t.id} title={t.title} hasVideo={i >= 0} className={a.share} />
        )}
        {open && own && (
          <div className={a.ownVideo}>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video key={own} src={own} controls autoPlay playsInline preload="metadata" aria-label={`${t.title}, the artist's music video`} />
          </div>
        )}
      </li>
    );
  };

  // disc groups in order; heads only on a genuinely multi-disc record
  const groups: Array<{ disc: number; tracks: AlbumTrack[] }> = [];
  for (const t of p.tracks) {
    const g = groups[groups.length - 1];
    if (g && g.disc === t.disc) g.tracks.push(t);
    else groups.push({ disc: t.disc, tracks: [t] });
  }
  const list = groups.map((g) => (
    <Fragment key={g.disc}>
      {p.multiDisc && <h3 className={a.disc}>Disc {g.disc}</h3>}
      <ol className={a.list} data-cols={cols || undefined}>
        {g.tracks.map(row)}
      </ol>
    </Fragment>
  ));

  // a preview listed as a row carries its song's number, as every song list does: the kit's hover-play over
  // the number, the playing bars in its place; laid out as tiles, the still keeps the big disc
  const numberOf = new Map(p.tracks.map((t) => [t.id, t.n]));
  const item = (x: Playable, idx: number, rowed = false) => {
    const cur = isCurrent(x.trackId);
    return (
      <li key={x.trackId} data-id={x.trackId}>
        <button
          type="button"
          className={a.pv}
          data-n={rowed || undefined}
          data-status={cur ? status : undefined}
          aria-pressed={cur}
          aria-label={cur && status !== "paused" ? `Pause ${x.title}` : `Play ${x.title}`}
          onClick={() => (cur ? toggle() : playList(p.playables, idx))}
        >
          {rowed && (
            <span className={a.n}>
              <b>{numberOf.get(x.trackId) ?? idx + 1}</b>
              {cur ? <Bars live={status === "playing"} className={a.nMark} /> : <PlayOver bare size={16} />}
            </span>
          )}
          <Thumb x={x} over={!cur && !rowed} />
          <span className={a.pvTitle}>
            {cur && <Bars live={status === "playing"} className={a.pvBars} />}
            {x.title}
          </span>
        </button>
      </li>
    );
  };
  const rows = (x: Playable, idx: number) => item(x, idx, true);

  return (
    <section id="songs" className={`${k.own} ${a.section}`} aria-labelledby="songs-head">
      <div className={k.wrap}>
        <SectionHead id="songs-head">
          Tracklist.
        </SectionHead>
        {stacked ? (
          <div className={a.tlStack}>
            <div className={a.listCol}>{list}</div>
            <div>
              <p className={a.paneHead}>Preview the album</p>
              <ul ref={paneRef} className={a.tiles}>
                {pane.map(({ x, idx }) => item(x, idx))}
              </ul>
            </div>
          </div>
        ) : inRail && slot ? (
          <div className={a.tl} data-solo="">
            <div className={a.listCol}>{list}</div>
            {createPortal(
              <div className={a.railPane}>
                <p className={a.paneHead}>Preview the album</p>
                <ul ref={paneRef} className={a.pane}>
                  {pane.map(({ x, idx }) => rows(x, idx))}
                </ul>
              </div>,
              slot,
            )}
          </div>
        ) : (
          <div className={a.tl} data-solo={!hasPane || undefined}>
            <div className={a.listCol}>{list}</div>
            {hasPane && (
              <div className={a.paneCol}>
                {/* the pane's content sits inside its column, so the row is sized by the list alone */}
                <div className={a.paneIn}>
                  <p className={a.paneHead}>Preview the album</p>
                  <ul ref={paneRef} className={a.pane}>
                    {pane.map(({ x, idx }) => rows(x, idx))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
