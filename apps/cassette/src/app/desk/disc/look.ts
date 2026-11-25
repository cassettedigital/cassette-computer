/**
 * The disc's page, one look per state (design wave 1c, board #1201). Pure: the drive's status and what the window
 * remembers in, the page's slots out. The page (disc.tsx), the states page (/proto/states/disc), Admin's kit and the
 * state-matrix test all draw from this one function, so the picture the founder signs is the page that ships.
 *
 * The plan it follows is disc.states.ts: every state the hub can send (apps/cassette-player/sidecar/rip.go), each slot
 * filled in every state, and the anchors that never move between them. The founder's two picks (2026-11-24, audit
 * round 2): a passing line sits on ONE line on the cover's top edge, and the button row sits on the cover's foot and
 * never moves; a long name grows up. Nothing here rips, reads a drive or touches a library.
 */

import { ripDoneCount, type RipStatus, type TrackState, type TrackStatus } from "@/lib/rip-status";

/** The drive panel's own line for a sure identification (CdDrivePanel CONFIDENT_THRESHOLD). */
export const SURE = 0.8;

/** Every state of the disc's page, in the order a rip moves through them; the plan's columns (disc.states.ts). */
export const DISC_STATES = [
  "reading",
  "matched",
  "matched-owned",
  "guess",
  "choosing",
  "unknown",
  "pressed",
  "ripping-first",
  "ripping",
  "ripping-unknown",
  "adding",
  "done-landing",
  "done",
  "done-unknown",
  "stopped",
  "incomplete",
  "error",
  "denied",
] as const;
export type DiscState = (typeof DISC_STATES)[number];

/** What the window knows besides the hub's status: the page's own inputs. */
export type DiscWindow = {
  /** this disc was identified surely before (its confidence isn't sent again after a Stop or while it rips) */
  sureBefore: boolean;
  /** Rip was pressed and the hub is reading the disc again before it starts (every rip begins with a re-read) */
  pressed: boolean;
  /** "Not this album?" was pressed: the choices fill the body under the head */
  choose: boolean;
  /** the record is on the shelf (a rip that has landed) */
  onShelf: boolean;
};

export type Key1 = { word: "Rip to library" | "Rip again" | "Stop" | "Play"; fill: boolean; on: boolean; act: "rip" | "stop" | "play" };

/** A passing line's words, and the one link it may end on. */
export type ComingLine = { words: string; link?: { word: string; to: "choose" | "record" } };

export type DiscLook = {
  state: DiscState;
  /** the disc itself in the cover's frame (nothing known yet), or the sleeve */
  bare: boolean;
  /** a best guess: the sleeve is dimmed until the person picks */
  dim: boolean;
  /** the disc turns: while it's read, and while it copies */
  spin: boolean;
  name: string;
  /** the artist and the facts aren't known yet: soft bars hold their lines */
  bones: boolean;
  artist: string | null;
  facts: string | null;
  key1: Key1;
  /** Eject keeps its seat in every state, dimmed when it can't be used */
  eject: boolean;
  /** the coming line on the cover's top edge; null keeps its room with nothing in it */
  line: ComingLine | null;
  /** what fills the page under the head: the songs, their bones, or the drive panel's steps (with or without songs) */
  body: "songs" | "bones" | "steps" | "steps+songs";
};

const songCount = (n: number) => `${n} ${n === 1 ? "song" : "songs"}`;

/** The hub's stand-in name for a disc it couldn't name, said plainly (the drive panel's displayAlbum). */
export const discName = (s: Pick<RipStatus, "album" | "needsNaming" | "unidentified">): string =>
  s.unidentified || s.needsNaming ? "Unknown album" : s.album?.trim() || "Audio CD";

/** Still reading: nothing known about the disc yet (the drive spinning up, the lookup on its way). */
export const isReading = (s: RipStatus | null) => !!s && (s.state === "detecting" || (s.state === "idle" && s.discPresent));

/** Which column of the plan a status is in. */
export function discState(s: RipStatus, w: DiscWindow): DiscState {
  if (s.permissionState === "denied") return "denied";
  const done = ripDoneCount(s);
  const sure = !s.unidentified && ((s.confidence ?? 0) >= SURE || w.sureBefore);
  if (w.pressed && (isReading(s) || s.state === "matched")) return "pressed";
  switch (s.state) {
    case "ripping":
      return s.unidentified ? "ripping-unknown" : done === 0 ? "ripping-first" : "ripping";
    case "registering":
      return "adding";
    case "done":
      return s.unidentified ? "done-unknown" : w.onShelf ? "done" : "done-landing";
    case "incomplete":
      return "incomplete";
    case "error":
      return "error";
    case "confirm":
      return "guess";
    case "matched":
      if (s.unidentified) return "unknown";
      // after a Stop the hub shows the match again with the songs that landed ticked (rip.go finalizeStoppedRip)
      if (sure && (s.tracks ?? []).some((t) => t.state === "done")) return "stopped";
      if (!sure) return "guess";
      if (w.choose) return "choosing";
      return s.alreadyInLibrary ? "matched-owned" : "matched";
    default:
      return "reading";
  }
}

/** The page's slots for one state. `held` is the disc as it was last known, drawn through the hub's re-read. */
export function discLook(s: RipStatus, w: DiscWindow, held: RipStatus | null = null): DiscLook {
  const state = discState(s, w);
  const known = state === "pressed" && held ? held : s;
  const total = known.trackCount ?? known.tracks?.length ?? 0;
  const done = ripDoneCount(s);
  const year = known.date?.slice(0, 4);
  const facts = [year, total ? songCount(total) : null].filter(Boolean).join(" · ") || null;
  const eta = s.etaSeconds ? ` · about ${Math.max(1, Math.round(s.etaSeconds / 60))} min left` : "";
  const ripping = `Ripping ${Math.min(total || 1, done + 1)} of ${total || "?"}${eta}`;
  const ejectable = !!s.discPresent && s.state !== "detecting" && s.state !== "ripping" && s.state !== "registering" && !w.pressed;

  const rip = (on: boolean, again = false): Key1 => ({ word: again ? "Rip again" : "Rip to library", fill: true, on, act: "rip" });
  const stop = (on: boolean): Key1 => ({ word: "Stop", fill: false, on, act: "stop" });
  const play = (on: boolean): Key1 => ({ word: "Play", fill: true, on, act: "play" });

  const base = {
    state,
    bare: false,
    dim: false,
    spin: false,
    name: discName(known),
    bones: false,
    artist: known.unidentified ? null : known.albumArtist?.trim() || null,
    facts,
    eject: ejectable,
    body: "songs" as DiscLook["body"],
  };

  switch (state) {
    case "reading":
      return { ...base, bare: true, spin: true, name: "Reading the disc", bones: true, artist: null, facts: null, key1: rip(false), line: null, body: "bones" };
    case "matched":
      return { ...base, key1: rip(true), line: { words: "", link: { word: "Not this album?", to: "choose" } } };
    case "matched-owned":
      return { ...base, key1: rip(true, true), line: { words: "In your library", link: { word: "Not this album?", to: "choose" } } };
    case "guess":
      return { ...base, dim: true, key1: rip(false), line: { words: "Which release is this?" }, body: "steps" };
    case "choosing":
      return { ...base, key1: rip(false), line: { words: "Which release is this?" }, body: "steps" };
    case "unknown":
      return { ...base, key1: rip(false), line: { words: "We don't know this disc yet" }, body: "steps" };
    case "pressed":
      return { ...base, key1: stop(false), line: { words: "Starting" } };
    case "ripping-first":
    case "ripping":
      return { ...base, spin: true, key1: stop(true), line: { words: ripping } };
    case "ripping-unknown":
      return { ...base, spin: true, key1: stop(true), line: { words: ripping }, body: "steps+songs" };
    case "adding":
      return { ...base, key1: stop(false), line: { words: "Adding to your library" } };
    case "done-landing":
      return { ...base, key1: play(false), line: { words: "In your library in a moment" } };
    case "done":
      // the name is the way in (the plan's worked example), so the line stays one short line at every width
      return { ...base, key1: play(true), line: { words: "In your library" } };
    case "done-unknown":
      return { ...base, key1: play(w.onShelf), line: { words: "Imported as unknown" }, body: "steps+songs" };
    case "stopped":
      return { ...base, key1: rip(true), line: { words: `Stopped at ${done} of ${total}` } };
    case "incomplete":
      return { ...base, key1: rip(false, true), line: { words: `${done} of ${total} ripped` }, body: "steps" };
    case "error":
      return { ...base, bare: !s.album, name: s.album ? base.name : "Audio CD", key1: rip(false), line: { words: "Couldn't read it" }, body: "steps" };
    case "denied":
      return { ...base, bare: true, name: "Audio CD", artist: null, facts: null, key1: rip(false), line: { words: "No permission for the drive" }, body: "steps" };
  }
}

/** The songs to list: the hub's, or numbered rows while only the count is known. */
export function discSongs(s: RipStatus): TrackStatus[] {
  return s.tracks?.length ? s.tracks : Array.from({ length: s.trackCount ?? 0 }, (_, i) => ({ position: i + 1, title: "", state: "pending" as TrackState }));
}
