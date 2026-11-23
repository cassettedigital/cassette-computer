/**
 * The kit's glyphs, by concept (AmperfyKit/CassetteIcons.swift). Chrome glyphs are Lucide, the same
 * drawings the iPhone app ships as its cassette-lucide-* assets. The transport (play, pause, stop, next,
 * previous) is SF Symbols on the iPhone, which may not ship anywhere else, so here they are the kit's
 * own filled shapes at the same weight and size.
 */

import {
  Airplay,
  AudioLines,
  Check,
  ChevronRight,
  CircleHelp,
  Compass,
  Ellipsis,
  Laptop,
  Library,
  List,
  ListMusic,
  Maximize2,
  Mic,
  Minimize2,
  Monitor,
  Music,
  Plus,
  Repeat,
  Repeat1,
  Infinity as InfinityIcon,
  Search,
  Shuffle,
  Smartphone,
  Usb,
  Volume,
  Volume2,
  VolumeX,
  X,
  type LucideIcon,
  Pencil,
  createLucideIcon,
  Disc,
} from "lucide-react";

export type Concept =
  | "home"
  | "library"
  | "album"
  | "artist"
  | "song"
  | "playlist"
  | "radio"
  | "discover"
  | "search"
  | "plus"
  | "more"
  | "list"
  | "shuffle"
  | "repeat"
  | "repeatOne"
  | "keepPlaying"
  | "volumeLow"
  | "volumeHigh"
  | "volumeMute"
  | "chevronRight"
  | "laptop"
  | "desktop"
  | "iphone"
  | "usb"
  | "airplay"
  | "expand"
  | "collapse"
  | "close"
  | "waveform"
  | "check"
  | "edit"
  | "eject"
  | "help";

/* The kit's own, drawn on Lucide's grid and stroke so they sit with the rest (the founder's picks for
   the desk's places, 2026-10-22): the house without its door, and a boombox (handle, body, two
   speakers) for radio. Albums is Lucide's plain Disc (a sleeve with its disc peeking out read as a
   coffee mug; a record on a square sleeve was confusing). */
const HomeSimple = createLucideIcon("home-simple", [["path", { d: "M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z", key: "h" }]]);
const Boombox = createLucideIcon("boombox", [
  ["path", { d: "M8 7V5h8v2", key: "h" }],
  ["rect", { x: "2", y: "7", width: "20", height: "12", rx: "2", key: "b" }],
  ["circle", { cx: "7.5", cy: "13", r: "2.5", key: "l" }],
  ["circle", { cx: "16.5", cy: "13", r: "2.5", key: "r" }],
]);

/* Eject, which Lucide doesn't draw: the triangle over its bar, on Lucide's grid and stroke (the disc's
   row and page in the desktop app; iTunes kept eject beside a disc) */
const Eject = createLucideIcon("eject", [
  ["path", { d: "M12 5 4.5 14h15z", key: "t" }],
  ["path", { d: "M4.5 18.5h15", key: "b" }],
]);

const LUCIDE: Record<Concept, LucideIcon> = {
  home: HomeSimple,
  library: Library,
  album: Disc,
  artist: Mic,
  song: Music,
  playlist: ListMusic,
  radio: Boombox,
  // the website's own sign for Discover (its masthead's compass), so the place reads the same in both
  discover: Compass,
  search: Search,
  plus: Plus,
  more: Ellipsis,
  list: List,
  shuffle: Shuffle,
  repeat: Repeat,
  repeatOne: Repeat1,
  keepPlaying: InfinityIcon,
  volumeLow: Volume,
  volumeHigh: Volume2,
  volumeMute: VolumeX,
  chevronRight: ChevronRight,
  laptop: Laptop,
  desktop: Monitor,
  iphone: Smartphone,
  usb: Usb,
  airplay: Airplay,
  expand: Maximize2,
  collapse: Minimize2,
  close: X,
  waveform: AudioLines,
  check: Check,
  edit: Pencil,
  eject: Eject,
  help: CircleHelp,
};

/** The four sizes (CassetteIconSize): small 13, row 15, control 17, prominent 25. */
export const ICON = { small: 13, row: 15, control: 17, prominent: 25 } as const;

/** A chrome glyph. Lucide draws in a box 1.2x its size, as the iPhone app does. */
export function Glyph({ name, size = ICON.control, className }: { name: Concept; size?: number; className?: string }) {
  const Icon = LUCIDE[name];
  return <Icon size={Math.round(size * 1.2)} strokeWidth={2} className={className} aria-hidden="true" focusable="false" />;
}

export type Transport = "play" | "pause" | "stop" | "next" | "previous";

/** A transport glyph: filled, rounded joins, optically centred (play leans right like the disc's +1 inset). */
export function TransportGlyph({ name, size }: { name: Transport; size: number }) {
  let d: string;
  switch (name) {
    case "play":
      // a triangle's visual centre sits a third of the way in from its flat side, so the box is shifted
      // right by 1 unit (x 7 to 19 rather than 6 to 18): it reads centred in a disc without any nudge
      d = "M7 5.1c0-1 1.1-1.6 2-1.1l9.4 6.3c.8.5.8 1.7 0 2.2L9 18.9c-.9.6-2 0-2-1.1z";
      break;
    case "pause":
      d = "M6 4.5c0-.8.7-1.5 1.5-1.5h2c.8 0 1.5.7 1.5 1.5v15c0 .8-.7 1.5-1.5 1.5h-2C6.7 21 6 20.3 6 19.5zM13 4.5c0-.8.7-1.5 1.5-1.5h2c.8 0 1.5.7 1.5 1.5v15c0 .8-.7 1.5-1.5 1.5h-2c-.8 0-1.5-.7-1.5-1.5z";
      break;
    case "stop":
      d = "M5 7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z";
      break;
    case "next":
      d = "M1.5 7.2c0-.9 1-1.4 1.7-.9l7.3 4.8c.7.4.7 1.4 0 1.8l-7.3 4.8c-.7.5-1.7 0-1.7-.9zM12 7.2c0-.9 1-1.4 1.7-.9L21 11.1c.7.4.7 1.4 0 1.8l-7.3 4.8c-.7.5-1.7 0-1.7-.9z";
      break;
    case "previous":
      d = "M22.5 7.2c0-.9-1-1.4-1.7-.9l-7.3 4.8c-.7.4-.7 1.4 0 1.8l7.3 4.8c.7.5 1.7 0 1.7-.9zM12 7.2c0-.9-1-1.4-1.7-.9L3 11.1c-.7.4-.7 1.4 0 1.8l7.3 4.8c.7.5 1.7 0 1.7-.9z";
      break;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={d} fill="currentColor" />
    </svg>
  );
}
