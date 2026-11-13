/**
 * A song's own artist, as its file names it, for the Mac app (the founder, 2026-10-27: show who's
 * featured on a song "using only what the files say"). Nothing here comes from our catalog: both
 * inputs are the person's own tags (user_library_index.artist_name and album_artist), so a library
 * shows only what it brought with it (the library ownership rule: a library keeps the data it had on
 * import, and our catalog's song credits stay out of it).
 */

/** Two spellings of one name read as one: case, accents, a leading "The", dashes and spacing. */
const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/^the\s+/, "")
    .replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * The file's own artist when it names more than, or other than, the record's artist ("Gorillaz feat.
 * Thundercat" on a Gorillaz record, "JAY-Z" on a soundtrack); null when it only repeats the record's
 * artist (or the file's own album artist) in another spelling.
 */
export function songArtistOf(
  fileArtist: string | null | undefined,
  fileAlbumArtist: string | null | undefined,
  recordArtist: string | null | undefined,
): string | null {
  const own = fileArtist?.trim();
  if (!own) return null;
  const n = norm(own);
  if (!n) return null;
  if (recordArtist && n === norm(recordArtist)) return null;
  if (fileAlbumArtist && n === norm(fileAlbumArtist)) return null;
  return own;
}

const FEATURE = /^(feat\.?|ft\.?|featuring|with)\s/i;

/**
 * The line under a song on its own record, where the record's artist is already said at the top: a
 * feature keeps only what follows the record's name, in the file's own words ("feat. Thundercat");
 * anything else is the file's artist whole ("Julien Baker & TORRES", "JAY-Z").
 */
export function songLineOnRecord(songArtist: string | null | undefined, recordArtist: string | null | undefined): string | null {
  if (!songArtist) return null;
  const lead = recordArtist?.trim();
  if (lead && songArtist.toLowerCase().startsWith(lead.toLowerCase())) {
    let rest = songArtist.slice(lead.length).trim();
    const bracketed = rest.startsWith("(") && rest.endsWith(")");
    if (bracketed) rest = rest.slice(1, -1).trim();
    if (FEATURE.test(rest)) return rest;
  }
  return songArtist;
}
