/**
 * What an add puts on a playlist: the songs it hasn't got yet, each once (the founder's wife, 2026-11-21: adding an
 * album or an artist a second time put every song on again). A song is known by its id in the library
 * (cassetteLocalId), the one a playlist keeps; a song without one passes through, and the write leaves it out with
 * its own word. `already` is how many were asked for that it has (or that came twice in the one add), for the note.
 */

type Song = { cassetteLocalId: string | null };

export function notOnItYet<T extends Song>(songs: T[], onIt: Song[]): { fresh: T[]; already: number } {
  const seen = new Set(onIt.map((x) => x.cassetteLocalId).filter((id): id is string => !!id));
  const fresh = songs.filter((x) => {
    if (!x.cassetteLocalId) return true;
    if (seen.has(x.cassetteLocalId)) return false;
    seen.add(x.cassetteLocalId);
    return true;
  });
  return { fresh, already: songs.length - fresh.length };
}
