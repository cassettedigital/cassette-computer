"use client";

/**
 * The album opener's play button, wired to the page frame's player: one line, "Preview album" (the
 * same words as the artist page's records panel; the shared PlayButton no longer names a song under
 * it). It plays the start song and then the rest of the record in running order (wrapping round, so
 * starting on the last track still plays the record), and while a song from this record is docked it
 * says Playing or Paused and pauses or resumes. The start song is still said to a screen reader.
 */

import { PlayButton } from "./PlayButton";
import type { Playable } from "./play";
import { usePlayer } from "./player";

export function HearIt({
  playables,
  startIndex,
  record,
  verb = "Preview album",
  short = "Preview",
}: {
  /** The record's playable songs in running order. */
  playables: Playable[];
  /** Index into `playables` of the start song (layoutTracks' start song, mapped). */
  startIndex: number;
  /** The record's title, for the button's spoken label. */
  record?: string;
  /** The button's word: "Preview" in the iPhone app's half-width key, where the two words don't fit. */
  verb?: string;
  /** Its short form, for a row of buttons short of room (ActionRow). */
  short?: string;
}) {
  const { track, status, playList, toggle } = usePlayer();
  const start = playables[startIndex];
  if (!start) return null;
  const mine = !!track && playables.some((x) => x.trackId === track.trackId);
  const live = mine && status === "playing";
  const small = mine && track ? track.title : start.title;
  const aria = !mine
    ? `Preview album${record ? `, ${record}` : ""}, starting with ${start.title}`
    : status === "paused"
      ? `Resume ${small}`
      : `Pause ${small}`;
  return (
    <PlayButton
      state={mine ? status : "idle"}
      verb={verb}
      short={short}
      aria-pressed={live}
      aria-label={aria}
      onClick={() => (mine ? toggle() : playList(playables, startIndex, { wrap: true }))}
    />
  );
}
