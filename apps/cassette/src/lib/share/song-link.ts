/**
 * The address of one song on its album page: /album/chromakopia?song=balloon. Shared by the share
 * button (which builds it), the album page (which opens the song's frame from it) and the page's link
 * preview (which names the song). Pure.
 *
 * The song is named by its title, readable in a message. When two songs on the record would read the
 * same ("Intro" on both discs), the param falls back to the catalog song id, which is always unique.
 * Both forms are accepted, so an id link keeps working if a title is later corrected.
 */

import { slugify } from "@discovery/utils";

type SongRef = { id: number; title: string };

export function songParam(song: SongRef, onAlbum: SongRef[]): string {
  const mine = slugify(song.title);
  const clash = !mine || onAlbum.some((t) => t.id !== song.id && slugify(t.title) === mine);
  return clash ? String(song.id) : mine;
}

/** The song a ?song= value names on this record, or null when it names none. */
export function findSong<T extends SongRef>(param: string | null | undefined, onAlbum: T[]): T | null {
  if (!param) return null;
  const v = param.trim().toLowerCase();
  if (/^\d+$/.test(v)) return onAlbum.find((t) => t.id === Number(v)) ?? null;
  const hits = onAlbum.filter((t) => slugify(t.title) === v);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * A ?song= on the album page: the song on the page's own list, else one the page left off with a bonus disc
 * (BUG-715). The page lays its songs out without an edition's bonus disc, but the songs index and every share
 * link carry songs from any disc, so a link to "Crazy Train (Live)" on a deluxe edition's second disc would
 * find nothing on the list and open the page with nothing on top. The page's own list is tried first, so a
 * link that names a song on the record keeps meaning it. `leftOff` says which list the song came from.
 */
export function findSongForPage<T extends SongRef, U extends SongRef>(
  param: string | null | undefined,
  onPage: T[],
  leftOff: U[],
): { song: T; leftOff: false } | { song: U; leftOff: true } | null {
  const own = findSong(param, onPage);
  if (own) return { song: own, leftOff: false };
  const aside = findSong(param, leftOff);
  return aside ? { song: aside, leftOff: true } : null;
}

/** The album page path with the song in it, for links inside the site and for sharing. */
export function songPath(albumSlug: string, param: string): string {
  return `/album/${albumSlug}?song=${encodeURIComponent(param)}`;
}

/** What the link preview says, and what the share sheet carries as its title. */
export function songShareTitle(song: string, artist: string): string {
  return `Listen to ${song} by ${artist} on Cassette`;
}
