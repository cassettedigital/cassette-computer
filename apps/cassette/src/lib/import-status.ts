import type { IngestState } from "@/lib/library-ingest";
import type { IngestAlbum } from "@/lib/library-remote";

/**
 * What an add of music says, in one place for every surface that shows it (the card on Devices and the
 * first Home, the status note at the foot of the window, the sidebar's Devices line), so they never
 * disagree (2026-11-20: the note flashed in and out on every song, and the card's bar sat full and still
 * while the computer looked the songs up, "Finding what it is").
 *
 * The add has two halves the person can see: the songs going into the music folder (copied or moved, one
 * by one), then the computer reading them and looking each one up in MusicBrainz, the public music
 * database, about one a second, so it knows exactly what each song is. `progress` is how far along the
 * half that's running is, 0 to 1, or null when there's nothing to count yet (the bar runs instead).
 */
export type ImportStatus = {
  /** "Adding", "Looking up", "In your library", "Couldn't add those"... */
  verb: string;
  /** what's coming in: the first record the computer found, else the name the add was given */
  what: string;
  /** the line under it: "12 of 58 songs", "Looking up 34 of 58 songs" */
  line: string;
  progress: number | null;
  /** the records found so far, for their covers */
  albums: IngestAlbum[];
  /** still going (the card's bar, the note and the sidebar line show) */
  busy: boolean;
};

const songs = (n: number) => `${n} ${n === 1 ? "song" : "songs"}`;

export function importStatus(i: IngestState): ImportStatus | null {
  const albums = i.albums ?? [];
  const first = albums[0];
  const what = first ? (albums.length > 1 ? `${first.album} and ${albums.length - 1} more` : first.album) : i.album || "your music";
  switch (i.phase) {
    case "uploading":
      return {
        verb: "Adding",
        what,
        line: i.total ? `${i.uploaded} of ${songs(i.total)}` : "Getting the songs ready",
        progress: i.total ? Math.min(1, i.uploaded / i.total) : null,
        albums,
        busy: true,
      };
    case "identifying": {
      if (i.stage === "lookingUp" && i.lookTotal) {
        return {
          verb: "Looking up",
          what,
          line: `Looking up ${Math.min(i.checked ?? 0, i.lookTotal)} of ${songs(i.lookTotal)}`,
          progress: Math.min(1, (i.checked ?? 0) / i.lookTotal),
          albums,
          busy: true,
        };
      }
      if (i.stage === "saving") return { verb: "Saving", what, line: "Putting it in your library", progress: null, albums, busy: true };
      return { verb: "Reading", what, line: "Reading the new songs", progress: null, albums, busy: true };
    }
    case "done":
      return { verb: "In your library", what, line: i.total ? songs(i.total) : "", progress: 1, albums, busy: false };
    case "queued":
      return { verb: "Waiting for your computer", what, line: `${songs(i.queued)} go in when it's back`, progress: null, albums, busy: false };
    case "error":
      return { verb: "Couldn't add those", what, line: "", progress: null, albums, busy: false };
    default:
      return null;
  }
}
