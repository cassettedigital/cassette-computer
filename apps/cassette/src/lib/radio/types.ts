/**
 * The normalized now-playing shape every adapter returns and the dock reads.
 * Plain types, shared by the server adapters and the client provider.
 */

export interface RadioShow {
  name: string;
  host?: string | null;
  /** This airing's own line, which changes with each airing (KEXP: the host's note for the day). What the
   *  dock shows under the show. Never the show's description: see `description`. */
  tagline?: string | null;
  /** The station's own words for the PROGRAM, the same at every airing, where the station publishes them
   *  (KEXP's program list, an Airtime station's show info). What the show list keeps (radio_shows.description,
   *  BUG-583). Left out when the station gives only a line per airing. */
  description?: string | null;
  /** ISO time the show started (or, for an upcoming show, starts). */
  starts?: string | null;
  /** ISO time the show ends, when the source says. */
  until?: string | null;
  genres?: string[];
  /** The show's own picture, when the station publishes one. */
  image?: string | null;
}

export interface RadioTrack {
  artist: string;
  title: string;
  album?: string | null;
  year?: string | null;
  /** The DJ's own note on the play (KEXP). */
  comment?: string | null;
  coverUrl?: string | null;
  /** ISO time the song starts, for a queued song (Radio Paradise). */
  starts?: string | null;
}

export interface RadioMatch {
  albumSlug: string;
  title: string;
  artistName: string;
  /** The record's artist's page, when they have one. */
  artistSlug?: string | null;
  coverUrl: string | null;
  /** The full-size cover, for a large picture (the phone's player). */
  coverFullUrl?: string | null;
  /** true = matched on a MusicBrainz id; false = matched on names. */
  exact: boolean;
}

export interface RadioNowPlaying {
  station: string;
  fetchedAt: string;
  show?: RadioShow | null;
  track?: RadioTrack | null;
  match?: RadioMatch | null;
  /** The shows after this one, soonest first (at most three). */
  next?: RadioShow[];
  /** The songs queued after this one, when the station publishes its running order. */
  nextTracks?: RadioTrack[];
}

/** A song the station played, newest first, where the station publishes its list. */
export interface RadioPlay extends RadioTrack {
  /** ISO time it went out, when the station says. */
  playedAt?: string | null;
  /** The MusicBrainz recording id, when the station names it (KEXP): an exact match to our songs. */
  recordingMbid?: string | null;
  /** The record on Cassette it came from, when the station page matched it (lib/radio/station-page). */
  match?: RadioMatch | null;
}

// ─── The station list as the cloud serves it ───────────────────────────────
// The shapes of GET /api/radio/catalog (lib/radio/catalog), the station page (lib/radio/station-page) and the
// dial (lib/radio/dial). They live here, apart from the registry they are made from (config/radio*), so the
// screens that only draw the answer (the phones, the Mac app's desk, the shared radio player) never carry the
// registry itself: its notes on each station's clearance and ads stay on the website's server.

/** A station's longer text from outside, with its credit (config/radio-about's RadioAbout, as served). */
export interface RadioCatalogAbout {
  /** One or two plain paragraphs, separated by a blank line. */
  text: string;
  /** Who wrote it, as the credit line shows it ("Wikipedia"). */
  source: string;
  /** Where the credit links. */
  url: string;
  /** License note when the source asks for one ("CC BY-SA 4.0"). */
  license?: string;
}

export interface RadioCatalogStation {
  slug: string;
  name: string;
  source: string;
  /** The network name a card shows ("WWOZ 90.7", "SomaFM", "FIP · Radio France"). */
  sourceLabel: string;
  kind: "channel" | "station";
  streamUrl: string;
  homepage: string | null;
  supportUrl: string | null;
  description: string;
  image: string | null;
  accent: string;
  moods: string[];
  eras: string[];
  genres: string[];
  cities: string[];
  /** Human labels for the cities (the phone shows "San Francisco", not a slug). */
  cityLabels: string[];
  /** The one section label the phone files this station under. */
  section: string;
  hasNowPlaying: boolean;
  /** The station publishes its running list of songs (the page shows recent plays). */
  hasRecentPlays: boolean;
  /** Slugs of the stations most like this one, best first (lib/radio/similar). */
  similar: string[];
  /** Longer text from outside, with its credit; null until a station has some. */
  about: RadioCatalogAbout | null;
}

export interface RadioCatalog {
  version: 1;
  generatedAt: string;
  lanes: {
    moods: { id: string; label: string; blurb: string }[];
    eras: { id: string; label: string; blurb: string }[];
    cities: { id: string; label: string; blurb: string }[];
  };
  /** Section titles in display order: the live regions, then moods, then eras. */
  sectionOrder: string[];
  stations: RadioCatalogStation[];
}

/** Everything a station page shows (lib/radio/station-page; GET /api/radio/station/<slug>). */
export interface RadioStationPage {
  station: RadioCatalogStation;
  /** What's on now; null for a station with no feed we read. */
  live: RadioNowPlaying | null;
  /** Songs before the one on now, newest first; empty where the station does not publish them. */
  recent: RadioPlay[];
  /** The stations in `station.similar`, resolved, in that order. */
  similar: RadioCatalogStation[];
  /** The records on Cassette the station played most this month (lib/radio/station-log), most played first. */
  records: RadioStationRecord[];
}

/** A record a station played, as its page shows it: the record, and how many times it went out this month. */
export interface RadioStationRecord {
  albumSlug: string;
  title: string;
  artistName: string;
  coverUrl: string | null;
  plays: number;
}

/** One station on the dial as the Radio page draws it (lib/radio/dial; the desk's `stations`). */
export type DialStation = {
  slug: string;
  name: string;
  /** "Network · City · Live", the phone's kicker */
  kicker: string;
  network: string;
  description: string;
  /** an absolute address: the station's picture is the website's, wherever the dial is drawn */
  image: string | null;
  accent: string;
  section: string;
  /** the station publishes what's on (a show or a song) */
  live: boolean;
  /** its own website, and where to support it (a donate or store page), for its menu */
  homepage: string | null;
  supportUrl: string | null;
};
