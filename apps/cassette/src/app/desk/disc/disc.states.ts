/**
 * The disc's page: its state plan (design wave 1c, board #1201; the "Holding still" rules, section 2). The founder
 * signs the filmstrip drawn from this file before anything ships; after that the state-matrix test is the sign-off.
 *
 *   SLOTS     the rows: what each slot holds in every state (content, "dimmed", "bone" or "held": room kept,
 *             nothing shown). An anchored slot is never absent.
 *   STATES    the columns: every state the hub can really send (apps/cassette-player/sidecar/rip.go), each with
 *             where it comes from and a made-up disc to draw it with. Three were found only by reading the hub:
 *             the re-read at the start of every rip ("pressed"), Stop, and an unknown disc that starts ripping.
 *   ANCHORS   the lines that never move between states or between names: the cover, the coming line on its top
 *             edge, the name's foot, the artist line, the button row on the cover's foot, the body's first line.
 *   GIVE      where change goes: the air above the name.
 *   NAMES     the names to try: one, two and three lines, too long, one long unbroken word, a wide script.
 *   FRAMES    the windows round 2 drew: 985 (the band where the cover goes on top), 1200 (the default), 1440.
 *
 * Words in brackets in a cell are placeholders for the founder to word. Every disc, song and name here is made up;
 * nothing is read from a drive, a hub, the catalog or anyone's library.
 */

import type { RipStatus } from "@/lib/rip-status";
import { DISC_STATES, type DiscState, type DiscWindow } from "./look";

export const PART = "disc";
export const ROUTE = "/desk/disc";

export const ANCHORS = ["cover", "line", "name", "artist", "keys", "body"] as const;
export type Anchor = (typeof ANCHORS)[number];
/** The name is anchored by its foot (it sits on the artist); every other anchor by its top. */
export const ANCHOR_EDGE: Record<Anchor, "top" | "bottom"> = { cover: "top", line: "top", name: "bottom", artist: "top", keys: "top", body: "top" };
export const GIVE = "the air above the name: extra name lines climb into it";

/** The windows to draw at, as round 2 drew them (the side view docked). */
export const FRAMES = [
  { w: 985, h: 820, why: "the band where the words go under the cover" },
  { w: 1200, h: 820, why: "the default window" },
  { w: 1440, h: 900, why: "a larger window" },
] as const;

/** The names to try, each against the same disc (the founder's grows-up rule, 2026-11-24). */
export const NAMES = [
  { id: "one", name: "Paper Lanterns" },
  { id: "two", name: "Songs for the Last Bus Home" },
  { id: "three", name: "The Complete Friday Night Sessions at the Old Ballroom" },
  { id: "long", name: "The Complete Friday Night Sessions at the Old Ballroom, Volume Two (Expanded Edition with the Rehearsals and Every Encore)" },
  { id: "word", name: "Kaleidoscopicallyunforgettablenesses" },
  { id: "script", name: "夜明けのランタンと潮騒の合唱団による十二の歌" },
] as const;
export type NameId = (typeof NAMES)[number]["id"];

type Cell = string;
type Row = { slot: string; anchor?: Anchor; cells: Record<DiscState, Cell> };

const all = (c: Cell, over: Partial<Record<DiscState, Cell>> = {}): Record<DiscState, Cell> =>
  Object.fromEntries(DISC_STATES.map((s) => [s, over[s] ?? c])) as Record<DiscState, Cell>;

/** The plan: rows are slots, columns are states. Laid out side by side before the page was built. */
export const SLOTS: Row[] = [
  {
    slot: "Cover",
    anchor: "cover",
    cells: all("sleeve, the CD tucked in it", {
      reading: "the bare disc in the cover's frame, turning",
      guess: "the best guess's sleeve, dimmed",
      pressed: "sleeve, kept through the hub's re-read",
      "ripping-first": "sleeve, the CD turning",
      ripping: "sleeve, the CD turning",
      "ripping-unknown": "sleeve, the CD turning",
      error: "the bare disc (the sleeve, if the disc had a name)",
      denied: "the bare disc",
    }),
  },
  {
    slot: "Coming line (one line on the cover's top edge)",
    anchor: "line",
    cells: all("held", {
      matched: "Not this album? (a link)",
      "matched-owned": "In your library · Not this album?",
      guess: "Which release is this?",
      choosing: "Which release is this?",
      unknown: "[We don't know this disc yet]",
      pressed: "[Starting]",
      "ripping-first": "Ripping 1 of 12",
      ripping: "Ripping 6 of 12 · about 9 min left",
      "ripping-unknown": "Ripping 4 of 12 · about 10 min left",
      adding: "Adding to your library",
      "done-landing": "[In your library in a moment]",
      done: "In your library",
      "done-unknown": "Imported as unknown",
      stopped: "[Stopped at 5 of 12]",
      incomplete: "10 of 12 ripped",
      error: "Couldn't read it",
      denied: "[No permission for the drive]",
    }),
  },
  {
    slot: "Name (sits on the artist; grows up)",
    anchor: "name",
    cells: all("the name", { done: "the name, the way into the record", reading: "Reading the disc", guess: "the best guess's name", unknown: "Unknown album", "ripping-unknown": "Unknown album", "done-unknown": "Unknown album", denied: "Audio CD", error: "the name, or Audio CD" }),
  },
  {
    slot: "Artist",
    anchor: "artist",
    cells: all("the artist", { reading: "bone", unknown: "held", "ripping-unknown": "held", "done-unknown": "held", denied: "held" }),
  },
  { slot: "Facts", cells: all("year · 12 songs", { reading: "bone", denied: "held", unknown: "12 songs", "ripping-unknown": "12 songs", "done-unknown": "12 songs" }) },
  {
    slot: "Key 1 (on the cover's foot)",
    anchor: "keys",
    cells: all("Rip to library, dimmed", {
      matched: "Rip to library",
      "matched-owned": "Rip again",
      pressed: "Stop, dimmed",
      "ripping-first": "Stop",
      ripping: "Stop",
      "ripping-unknown": "Stop",
      adding: "Stop, dimmed",
      "done-landing": "Play, dimmed",
      done: "Play",
      "done-unknown": "Play, dimmed",
      stopped: "Rip to library",
      incomplete: "Rip again, dimmed",
    }),
  },
  {
    slot: "Key 2",
    anchor: "keys",
    cells: all("Eject", { reading: "Eject, dimmed", pressed: "Eject, dimmed", "ripping-first": "Eject, dimmed", ripping: "Eject, dimmed", "ripping-unknown": "Eject, dimmed", adding: "Eject, dimmed" }),
  },
  {
    slot: "Body (its first line is an anchor)",
    anchor: "body",
    cells: all("the songs", {
      reading: "song bones",
      guess: "the choices (the drive panel's steps)",
      choosing: "the choices, the match left out",
      unknown: "search for it, figure it out, or just rip it",
      "ripping-first": "the songs, the first one copying",
      ripping: "the songs, ticks as each lands",
      "ripping-unknown": "name it as it rips, then the songs",
      adding: "the songs, all ticked",
      "done-landing": "the songs, all ticked",
      done: "the songs, all ticked",
      "done-unknown": "name it or find it, then the songs",
      stopped: "the songs, the landed ones ticked",
      incomplete: "the songs that didn't read, each with Retry",
      error: "Try again, Start over",
      denied: "how to give Cassette the drive",
    }),
  },
];

/** Where each column comes from in the hub's code, so the plan follows the code that sends the states. */
export const SENT_BY: Record<DiscState, string> = {
  reading: "detectAndResolve publishes detecting on insert (rip.go:417); idle with a disc present while the probe reads",
  matched: "autoMatchProgress, confidence at or over 0.8 (rip.go:719)",
  "matched-owned": "the same, with alreadyInLibrary",
  guess: "a match under 0.8 (matched), or confirmProgress's pick-list (confirm, rip.go:741)",
  choosing: "the window's own: Not this album? pressed on a sure match",
  unknown: "importPreviewProgress: matched, unidentified, no candidates (rip.go:751)",
  pressed: "handleRipStart re-reads the disc before every rip: detecting with no album (rip.go:1625)",
  "ripping-first": "runRipJob: ripping, nothing landed yet, no confidence sent (rip.go:810)",
  ripping: "ripTrackSet: ripping with tracks done and etaSeconds",
  "ripping-unknown": "runRipJob with a local identity: ripping, unidentified (handleRipStart's import-anyway)",
  adding: "registering (rip.go:995)",
  "done-landing": "done, before the window's shelf has the record",
  done: "done, the record on the shelf",
  "done-unknown": "done, unidentified: Imported as unknown (rip.go:1041)",
  stopped: "finalizeStoppedRip: matched again, landed songs ticked, no confidence sent (rip.go:851)",
  incomplete: "finalizeRip: some songs couldn't be read (rip.go:1037)",
  error: "a bad TOC (rip.go:443) or a rip that saved nothing (rip.go:1033)",
  denied: "idle with permissionState denied (rip.go:430)",
};

/**
 * Not on this page: the empty drive. No drive, no disc, just ejected and reconnecting draw the drive with nothing in
 * it (disc.tsx NoDisc, the founder's 11-07 look), held as it is by the open call on empty states (empty.styles).
 */
export const ELSEWHERE = ["no drive (idle, drivePresent false)", "no disc (idle, discPresent false)", "just ejected", "the hub out of reach"];

// ---------------------------------------------------------------------------------------------------------------
// the stand-ins

const TITLES = ["Harbour Lights", "Slow Train Home", "Paper Lanterns", "Nine Mile Road", "Winter Coat", "The Long Way Round", "Salt and Smoke", "Little Engine", "Half Past Blue", "Marigold", "Borrowed Time", "Last Bus to Carrow"];
const ticks = (landed: number, copying = true) => TITLES.map((title, i) => ({ position: i + 1, title, state: i < landed ? ("done" as const) : i === landed && copying ? ("ripping" as const) : ("pending" as const) }));
const numbered = (landed: number) => TITLES.map((_, i) => ({ position: i + 1, title: `Track ${String(i + 1).padStart(2, "0")}`, state: i < landed ? ("done" as const) : i === landed ? ("ripping" as const) : ("pending" as const) }));
const candidates = (album: string) =>
  [
    [album, "1997"],
    [`${album} (Remastered)`, "2011"],
    [`${album}: Live at the Corn Exchange`, "1999"],
  ].map(([a, date], i) => ({ id: `c${i + 1}`, album: a, albumArtist: "The Low Tide Choir", date, trackCount: 12, confidence: 0.5, tracks: TITLES.map((title, n) => ({ position: n + 1, title, lengthMs: 180000 + n * 7000 })) }));

/** A disc in one state, named `album`: the hub's status, the window's own inputs, and the disc as last known. */
export type Stand = { status: RipStatus; window: DiscWindow; held: RipStatus | null };

export function stand(state: DiscState, album: string = NAMES[0].name): Stand {
  const known: RipStatus = {
    state: "matched",
    drivePresent: true,
    discPresent: true,
    permissionState: "granted",
    completedTracks: 0,
    album,
    albumArtist: "The Low Tide Choir",
    date: "1997-03-11",
    trackCount: 12,
    releaseMbid: "stand-in",
    discId: "stand-in-disc",
    confidence: 0.94,
    tracks: ticks(0, false),
    hubOS: "darwin",
  };
  const unknown: RipStatus = { ...known, album: "Unknown Album 7f3a", albumArtist: "Unknown Artist", unidentified: true, needsNaming: true, confidence: 0, date: undefined, releaseMbid: undefined, candidates: [], tracks: numbered(0).map((t) => ({ ...t, state: "pending" as const })) };
  const w: DiscWindow = { sureBefore: false, pressed: false, choose: false, onShelf: false };
  const at = (status: RipStatus, win: Partial<DiscWindow> = {}, held: RipStatus | null = null): Stand => ({ status, window: { ...w, ...win }, held });
  switch (state) {
    case "reading":
      return at({ state: "detecting", message: "Reading disc…", drivePresent: true, discPresent: true, permissionState: "granted", completedTracks: 0 });
    case "matched":
      return at(known);
    case "matched-owned":
      return at({ ...known, alreadyInLibrary: true, ownedTrackCount: 12, tracks: known.tracks?.map((t) => ({ ...t, inLibrary: true })) });
    case "guess":
      return at({ ...known, confidence: 0.55, candidates: candidates(album) });
    case "choosing":
      return at({ ...known, candidates: candidates(album) }, { choose: true });
    case "unknown":
      return at(unknown);
    case "pressed":
      return at({ state: "detecting", message: "Reading disc…", drivePresent: true, discPresent: true, permissionState: "granted", completedTracks: 0 }, { pressed: true, sureBefore: true }, known);
    case "ripping-first":
      return at({ ...known, state: "ripping", confidence: undefined, tracks: ticks(0) }, { sureBefore: true });
    case "ripping":
      return at({ ...known, state: "ripping", confidence: undefined, tracks: ticks(5), completedTracks: 5, etaSeconds: 540 }, { sureBefore: true });
    case "ripping-unknown":
      return at({ ...unknown, state: "ripping", tracks: numbered(3), completedTracks: 3, etaSeconds: 600 });
    case "adding":
      return at({ ...known, state: "registering", confidence: undefined, tracks: ticks(12), completedTracks: 12 }, { sureBefore: true });
    case "done-landing":
      return at({ ...known, state: "done", confidence: undefined, tracks: ticks(12), completedTracks: 12, registered: true }, { sureBefore: true });
    case "done":
      return at({ ...known, state: "done", confidence: undefined, tracks: ticks(12), completedTracks: 12, registered: true }, { sureBefore: true, onShelf: true });
    case "done-unknown":
      return at({ ...unknown, state: "done", tracks: numbered(12).map((t) => ({ ...t, state: "done" as const })), completedTracks: 12, registered: true });
    case "stopped":
      return at({ ...known, confidence: undefined, message: "Rip stopped. Ready to rip again.", tracks: ticks(5, false), completedTracks: 5 }, { sureBefore: true });
    case "incomplete": {
      const tracks = ticks(12).map((t) => (t.position === 4 || t.position === 9 ? { ...t, state: "error" as const, error: "read error" } : t));
      return at({ ...known, state: "incomplete", confidence: undefined, tracks, completedTracks: 10 }, { sureBefore: true });
    }
    case "error":
      return at({ state: "error", message: "TOC error", drivePresent: true, discPresent: true, permissionState: "granted", completedTracks: 0 });
    case "denied":
      return at({ state: "idle", drivePresent: true, discPresent: true, permissionState: "denied", completedTracks: 0, hubOS: "darwin" });
  }
}

/** Short labels for the filmstrip, four words or fewer. */
export const LABEL: Record<DiscState, string> = {
  reading: "Reading",
  matched: "Matched",
  "matched-owned": "Matched, owned",
  guess: "A guess",
  choosing: "Not this album?",
  unknown: "Unknown disc",
  pressed: "Rip pressed",
  "ripping-first": "Ripping, first song",
  ripping: "Ripping, time left",
  "ripping-unknown": "Unknown disc ripping",
  adding: "Adding",
  "done-landing": "Done, shelf not yet",
  done: "Done",
  "done-unknown": "Done, unknown",
  stopped: "Stopped",
  incomplete: "Part read",
  error: "Couldn't read",
  denied: "No permission",
};

/** A short fingerprint of the plan's shape (its states, slots and anchors): when it changes, the plan needs a new
    picture for the founder (the state-matrix test says so). The cells' words may change without one. */
export function planShape(): string {
  const text = JSON.stringify({ states: DISC_STATES, slots: SLOTS.map((r) => [r.slot, r.anchor ?? null]), anchors: ANCHORS });
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(16);
}
