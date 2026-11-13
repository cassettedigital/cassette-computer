"use client";

/**
 * Two lanes, never dressed as each other (the founder, 2026-10-21: "the right rail will play music YOU
 * OWN. Not preview music"), and a computer's shape, not a phone's (2026-10-22: the right rail "borrows
 * some mobile conventions, but it's not literally a phone"; the old desktop app's split was the model):
 *
 *   PlayerBar  the player, along the window's foot: what's on (its cover shows its record in the side
 *              view), shuffle / previous / play / next / repeat over the line and its times, then the
 *              loudness, Up next, Devices, the full window and the side view's key. Every kind of music
 *              plays here, the same way: the records on the Mac, the radio, and a YouTube preview (the
 *              founder, 2026-10-28: the player tells them apart by ownership, not by how they play; a
 *              preview's one difference is the quiet line that says so).
 *   Rail       the side view (Rail.tsx): anything clicked in the library, looked into and played from.
 *   Booth      a YouTube preview, from a record's page: its video at the top of the side view, which
 *              stays yours to browse underneath it (or a card while the side view is away), drawn as a
 *              side view like the station's: the video full width and at least 200 by 200 (YouTube's
 *              minimum, with nothing over it), plainly labelled a preview, an X to close it, Play and
 *              Pause on the left and the way back on the right: "Play your copy" when you own the
 *              record, else the next preview. It folds away when the preview ends.
 *   Room       the player given the whole window (/playing).
 *
 * Hooks for the pages: useTint (the record's colour), useStartRecord / useRecordDisc (start a record on
 * the Mac), useStationDisc (tune in).
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { accentVars, useCoverAccent } from "@/app/_taste/colour";
import { useRadio } from "@/app/components/radio/RadioProvider";
import { usePlayer, usePlayerTime, useFrameHooks } from "@/app/(taste)/_kit/player";
import { YouTubeFrame } from "@/app/(taste)/_kit/YouTubeFrame";
import { ladderSrc } from "@/lib/images/picture";
import {
  Ambient,
  Glyph,
  Heading,
  PlayerArt,
  PlayerTitle,
  PlayerTransport,
  QueueModes,
  Pills,
  PlayPill,
  Rows,
  Scrubber,
  Segmented,
  ShufflePill,
  StationLine,
  TrackRow,
  TransportGlyph,
  useContextMenu,
  Volume,
  WordArt,
  type PlayState,
  type TilePlay,
} from "@discovery/cassette-kit";
import { Art, albumCovers, trackCovers } from "./Art";
import { PreviewSlot, useAside, useDesk, useLeaveRoom } from "./DeskShell";
import { useOwned, useOwnedTime } from "./owned";
import { useKeepPlaying } from "./keep-playing";
import { offlineWords, useOnline } from "./network";
import { useRadioSong, useSongMenu, useSongsMenu, type RadioSong } from "./Shelves";
import { useSongPicks } from "./picks";
import { songsOfRecordNow } from "./songs";
import { useShell } from "@/app/dashboard/_shell/shell-context";
import { DESK, deskAlbum, deskArtist, deskArtistOf, type DeskAlbum, type DeskStation, type OwnedTrack } from "./types";
import d from "./desk.module.css";

const mmss = (s: number | null | undefined) =>
  s == null || !Number.isFinite(s) ? null : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** The picture a record's colour is read from: the side view, the player bar and Home's cards all read it here,
    so one record wears one colour wherever it shows. */
export const tintCover = (a: Pick<DeskAlbum, "catalogCoverSmall" | "overrideCover">) => a.catalogCoverSmall ?? a.overrideCover;

/** The record's colour as the kit's tint, and as the taste pages' accent, each in a version for both papers. */
export function useTint(src: string | null | undefined): CSSProperties {
  const accent = useCoverAccent(src ?? null);
  const paper = accentVars(accent) as Record<string, string>;
  return { ...paper, "--pk-tint-text": paper["--accent-ink"], "--pk-tint-glow": accent } as CSSProperties;
}

/** Start a record on the Mac by its key, optionally on a named song. */
export function useStartRecord() {
  const owned = useOwned();
  return { start: owned.playRecord, pending: owned.pending };
}

/** A cover's play disc: starts the record on the deck, or pauses and resumes it while it's the one on. */
export function useRecordDisc() {
  const owned = useOwned();
  const st = useStartRecord();
  return useCallback(
    (a: Pick<DeskAlbum, "key" | "title">): TilePlay => {
      const mine = owned.track?.albumKey === a.key;
      const moving = mine && owned.status === "playing";
      return {
        state: moving ? "pause" : "play",
        label: mine ? (moving ? `Pause ${a.title}` : `Resume ${a.title}`) : `Play ${a.title}`,
        busy: st.pending === a.key,
        onClick: () => (mine ? owned.toggle() : void st.start(a.key)),
      };
    },
    [owned, st],
  );
}

/** A station's play disc (the phone's: tune in, or stop while it is on). With no internet it says so. */
export function useStationDisc() {
  const radio = useRadio();
  const online = useOnline();
  const { showToast } = useShell();
  return useCallback(
    (s: Pick<DeskStation, "slug" | "name">): TilePlay => {
      const on = radio.isCurrent(s.slug) && radio.status !== "idle";
      if (!online && !on) return { state: "play", label: "Radio needs the internet", onClick: () => showToast("Radio needs the internet") };
      return { state: on ? "stop" : "play", label: on ? `Stop ${s.name}` : `Tune in to ${s.name}`, busy: on && radio.status === "connecting", onClick: () => radio.toggle(s.slug) };
    },
    [radio, online, showToast],
  );
}

/** The YouTube player itself, drawn once by the shell's host over the booth's slot. */
export function Preview() {
  const { track } = usePlayer();
  const hooks = useFrameHooks();
  if (!track) return null;
  return (
    <YouTubeFrame
      videoId={track.videoId}
      fallbackVideoIds={track.fallbackVideoIds}
      onPlaying={hooks.onPlaying}
      onPaused={hooks.onPaused}
      onEnded={hooks.onEnded}
      onUnplayable={hooks.onUnplayable}
      apiRef={hooks.apiRef}
    />
  );
}

function OwnedScrubber({ inline }: { inline?: boolean }) {
  const { track, seek, reachable } = useOwned();
  const elapsed = useOwnedTime();
  return <Scrubber elapsed={elapsed} duration={track?.seconds ?? null} onSeek={reachable === false ? undefined : seek} inline={inline} />;
}

/** The music's own loudness, in the bar (only while it's the Mac's music on). */
function OwnedVolume() {
  const { volume, setVolume } = useOwned();
  return <Volume value={volume} onChange={setVolume} />;
}

/** Up Next's shuffle, repeat and keep playing, as the phone's queue header has them. */
function OwnedModes() {
  const { shuffle, repeat, toggleShuffle, cycleRepeat } = useOwned();
  const keep = useKeepPlaying();
  return (
    <QueueModes
      shuffle={shuffle}
      repeat={repeat}
      onShuffle={toggleShuffle}
      onRepeat={cycleRepeat}
      keepPlaying={{ state: !keep.on ? "off" : keep.waiting ? "waiting" : "on", onToggle: keep.toggle }}
    />
  );
}

/** The song's record on the shelf, when it's there. */
function useRecordOf(t: OwnedTrack | null) {
  const { shelf } = useDesk();
  return useMemo(() => (t?.albumKey ? (shelf.find((a) => a.key === t.albumKey) ?? null) : null), [shelf, t]);
}

/* ── the side view's queue ── */

export function UpNext({ cap }: { cap?: number }) {
  const { track, queue, status, playList, toggle } = useOwned();
  const keep = useKeepPlaying();
  const songMenu = useSongMenu();
  const songsMenu = useSongsMenu();
  const cm = useContextMenu();
  // a click selects a song here as in every list (the queue's own order, Shift and Command for several);
  // only the play symbol on its number jumps to it
  const picks = useSongPicks(queue);
  if (!track) return <p className={d.quiet}>Nothing's playing.</p>;
  // keep playing's pick waits at the end of the queue: it shows under THEN, not in Up Next
  const inPick = new Set(keep.tail);
  const ahead = queue.filter((x) => !inPick.has(x.subsonicTrackId ?? ""));
  const pick = queue.filter((x) => inPick.has(x.subsonicTrackId ?? ""));
  const pickAt = queue.length - pick.length;
  const rest = cap ? ahead.slice(0, cap) : ahead;
  return (
    <section className={d.upnext} aria-labelledby="upnext-head">
      <div className={d.upnextHead}>
        <Heading id="upnext-head" shout="Up next" answer={ahead[0]?.album ?? track.album} />
        <OwnedModes />
      </div>
      <Rows label="Up next">
        {/* each song under its own artist as its file names it ("Gorillaz feat. Thundercat") */}
        {/* counted from the song playing (its number under the waveform), so the hover-play stands on the
            number here as in every song list */}
        <TrackRow number={1} art={<Art src={trackCovers(track, 48)} sizes="48px" size={48} />} title={track.title} line={track.songArtist ?? track.artist} playing live={status === "playing"} onSelect={() => {}} onPlay={toggle} onContextMenu={(e) => cm.open(e, songMenu(track))} />
        {rest.map((x, i) => (
          <TrackRow
            key={x.key}
            number={i + 2}
            art={<Art src={trackCovers(x, 48)} sizes="48px" size={48} />}
            title={x.title}
            line={x.songArtist ?? x.artist}
            length={mmss(x.seconds)}
            label={`Play ${x.title}`}
            selected={picks.isPicked(i)}
            onSelect={picks.onSelect(i)}
            onPlay={() => playList(queue, i)}
            onContextMenu={(e) => cm.open(e, songsMenu(picks.take(i), { play: [{ label: "Play", onSelect: () => playList(queue, i) }] }))}
          />
        ))}
      </Rows>
      {pick.length > 0 && keep.heading && (
        <>
          <div className={d.upnextHead}>
            <Heading id="then-head" shout={keep.heading.shout} answer={keep.heading.answer} />
            {keep.kind === "album" && (
              <button type="button" className={d.swapKey} onClick={keep.swap} title="Another record like it">
                Swap
              </button>
            )}
          </div>
          <Rows label={`${keep.heading.shout}, ${keep.heading.answer}`}>
            {keep.kind === "album" ? (
              <TrackRow
                art={<Art src={trackCovers(pick[0], 48)} sizes="48px" size={48} />}
                title={pick[0].album}
                line={pick[0].artist}
                length={`${pick.length} songs`}
                label={`Play ${pick[0].album} now`}
                onSelect={() => {}}
                onPlay={() => playList(queue, pickAt)}
              />
            ) : (
              pick.slice(0, cap ?? 8).map((x, i) => (
                <TrackRow
                  key={x.key}
                  number={pickAt + i + 2}
                  art={<Art src={trackCovers(x, 48)} sizes="48px" size={48} />}
                  title={x.title}
                  line={x.songArtist ?? x.artist}
                  length={mmss(x.seconds)}
                  label={`Play ${x.title}`}
                  selected={picks.isPicked(pickAt + i)}
                  onSelect={picks.onSelect(pickAt + i)}
                  onPlay={() => playList(queue, pickAt + i)}
                  onContextMenu={(e) => cm.open(e, songsMenu(picks.take(pickAt + i), { play: [{ label: "Play", onSelect: () => playList(queue, pickAt + i) }] }))}
                />
              ))
            )}
          </Rows>
        </>
      )}
      {queue.length === 0 && <p className={d.quiet}>{keep.on && !keep.waiting ? "Nothing lined up after this song yet." : "The record ends after this song."}</p>}
      {cm.menu}
    </section>
  );
}

/* ── what the player shows: a preview while one is up, the radio when it's on, else your song, else the
      last one played, paused ── */

type Face = {
  /** whose music it is: the Mac's (shuffle, repeat and the loudness are its own), a station, or a preview */
  lane: "mac" | "radio" | "preview";
  /** a quiet line over the title that isn't a station's: a preview says so, and whether it's yours */
  note?: string;
  art: ReactNode;
  glow: string | string[] | null;
  station: { mark: ReactNode | null; text: string } | null;
  title: string;
  artist: ReactNode;
  /** the line and its times: under the title (the full window), or either side (the bar) */
  scrubber: (inline?: boolean) => ReactNode;
  state: PlayState;
  playing: boolean;
  onToggle: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  previousLabel?: string;
  nextLabel?: string;
  queue: boolean;
  tintSrc: string | null;
  /** the art is a station's own mark (rounded like an app icon), not what it's playing */
  icon?: boolean;
  albumHref?: string;
  /** the Mac isn't answering: its records can't play until it does */
  offline?: boolean;
  /** the song itself, for the menu a right click on it opens (Shelves useSongMenu); none for a station */
  song?: OwnedTrack | null;
  /** the song on a station, for its own menu (Shelves useRadioSong): its record and artist on Cassette */
  radioSong?: RadioSong | null;
};

function useFace(): Face | null {
  const owned = useOwned();
  const radio = useRadio();
  const preview = usePlayer();
  const { stations, resume, shelf } = useDesk();
  const record = useRecordOf(owned.track);
  const st = useStartRecord();
  const offline = owned.reachable === false;
  const online = useOnline();
  const radioOn = !!radio.station && radio.status !== "idle";

  // a preview is music like any other: the bar plays it (a paused one gives way to the radio on)
  if (preview.track && (!radioOn || preview.status !== "paused")) {
    const t = preview.track;
    const yours = t.albumSlug ? shelf.some((a) => a.slug === t.albumSlug) : false;
    return {
      lane: "preview",
      note: yours ? "Preview" : "Preview · not in your library",
      art: <Art src={t.cover} sizes="372px" priority />,
      glow: t.cover,
      station: null,
      title: t.title,
      artist: <Link href={deskArtist(t.artistSlug)}>{t.artist}</Link>,
      scrubber: (inline) => <PreviewScrubber inline={inline} />,
      state: preview.status === "paused" ? "play" : "pause",
      playing: preview.status === "playing",
      onToggle: preview.toggle,
      onNext: preview.queue.length ? preview.next : undefined,
      nextLabel: preview.queue[0] ? `Next: ${preview.queue[0].title}` : "Next",
      queue: false,
      tintSrc: t.cover,
      albumHref: t.albumSlug ? deskAlbum(t.albumSlug) : undefined,
    };
  }

  if (radioOn && radio.station) {
    const s = radio.station;
    const np = radio.nowPlaying;
    const live = np?.match?.coverFullUrl ?? np?.match?.coverUrl ?? np?.track?.coverUrl ?? np?.show?.image ?? s.image ?? null;
    const at = stations.findIndex((x) => x.slug === s.slug);
    const step = (by: number) => {
      const n = stations[(at + by + stations.length) % stations.length];
      if (n) radio.play(n.slug);
    };
    const canStep = at >= 0 && online;
    const until = np?.show?.until ? new Date(np.show.until) : null;
    return {
      lane: "radio",
      art: live ? <Art src={live} sizes="372px" priority /> : <WordArt name={s.name} accent={s.accent} />,
      glow: live,
      station: { mark: s.image ? <Art src={s.image} sizes="22px" size={22} /> : null, text: ((net) => (net && net !== s.name ? `${s.name} · ${net}` : s.name))(stations[at]?.network ?? "") },
      title: np?.track?.title ?? np?.show?.name ?? s.name,
      artist: np?.track?.artist ?? np?.show?.host ?? np?.show?.genres?.slice(0, 2).join(" · ") ?? "",
      scrubber: (inline) => <Scrubber live inline={inline} note={until && !Number.isNaN(until.getTime()) ? `Until ${until.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : undefined} />,
      state: "stop",
      playing: radio.status === "playing",
      onToggle: radio.stop,
      onPrevious: canStep ? () => step(-1) : undefined,
      onNext: canStep ? () => step(1) : undefined,
      previousLabel: "Previous station",
      nextLabel: "Next station",
      queue: false,
      tintSrc: live,
      icon: !live || live === s.image,
      radioSong: np?.track ? { title: np.track.title, artist: np.track.artist, match: np.match } : null,
    };
  }

  if (owned.track) {
    const t = owned.track;
    return {
      lane: "mac",
      art: <Art src={record ? albumCovers(record, 600) : trackCovers(t, 600)} sizes="372px" priority />,
      glow: record ? albumCovers(record, 64) : trackCovers(t, 64),
      station: null,
      title: t.title,
      // the song's own artist as its file names it ("Gorillaz feat. Thundercat"); the link is its record's
      artist: t.artistSlug ? <Link href={deskArtist(t.artistSlug)}>{t.songArtist ?? t.artist}</Link> : (t.songArtist ?? t.artist),
      scrubber: (inline) => <OwnedScrubber inline={inline} />,
      state: owned.status === "playing" ? "pause" : "play",
      playing: owned.status === "playing",
      onToggle: owned.toggle,
      onPrevious: owned.previous,
      onNext: owned.queue.length ? owned.next : undefined,
      nextLabel: owned.queue[0] ? `Next: ${owned.queue[0].title}` : "Next",
      queue: true,
      tintSrc: (record ? tintCover(record) : null) ?? t.cover ?? t.coverOverride,
      albumHref: record ? deskAlbum(record) : undefined,
      offline,
      song: t,
    };
  }

  const a = resume ? shelf.find((x) => x.key === resume.key) : undefined;
  if (resume && a) {
    // the song to pick up, once this window has its record's songs; its length fills the line's end
    const pick = (resume.song && songsOfRecordNow(a.key)?.find((x) => x.title === resume.song)) || null;
    return {
      lane: "mac",
      art: <Art src={albumCovers(a, 600)} sizes="372px" priority />,
      glow: albumCovers(a, 64),
      station: null,
      title: resume.song || a.title,
      artist: <Link href={deskArtistOf(a)}>{a.artist}</Link>,
      scrubber: (inline) => <Scrubber elapsed={0} duration={pick?.seconds ?? null} inline={inline} />,
      state: "play",
      playing: false,
      onToggle: () => void st.start(a.key, resume.song || undefined),
      queue: false,
      tintSrc: tintCover(a),
      albumHref: deskAlbum(a),
      offline,
      song: pick,
    };
  }
  return null;
}

/** A preview's line and times; YouTube's player can't be moved by a line, so it's shown, not dragged. */
function PreviewScrubber({ inline }: { inline?: boolean }) {
  const { elapsed, duration } = usePlayerTime();
  return <Scrubber elapsed={elapsed} duration={duration} inline={inline} />;
}

/** A preview's times beside it, for a bar too narrow for them either side of its line (see BarTime). */
function PreviewBarTime() {
  const { elapsed, duration } = usePlayerTime();
  const left = duration ? Math.max(0, duration - elapsed) : null;
  return (
    <span className={d.barTime} aria-hidden="true">
      <span>{mmss(elapsed) ?? "0:00"}</span>
      <span>{left != null ? `-${mmss(left)}` : ""}</span>
    </span>
  );
}

/** The cover, as the full window draws it: a picture, so a click on it goes nowhere (2026-11-06: only words
    open things). */
function Sleeve({ face }: { face: Face }) {
  return <PlayerArt>{face.art}</PlayerArt>;
}

/** The song's time beside it, for a bar too narrow for the times either side of its line (shown by
    desk.module.css .barTime only then): gone, then left; or Live for a station. */
function BarTime({ face }: { face: Face }) {
  const { track } = useOwned();
  const elapsed = useOwnedTime();
  if (face.station) {
    return (
      <span className={d.barTime} aria-hidden="true">
        <span>Live</span>
      </span>
    );
  }
  if (!face.queue || !track) return null;
  const left = track.seconds ? Math.max(0, track.seconds - elapsed) : null;
  return (
    <span className={d.barTime} aria-hidden="true">
      <span>{mmss(elapsed) ?? "0:00"}</span>
      <span>{left != null ? `-${mmss(left)}` : ""}</span>
    </span>
  );
}

/* ── the player: one bar along the window's foot, as a computer's music app has it ── */

export function PlayerBar() {
  const face = useFace();
  const desk = useDesk();
  const owned = useOwned();
  const aside = useAside();
  const tint = useTint(face?.tintSrc);
  const keep = useKeepPlaying();
  const queueOn = !aside.away && aside.tab === "queue";
  // shuffle, repeat, keep playing and the loudness are the Mac's player's own: there for a record (on,
  // or ready to pick up), not for a station or a preview
  const mac = face?.lane === "mac";
  const keepState = !keep.on ? "off" : keep.waiting ? "waiting" : "on";
  const keepLabel = keepState === "on" ? "Keep playing: on" : keepState === "waiting" ? "Keep playing: waiting while repeat is on" : "Keep playing: off";
  // a right click on the song gives the menu it has everywhere (Shelves useSongMenu)
  const songMenu = useSongMenu();
  const radioSong = useRadioSong();
  const cm = useContextMenu();
  const song = face?.song ?? null;
  const heard = face?.radioSong ?? null;
  return (
    <>
      <section className={d.bar} style={tint} aria-label="Player" data-playing={face?.playing || undefined}>
        <div className={d.barNow} onContextMenu={song ? (e) => cm.open(e, songMenu(song)) : heard ? (e) => cm.open(e, radioSong.menu(heard)) : undefined}>
          {face ? (
            <>
              <button type="button" className={d.barArt} data-app={face.icon || undefined} onClick={aside.follow} aria-label="Show this record in the side view" title="Show this record">
                {face.art}
              </button>
              <span className={d.barText}>
                {(face.station || face.note) && <span className={d.barStation}>{face.station?.text ?? face.note}</span>}
                <span className={d.barTitle}>{face.title}</span>
                <span className={d.barBy}>{face.artist}</span>
              </span>
              {face.lane === "preview" ? <PreviewBarTime /> : <BarTime face={face} />}
            </>
          ) : (
            <span className={d.barIdle}>Nothing playing</span>
          )}
        </div>
        <div className={d.barMiddle}>
          <div className={d.barKeys}>
            {/* keep playing sits after repeat, as on the iPhone's Now Playing and in the car (founder,
                2026-11-12); this empty slot balances it, so the play key stays in the middle */}
            <span className={d.barMode} />
            {mac ? (
              <button type="button" className={d.barMode} aria-pressed={owned.shuffle} aria-label="Shuffle" title={owned.shuffle ? "Shuffle: on" : "Shuffle: off"} onClick={owned.toggleShuffle}>
                <Glyph name="shuffle" size={15} />
              </button>
            ) : (
              <span className={d.barMode} />
            )}
            <button type="button" className={d.topKey} aria-label={face?.previousLabel ?? "Previous"} disabled={!face?.onPrevious} onClick={face?.onPrevious}>
              <TransportGlyph name="previous" size={18} />
            </button>
            <button type="button" className={d.miniPlay} aria-label={face?.state === "pause" ? "Pause" : face?.state === "stop" ? "Stop" : "Play"} disabled={!face} onClick={face?.onToggle}>
              <TransportGlyph name={face?.state ?? "play"} size={18} />
            </button>
            <button type="button" className={d.topKey} aria-label={face?.nextLabel ?? "Next"} disabled={!face?.onNext} onClick={face?.onNext}>
              <TransportGlyph name="next" size={18} />
            </button>
            {mac ? (
              <button
                type="button"
                className={d.barMode}
                aria-pressed={owned.repeat !== "off"}
                aria-label={owned.repeat === "off" ? "Repeat: off" : owned.repeat === "all" ? "Repeat: all" : "Repeat: this song"}
                title={owned.repeat === "off" ? "Repeat: off" : owned.repeat === "all" ? "Repeat: all" : "Repeat: this song"}
                onClick={owned.cycleRepeat}
              >
                <Glyph name={owned.repeat === "one" ? "repeatOne" : "repeat"} size={15} />
              </button>
            ) : (
              <span className={d.barMode} />
            )}
            {mac ? (
              <button
                type="button"
                className={d.barMode}
                data-waiting={keepState === "waiting" || undefined}
                aria-pressed={keepState === "on"}
                aria-label={keepLabel}
                title={keepLabel}
                onClick={keep.toggle}
              >
                <Glyph name="keepPlaying" size={15} />
              </button>
            ) : (
              <span className={d.barMode} />
            )}
          </div>
          <div className={d.barScrub}>{face ? face.scrubber(true) : <Scrubber elapsed={0} duration={null} inline />}</div>
        </div>
        {/* the loudness sits left of these keys when there's room, and under them in a tight window
            (desk.module.css .barEnd) */}
        <div className={d.barEnd}>
          <div className={d.barEndKeys}>
          {face?.offline && (
            <span className={d.barWarn} title={offlineWords(desk.mac?.name).head}>
              <Glyph name="laptop" size={15} />
            </span>
          )}
          <button type="button" className={d.topKey} aria-label="Up next" title="Up next" aria-pressed={queueOn} onClick={() => aside.showQueue(!queueOn)}>
            <Glyph name="list" size={16} />
          </button>
          <Link href={`${DESK}/devices`} className={d.topKey} aria-label="Devices" title="Devices">
            <Glyph name="airplay" size={16} />
          </Link>
          <Link href={`${DESK}/playing`} className={d.topKey} aria-label="Fill the window" title="Fill the window">
            <Glyph name="expand" size={15} />
          </Link>
          <button
            type="button"
            className={d.topKey}
            aria-label={aside.away ? "Show the side view" : "Put the side view away"}
            title={aside.away ? "Show the side view" : "Put the side view away"}
            onClick={() => aside.setAway(!aside.away)}
          >
            {aside.away ? <PanelRightOpen size={16} strokeWidth={2} aria-hidden="true" /> : <PanelRightClose size={16} strokeWidth={2} aria-hidden="true" />}
          </button>
          </div>
          {mac && (
            <span className={d.barVolume}>
              <OwnedVolume />
            </span>
          )}
        </div>
      </section>
      {/* beside the bar, not in it: the bar sits under the side view when that floats over */}
      {cm.menu}
    </>
  );
}

/* ── the booth: a YouTube preview's video and its keys. It sits at the top of the side view, over
      whatever the side view is showing, so the side view stays yours to browse beneath it (the
      founder, 2026-10-29: keep the video "pinned EXACTLY where it is and basically open up a new rail
      below it"); while the side view is away it floats as a card. It unfolds when a preview starts and
      folds away when it ends, by its X or because other music started, rather than vanishing. Drawn
      as a side view like the station's: its surface, head, title and pills (2026-10-28). ── */

/** How long the video takes to fold away (desk.module.css .booth). */
const FOLD_MS = 320;

/** The preview's song, kept a moment after it ends so the video can fold away, and whether a new one
    unfolds (one already up when the side view comes back simply shows). */
function useBoothTrack() {
  const { track: now } = usePlayer();
  const [kept, setKept] = useState(now);
  const [unfold, setUnfold] = useState(false);
  useEffect(() => {
    if (now) {
      setKept(now);
      return;
    }
    setUnfold(true);
    const ms = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : FOLD_MS;
    const t = window.setTimeout(() => setKept(null), ms);
    return () => window.clearTimeout(t);
  }, [now]);
  return { track: now ?? kept, leaving: !now && !!kept, unfold };
}

export function Booth({ floating }: { floating?: boolean }) {
  const { queue, status, toggle, next, stop } = usePlayer();
  const { track, leaving, unfold } = useBoothTrack();
  const { shelf } = useDesk();
  const st = useStartRecord();
  const tint = useTint(track?.cover);
  if (!track) return null;
  const onMac = track.albumSlug ? shelf.find((a) => a.slug === track.albumSlug) : undefined;
  const moving = !leaving && (status === "playing" || status === "loading");
  return (
    <section
      className={d.booth}
      data-float={floating || undefined}
      data-unfold={unfold || undefined}
      data-leaving={leaving || undefined}
      data-clip="" /* the video shows only as much of itself as the booth does (DeskShell PreviewHost) */
      style={tint}
      aria-label="Preview"
      inert={leaving || undefined}
    >
      <div className={d.boothInner}>
        <div className={d.asideHead} data-tauri-drag-region={floating ? undefined : "deep"}>
          <Segmented<"preview"> label="Showing" value="preview" onChange={() => {}} options={[["preview", "Preview"]]} />
          <span className={d.boothFrom}>from YouTube</span>
          <span className={d.asideKeys}>
            <button type="button" className={d.topKey} aria-label="Close the preview" title="Close the preview" onClick={stop}>
              <Glyph name="close" size={14} />
            </button>
          </span>
        </div>
        <div className={d.boothBody}>
          {/* the video in the picture's place: full width, at least 200 by 200 (YouTube's minimum),
              nothing drawn over it. Folding away, the song has already stopped: its cover holds the place */}
          {leaving ? (
            <div className={d.boothVideo} style={track.cover ? { backgroundImage: `url("${ladderSrc(track.cover, 800)}")` } : undefined} />
          ) : (
            <PreviewSlot className={d.boothVideo} />
          )}
          <div className={d.boothText}>
            <h2 className={d.lookTitle}>{track.title}</h2>
            <p className={d.lookBy}>
              <Link href={deskArtist(track.artistSlug)}>{track.artist}</Link>
              {track.album && (
                <>
                  {" · "}
                  {track.albumSlug ? <Link href={deskAlbum(track.albumSlug)}>{track.album}</Link> : track.album}
                </>
              )}
            </p>
            {!onMac && <p className={d.lookFacts}>Not in your library</p>}
          </div>
          {/* play on the left, as everywhere; on the right, the way back to your own copy when you have
              it, else the next preview (the rest are the side view's Up next) */}
          <Pills>
            <PlayPill state={moving ? "pause" : "play"} onClick={toggle} />
            {onMac ? (
              <ShufflePill
                word="Play your copy"
                glyph={<Glyph name="laptop" size={14} />}
                onClick={() => {
                  stop();
                  void st.start(onMac.key, track.title);
                }}
              />
            ) : (
              <ShufflePill word="Next" glyph={<TransportGlyph name="next" size={14} />} disabled={!queue.length} onClick={next} />
            )}
          </Pills>
        </div>
      </div>
    </section>
  );
}

/** Up next while a preview plays: the previews after it, in the side view's Up next (a click plays one). */
export function PreviewUpNext() {
  const { track, queue, status, play, toggle } = usePlayer();
  const picks = useSongPicks(queue.map((x, i) => ({ key: `${x.trackId}-${i}` })));
  if (!track) return null;
  return (
    <section className={d.upnext} aria-labelledby="preview-next">
      <Heading id="preview-next" shout="Up next" answer={queue[0]?.album ?? track.album ?? undefined} />
      <Rows label="Previews up next">
        <TrackRow number={1} art={track.cover ? <Art src={track.cover} sizes="48px" size={48} /> : undefined} title={track.title} line={track.artist} playing live={status === "playing"} onSelect={() => {}} onPlay={toggle} />
        {queue.map((x, i) => (
          <TrackRow
            key={`${x.trackId}-${i}`}
            number={i + 2}
            art={x.cover ? <Art src={x.cover} sizes="48px" size={48} /> : undefined}
            title={x.title}
            line={x.artist}
            length={mmss(x.seconds)}
            label={`Preview ${x.title}`}
            selected={picks.isPicked(i)}
            onSelect={picks.onSelect(i)}
            onPlay={() => play(x, queue.slice(i + 1))}
          />
        ))}
      </Rows>
      {queue.length === 0 && <p className={d.quiet}>No more previews after this one.</p>}
    </section>
  );
}

/** The player given the whole window. */
export function Room() {
  const face = useFace();
  const leaveRoom = useLeaveRoom();
  const tint = useTint(face?.tintSrc);
  const songMenu = useSongMenu();
  const cm = useContextMenu();
  if (!face) return null;
  const song = face.song ?? null;
  const onMenu = song ? (e: ReactMouseEvent) => cm.open(e, songMenu(song)) : undefined;
  return (
    <div className={d.room} style={tint} data-playing={face.playing || undefined}>
      <Ambient art={face.glow ? <Art src={face.glow} sizes="64px" size={64} /> : null} playing={face.playing} />
      <div className={d.roomStage} onContextMenu={onMenu}>
        <Sleeve face={face} />
      </div>
      <div className={d.roomSide}>
        <div className={d.deckTop}>
          <button type="button" className={d.topKey} aria-label="Back" title="Back (Esc)" onClick={leaveRoom}>
            <Glyph name="collapse" size={15} />
          </button>
        </div>
        {face.station ? <StationLine mark={face.station.mark} text={face.station.text} /> : face.note && <StationLine mark={null} text={face.note} />}
        <div onContextMenu={onMenu}>
          <PlayerTitle title={face.title} artist={face.artist} />
        </div>
        {face.scrubber()}
        <div className={d.deckTransport}>
          <PlayerTransport state={face.state} onToggle={face.onToggle} onPrevious={face.onPrevious} onNext={face.onNext} previousLabel={face.previousLabel} nextLabel={face.nextLabel} />
        </div>
        {face.queue && <UpNext cap={10} />}
      </div>
      {cm.menu}
    </div>
  );
}
