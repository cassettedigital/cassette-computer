/**
 * What was playing when someone wrote a note (founder, 2026-11-19: a note should say what was on, beside the page,
 * light or dark and the window's size).
 *
 * The website's players each keep their own song in their own part of the page (the radio, the record pages'
 * preview player, the library's player, the song video), and the note box sits outside all of them. So each player
 * says what it is playing here with one line (useNoteNowPlaying), and a note reads the lot when it is sent
 * (nowPlayingForReport, web-report.ts). Nothing leaves the browser except inside a note the person chose to send.
 */

import { useEffect } from "react";

export type PlayerName = "radio" | "preview" | "library" | "video";

export type NowPlayingNote = {
  player: PlayerName;
  /** "playing", "paused", "loading", "connecting", "error", or "open" for a player that doesn't say. */
  state: string;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  station?: string | null;
};

type Note = Omit<NowPlayingNote, "player">;

const playing = new Map<PlayerName, NowPlayingNote>();

/** Say what a player is playing, or null once it has stopped or closed. */
export function noteNowPlaying(player: PlayerName, note: Note | null): void {
  if (note) playing.set(player, { player, ...note });
  else playing.delete(player);
}

/** Every player that has something on, for a note's context. */
export function nowPlayingForReport(): NowPlayingNote[] {
  return [...playing.values()];
}

/** A player's one line: keeps what it says current, and takes it back when the player goes away. */
export function useNoteNowPlaying(player: PlayerName, note: Note | null): void {
  const key = note ? JSON.stringify(note) : "";
  useEffect(() => {
    noteNowPlaying(player, key ? (JSON.parse(key) as Note) : null);
    return () => noteNowPlaying(player, null);
  }, [player, key]);
}
