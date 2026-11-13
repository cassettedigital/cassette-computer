/** The desk's shared, serializable shapes. Pure: client components and the server both import it. */

import type { Playable } from "@/app/(taste)/_kit/play";
import { toBase64Url } from "@/lib/dashboard/library-group-keys";
import type { DialStation } from "@/lib/radio/types";

/**
 * A record on the Mac, as the library knows it (lib/dashboard/library-cards' LibraryAlbumCard, trimmed).
 * `key` is the album group key the Mac's player starts it by; `slug` only when the record is matched to
 * the catalog (an unmatched rip has none, and wears its folder cover and its own tags).
 */
export type DeskAlbum = {
  key: string;
  slug: string | null;
  title: string;
  artist: string;
  artistSlug: string | null;
  year: string | null;
  /** the catalog's cover (a fallback for a matched record) */
  catalogCover: string | null;
  catalogCoverSmall: string | null;
  /** the person's own pick, already cache-busted */
  overrideCover: string | null;
  /** a track on the Mac to fetch the folder cover by */
  localTrackId: string | null;
  /** the version of that folder cover (lib/dashboard/local-cover-version), so its address changes only
      when the picture does and the window keeps it until then (BUG-920); null when unknown */
  localCoverVersion: string | null;
  /** when it first arrived on the Mac, ISO */
  added: string | null;
};

/** A play, as the listening rows read it: the record's key and when (epoch ms). */
export type DeskPlay = { key: string; at: number };

export type DeskData = {
  user: { name: string | null };
  shelf: DeskAlbum[];
  /** the shared Home brain's rows (lib/home-shelves): the last record on, the forgotten ones */
  resume: { key: string; song: string | null } | null;
  albumsRow: string[];
  /** the last 60 days of plays, for the listening rows the browser ranks in its own time zone */
  plays: DeskPlay[];
  mac: { name: string; synced: string | null; light: "live" | "idle" | "offline" } | null;
  playlists: DeskPlaylist[];
  /** the radio dial, in the dial's section order; the person's saved stations lead */
  stations: DeskStation[];
  saved: string[];
  /** the players paired to this Mac, for the rail: how many are connected right now */
  players: { connected: number; total: number };
  /** the paired app couldn't reach the cloud, so this is the copy kept on the Mac (BUG-542) */
  offline?: boolean;
  /** This computer isn't the main one (lib/player-satellite.ts): a satellite's shelf is what's on it, a
   *  spare's is empty. Absent on the main computer. */
  here?: DeskHere;
};

export type DeskHere = { kind: "satellite" | "spare"; main: string };

export type DeskPlaylist = { id: string; name: string; description: string | null; cover: string | null; songs: number };

/** A station on the dial (lib/radio/dial: the Radio page's shape in both windows). */
export type DeskStation = DialStation;

/** A song on the Mac, as the deck plays it: `subsonicTrackId` is the id the Mac's player knows. */
export type OwnedTrack = {
  key: string;
  subsonicTrackId: string | null;
  cassetteLocalId: string | null;
  title: string;
  /** the artist the song is filed under: its record's */
  artist: string;
  /** the song's own artist as its file names it, when that says more than the record's ("Gorillaz
      feat. Thundercat"); null when it only repeats it (lib/desk/song-credit) */
  songArtist?: string | null;
  album: string;
  albumKey: string | null;
  albumSlug: string | null;
  artistSlug: string | null;
  cover: string | null;
  coverOverride: string | null;
  /** the version of the folder cover on the Mac for this song's record (as DeskAlbum.localCoverVersion) */
  coverVersion?: string | null;
  seconds: number | null;
  /** its place on its record, when known (the song list for search and artist pages carries it) */
  trackNo?: number | null;
  /** in a playlist: the item's position (the order key a move writes between) */
  position?: number;
};

export type DeskPlaylistPage = {
  id: string;
  name: string;
  description: string | null;
  cover: string | null;
  minutes: number;
  songs: OwnedTrack[];
};

/** A record on the Mac opened as a page: your copy first, then (when matched) what the press said. */
export type DeskRecordPage = {
  album: DeskAlbum;
  songs: OwnedTrack[];
  minutes: number;
  /** the record's press, when it has any: the lead quote and the count */
  press: { quote: string; outlet: string; year: string | null; total: number; noun: string } | null;
};

/** A catalog artist's details, for the artist view (data.ts loadArtistAbout). */
export type DeskArtistAbout = {
  similar: Array<{ slug: string; name: string }>;
};

/** A record as a device holds it: enough for a cover wall. */
export type DeskHeld = { key: string; title: string; artist: string; slug: string | null; cover: string | null; covers?: string[] };

export type DeskDevice = {
  id: string;
  name: string;
  /** what it is, in the phone's words: "Mac", "iPhone", "Android phone", "Music player" */
  kind: string;
  glyph: "laptop" | "desktop" | "iphone" | "usb";
  light: "live" | "idle" | "offline";
  /** "Active" or "Last seen 2h ago" */
  seen: string;
  /** not seen in over a week (the founder, 2026-10-31) */
  stale?: boolean;
  /** when it was last seen (ISO): sets its ring on the Devices map, today, this month or longer */
  seenAt?: string | null;
  albums: number | null;
  /** phones: the records on it, and the ones taken off it (kept off until sent back) */
  held: DeskHeld[];
  keptOff: DeskHeld[];
  /** phones: the library's records chosen for it, by key (what it gets when the account sends only chosen ones, BUG-898) */
  chosen?: string[];
};

export type DeskDevices = {
  mac: (DeskDevice & { lastSync: string | null }) | null;
  phones: DeskDevice[];
  albumTotal: number;
  songs: number;
  /** what the phones get: the whole library, or only the records chosen for each (the account's one switch) */
  scope?: "everything" | "selective";
};

export type { Playable };

export const DESK = "/desk";

/** A record's page: by its catalog slug when matched, else by its group key. */
export const recordId = (a: Pick<DeskAlbum, "slug" | "key">) => (a.slug ? a.slug : `k-${toBase64Url(a.key)}`);
/** A record's page in the window: a shelf record (yours first when it's on the Mac), or a catalog slug. */
export const deskAlbum = (a: Pick<DeskAlbum, "slug" | "key"> | string) => `${DESK}/album/${typeof a === "string" ? a : recordId(a)}`;
/** A catalog record's page (the press, the full write-up), whether or not it is on the Mac. */
export const deskRecordPage = (slug: string) => `${DESK}/album/${slug}?page=1`;
export const deskArtist = (slug: string) => `${DESK}/artist/${slug}`;
/** An artist's page in the window: by catalog slug when matched, else by their name as the Mac has it. */
export const deskArtistOf = (a: { artist: string; artistSlug: string | null }) =>
  a.artistSlug ? deskArtist(a.artistSlug) : `${DESK}/artist/k-${toBase64Url(a.artist)}`;
export const deskPlaylist = (id: string) => `${DESK}/playlists/${id}`;
