/**
 * One Home (founder, 2026-10-28): the shape of the answer every device draws. The cloud makes Home
 * once, rows, order, names and contents, from every device's plays; the iPhone, the Mac app and
 * CarPlay draw it, each showing only what it holds.
 *
 * Everything travels in ids every device already shares: a record as its songs' Cassette ids (one
 * the device holds is enough to find it, the way made for you sends songs), a playlist by its cloud
 * id, a station by its slug on the dial, an artist by name and a few of their songs.
 *
 * A row's `shout` and `answer` are its name as drawn ("On repeat" / "lately"); devices style them
 * (the phone sets the shout in capitals). No row carries a reason line: the name says it (founder).
 */

/** Bump when the answer's shape changes in a way an older device can't read. */
export const HOME_VERSION = 1;

/** A record, as every device finds it: by its songs. `key` is made-for-you's album key. */
export type HomeRecord = { key: string; title: string; artist: string; year: number | null; songs: string[] };

/** An artist, found on a device by any of the songs listed. */
export type HomeArtist = { key: string; name: string; songs: string[] };

/** A made-for-you playlist (or the Nostalgia mix), in the made-for-you route's own shape. */
export type HomeMix = {
  id: string;
  kind: string;
  title: string;
  subtitle: string | null;
  color: string | null;
  cover: { key: string; variant: string; url: string } | null;
  songs: string[];
  artists: number;
};

export type HomePlaylist = { id: string; name: string; songs: number; cover: string | null; lastPlayedAt: string | null };

/** The reaching shelves: one sits on Home at a time, all of them on All shelves. */
export type ShelfKind = "loud" | "quiet" | "bops" | "deep-dive" | "nostalgia" | "corner" | "more-like" | "rekindle";

export type HomeShelf = {
  /** stable for the day: "loud", "corner:pop punk", "nostalgia:1997-2003" */
  id: string;
  kind: ShelfKind;
  shout: string;
  answer: string;
  /** in the order drawn; Deep dive shows the first as its one big card */
  records: HomeRecord[];
  /** Nostalgia's mix of songs from its years, drawn before its records; else null */
  mix: HomeMix | null;
  /** the shelf in Home's reaching row right now */
  onHome: boolean;
};

type Named = { id: string; shout: string; answer: string };

export type HomeRow =
  | (Named & { kind: "resume"; record: HomeRecord | null; song: string | null; playlist: string | null })
  | (Named & { kind: "records"; records: HomeRecord[] })
  | (Named & { kind: "mixes"; mixes: HomeMix[] })
  | (Named & { kind: "playlists"; playlists: HomePlaylist[] })
  /** `like`: a suggested station's records it sounds like, by station (lib/radio/home-picks); saved
      stations and a turn on the rest of the dial carry none. Optional: the phone reads the order alone. */
  | (Named & { kind: "stations"; stations: string[]; like?: Record<string, HomeRecord[]> })
  | (Named & { kind: "reach"; shelf: HomeShelf })
  | (Named & { kind: "artists"; artists: HomeArtist[] })
  | (Named & { kind: "all-shelves"; count: number });

export type HomeAnswer = {
  version: number;
  /** when this answer was made (ISO) */
  madeAt: string;
  /** the listener's calendar day and part of the day it was made for */
  day: string;
  slot: string;
  /** the day the day's playlists belong to (it turns at 4 am) */
  madeOn: string;
  /** Home, top to bottom. Rows a device can't fill from what it holds, it hides. */
  rows: HomeRow[];
  /** every reaching shelf made today, for All shelves */
  shelves: HomeShelf[];
};
