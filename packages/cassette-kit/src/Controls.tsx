"use client";

/**
 * The play controls, one per iPhone component:
 *
 *   PlayDisc         CassettePlayDisc: the 34pt cream disc on every cover, 44pt to hit, a drop shadow
 *   PlayPill         makePlayPill: the 48pt filled capsule, PLAY / PAUSE / STOP with its glyph
 *   ShufflePill      makeShufflePill: the clear capsule with a 1.5pt line at 35%
 *   SavePill         RadioStationVC's save pill: the same clear capsule, "+ SAVE", then "✓ SAVED" (one save
 *                    mark everywhere: a plus, then a check, never a heart)
 *   Pills            the two side by side, equal widths, 10pt apart
 *   PlayerTransport  PlayerControlView: previous, the 78pt disc, next, at a quarter, half and three
 *                    quarters of the width; previous and next are bare glyphs
 *   PlayerFoot       the foot row: AirPlay on the left, the queue on the right (a filled capsule while
 *                    the queue is showing), 32pt in from the edges; `middle` sits between them (a
 *                    computer's volume, which a phone leaves to its side buttons)
 *   QueueModes       the Up Next header's shuffle and repeat (ContextQueueNextSectionHeader): shuffle on
 *                    lights its glyph in the live orange on a clear ground; repeat on is a filled
 *                    capsule, its glyph showing all or one
 */

import type { ReactNode } from "react";
import { Glyph, TransportGlyph } from "./Glyph";
import { useKitLink } from "./KitProvider";
import s from "./kit.module.css";

export type PlayState = "play" | "pause" | "stop";

export function PlayDisc({
  state = "play",
  label,
  busy,
  onClick,
  className,
}: {
  state?: PlayState;
  label: string;
  busy?: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={className ? `${s.disc} ${className}` : s.disc}
      aria-label={label}
      data-state={state}
      data-busy={busy || undefined}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
    >
      <span className={s.discFace}>
        <TransportGlyph name={state} size={15} />
      </span>
    </button>
  );
}

const PILL_WORD: Record<PlayState, string> = { play: "Play", pause: "Pause", stop: "Stop" };

export function PlayPill({ state = "play", word, onClick, disabled }: { state?: PlayState; word?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={s.pillPlay} onClick={onClick} disabled={disabled}>
      <TransportGlyph name={state} size={16} />
      <span>{word ?? PILL_WORD[state]}</span>
    </button>
  );
}

export function ShufflePill({ onClick, disabled, word = "Shuffle", glyph }: { onClick: () => void; disabled?: boolean; word?: string; glyph?: ReactNode }) {
  return (
    <button type="button" className={s.pillGhost} onClick={onClick} disabled={disabled}>
      {glyph ?? <Glyph name="shuffle" size={14} />}
      <span>{word}</span>
    </button>
  );
}

/** Save beside Play: `saved` turns the plus into a check and the word into SAVED; a second press takes it back. */
export function SavePill({ saved, onClick, disabled }: { saved: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={s.pillGhost} onClick={onClick} disabled={disabled} aria-pressed={saved}>
      <Glyph name={saved ? "check" : "plus"} size={14} />
      <span>{saved ? "Saved" : "Save"}</span>
    </button>
  );
}

/** Any other pill of Play's family: `fill` for the one thing to do on the page (Rip to library), else the
    ghost; its own glyph and word, never Play's triangle (a play is always the Play pill). */
export function Pill({ word, glyph, onClick, disabled, fill }: { word: string; glyph?: ReactNode; onClick: () => void; disabled?: boolean; fill?: boolean }) {
  return (
    <button type="button" className={fill ? s.pillPlay : s.pillGhost} onClick={onClick} disabled={disabled}>
      {glyph}
      <span>{word}</span>
    </button>
  );
}

export function Pills({ children }: { children: ReactNode }) {
  return <div className={s.pills}>{children}</div>;
}

export function PlayerTransport({
  state,
  onToggle,
  onPrevious,
  onNext,
  previousLabel = "Previous",
  nextLabel = "Next",
}: {
  state: PlayState;
  onToggle: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  previousLabel?: string;
  nextLabel?: string;
}) {
  return (
    <div className={s.transport}>
      <button type="button" className={s.side} aria-label={previousLabel} disabled={!onPrevious} onClick={onPrevious}>
        <TransportGlyph name="previous" size={28} />
      </button>
      <button type="button" className={s.big} aria-label={state === "play" ? "Play" : state === "pause" ? "Pause" : "Stop"} onClick={onToggle}>
        <TransportGlyph name={state} size={30} />
      </button>
      <button type="button" className={s.side} aria-label={nextLabel} disabled={!onNext} onClick={onNext}>
        <TransportGlyph name="next" size={28} />
      </button>
    </div>
  );
}

export function PlayerFoot({
  devicesHref,
  queueOn,
  onQueue,
  middle,
}: {
  /** Where the AirPlay glyph goes on a computer: the devices the music could play on. */
  devicesHref?: string;
  queueOn: boolean;
  onQueue?: () => void;
  middle?: ReactNode;
}) {
  const Link = useKitLink();
  return (
    <div className={s.foot}>
      {devicesHref ? (
        <Link href={devicesHref} className={s.footKey} aria-label="Devices">
          <Glyph name="airplay" size={17} />
        </Link>
      ) : (
        <span />
      )}
      {middle && <div className={s.footMiddle}>{middle}</div>}
      {onQueue && (
        <button type="button" className={s.footKey} aria-label="Up next" aria-pressed={queueOn} onClick={onQueue}>
          <Glyph name="list" size={17} />
        </button>
      )}
    </div>
  );
}

export type RepeatMode = "off" | "all" | "one";

export function QueueModes({
  shuffle,
  repeat,
  onShuffle,
  onRepeat,
  keepPlaying,
}: {
  shuffle: boolean;
  repeat: RepeatMode;
  onShuffle: () => void;
  onRepeat: () => void;
  /** Keep playing, after repeat: on, off, or waiting while repeat is on (a press turns repeat off). */
  keepPlaying?: { state: "on" | "off" | "waiting"; onToggle: () => void };
}) {
  const repeatLabel = repeat === "off" ? "Repeat: off" : repeat === "all" ? "Repeat: all" : "Repeat: this song";
  const keepLabel =
    keepPlaying?.state === "on" ? "Keep playing: on" : keepPlaying?.state === "waiting" ? "Keep playing: waiting while repeat is on" : "Keep playing: off";
  return (
    <span className={s.modes}>
      <button type="button" className={s.modeKey} data-mode="shuffle" aria-pressed={shuffle} aria-label="Shuffle" title={shuffle ? "Shuffle: on" : "Shuffle: off"} onClick={onShuffle}>
        <Glyph name="shuffle" size={15} />
      </button>
      <button type="button" className={s.modeKey} data-mode="repeat" aria-pressed={repeat !== "off"} aria-label={repeatLabel} title={repeatLabel} onClick={onRepeat}>
        <Glyph name={repeat === "one" ? "repeatOne" : "repeat"} size={15} />
      </button>
      {keepPlaying && (
        <button
          type="button"
          className={s.modeKey}
          data-mode="keep"
          data-waiting={keepPlaying.state === "waiting" || undefined}
          aria-pressed={keepPlaying.state === "on"}
          aria-label={keepLabel}
          title={keepLabel}
          onClick={keepPlaying.onToggle}
        >
          <Glyph name="keepPlaying" size={15} />
        </button>
      )}
    </span>
  );
}
