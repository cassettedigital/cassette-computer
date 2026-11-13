/**
 * The line under a page's title in a search result, and the same words in its structured data and share card.
 * Founder, 2026-11-04: never the old AI card description (the public pages carry no AI prose, so a search
 * result must not either). A press page leads with a critic's own words and outlet; every other page says plain
 * facts we hold about the record or the artist.
 */

import type { PressSet } from "@/app/(taste)/_kit/types";

/** An album as a tab, a card or a search result names it, on the website and in the desk alike. */
export const albumName = (title: string, artist: string): string => `${title} by ${artist}`;

/** Room Google shows before it cuts a description. */
const ROOM = 155;
/** A cut shorter than this reads as a stray fragment ("“Dr.”"), so the line cuts at a word instead. */
const SHORTEST_SENTENCE = 50;

/** Curly quotes inside a quote become single ones, so wrapping it in double quotes never doubles them. */
function nest(q: string): string {
  return q.replace(/“/g, "‘").replace(/”/g, "’").replace(/"/g, "'");
}

/** Strip quote marks only when they wrap the whole quote ("“It works.”" yes, "“Title” is great." no). */
function unwrap(q: string): string {
  const t = q.trim();
  return /^[“"].*[”"]$/s.test(t) && !/[”"]/.test(t.slice(1, -1)) ? t.slice(1, -1).trim() : t;
}

/** Sentence ends: a stop (maybe closed by a quote mark or bracket) then a capital, never after a common
 *  abbreviation ("Dr.", "Vol.", "feat.") or a single initial ("J. Dilla", "U.S."), and never before a digit
 *  ("Blackout! 2", "Vol. 3"). */
const SENTENCE_END =
  /(?<=[.!?…][’')]?)(?<!\b(?:Mr|Mrs|Ms|Dr|St|Sgt|Jr|Sr|Vol|Vols|No|Nos|vs|feat|ft|Mt|Lt|Col|Gen|Op|Pt|Bros|Co|Inc|Ltd|ca|approx|incl|Ed|Eds|Rev|Prof)\.)(?<!(?:^|[\s.‘'(-])\p{Lu}\.)\s+(?=[\p{Lu}‘'(])/u;

/** Small words a cut must not end on before its ellipsis ("…and the…"). */
const DANGLING = /(?:\s+(?:a|an|the|and|or|but|nor|of|to|in|on|at|by|for|from|with|as|that|which|who|whose|is|was|are|were|be|been|his|her|its|their|this|these|those|than|into|so|if|when|while))+$/i;

/**
 * The quote and who said it, as many whole sentences as fit; when that would be a short fragment or nothing,
 * the quote is cut at a word with an ellipsis. “Ash is an album directly affected by the tension of the times.” (AllMusic)
 */
export function pressSearchLine(quote: string, outlet: string): string {
  const by = ` (${outlet})`;
  const room = ROOM - by.length - 2;
  const q = nest(unwrap(quote));
  let out = "";
  for (const s of q.split(SENTENCE_END)) {
    const next = out ? `${out} ${s}` : s;
    if (next.length > room) break;
    out = next;
  }
  if (out.length < Math.min(SHORTEST_SENTENCE, q.length)) {
    out = `${q.slice(0, room - 1).replace(/\s+\S*$/, "").replace(DANGLING, "").replace(/[\s,;:–—-]+$/, "")}…`;
  }
  return `“${out}”${by}`;
}

const KIND: Record<string, string> = { album: "album", ep: "EP", single: "single", compilation: "compilation", live: "live album", soundtrack: "soundtrack" };

/** Facts we hold about a record, for a page without press. "25 is a 1992 album by Harry Connick, Jr.: 13 songs, 66 minutes." */
export function albumFactLine(r: {
  title: string;
  artist: string;
  releaseDate: string | null;
  releaseType: string | null;
  trackCount: number | null;
  runtimeSeconds: number | null;
}): string {
  const year = r.releaseDate?.slice(0, 4);
  const kind = KIND[(r.releaseType ?? "").toLowerCase()] ?? "record";
  const what = year ? `${year} ${kind}` : kind;
  // "an 1880 album", "an EP", "an album"
  const head = `${r.title} is ${/^(?:[aeiou]|EP\b|8|18\d\d|11\d\d)/i.test(what) ? "an" : "a"} ${what} by ${r.artist}`;
  const songs = r.trackCount && r.trackCount > 0 ? r.trackCount : 0;
  const parts: string[] = [];
  if (songs) parts.push(`${songs} ${songs === 1 ? "song" : "songs"}`);
  if (r.runtimeSeconds && r.runtimeSeconds >= 60) parts.push(`${Math.round(r.runtimeSeconds / 60)} minutes`);
  const line = `${head}${parts.length ? `: ${parts.join(", ")}` : ""}.`;
  const more = " Tracklist and previews on Cassette.";
  return songs && line.length + more.length <= ROOM ? line + more : line;
}

/**
 * An album page's line: a critic's verdict when the page shows press (the page's lead, unless that is an
 * interview line or a reader review and a critic's quote is also on show), else the record's facts.
 */
export function albumSearchLine(press: PressSet | null | undefined, facts: Parameters<typeof albumFactLine>[0]): string {
  const top = press?.top ?? [];
  const lead = top.find((e) => e.quote && !e.voice && !e.member) ?? top.find((e) => e.quote) ?? null;
  return lead ? pressSearchLine(lead.quote!, lead.outlet) : albumFactLine(facts);
}

/**
 * Facts we hold about an artist: MusicBrainz's disambiguation, which is its core CC0 data. Never the genre:
 * the imported genre is MusicBrainz's non-commercial tag data (BUG-740). Never the retired Last.fm bio (July
 * 2026 exit) nor the AI card. "Eminem: American rapper."
 */
export function artistFactLine(a: { name: string; disambiguation?: string | null }): string {
  const dis = typeof a.disambiguation === "string" ? a.disambiguation.trim().replace(/\s+\|\s+/g, ", ") : "";
  if (!dis) return `${a.name}: records, tracklists and previews on Cassette.`;
  const said = dis.charAt(0).toUpperCase() + dis.slice(1);
  return /[.!?]$/.test(a.name) ? `${a.name} ${said}.` : `${a.name}: ${said}.`;
}

/** Country codes (MusicBrainz's core, CC0) to the word a line uses. Only these; any other code says nothing. */
const DEMONYM: Readonly<Record<string, string>> = {
  US: "American", GB: "British", IE: "Irish", CA: "Canadian", AU: "Australian", NZ: "New Zealand",
  DE: "German", FR: "French", IT: "Italian", ES: "Spanish", PT: "Portuguese", NL: "Dutch", BE: "Belgian",
  SE: "Swedish", NO: "Norwegian", DK: "Danish", FI: "Finnish", IS: "Icelandic", AT: "Austrian", CH: "Swiss",
  PL: "Polish", CZ: "Czech", HU: "Hungarian", GR: "Greek", RU: "Russian", UA: "Ukrainian", TR: "Turkish",
  IL: "Israeli", JP: "Japanese", KR: "South Korean", CN: "Chinese", TW: "Taiwanese", HK: "Hong Kong",
  IN: "Indian", ID: "Indonesian", TH: "Thai", PH: "Filipino", BR: "Brazilian", AR: "Argentine",
  MX: "Mexican", CO: "Colombian", CL: "Chilean", CU: "Cuban", JM: "Jamaican", NG: "Nigerian",
  GH: "Ghanaian", ZA: "South African", ML: "Malian", SN: "Senegalese", ET: "Ethiopian", EG: "Egyptian",
};

/** A person or a group, from MusicBrainz's core artist type; null when it doesn't say. */
export type ActKind = "person" | "group" | null;

/** MusicBrainz's core artist type ("Person", "Group", "Orchestra", "Choir") as a person or a group. */
export function actKindOf(type: string | null | undefined): ActKind {
  if (type === "Person") return "person";
  return type === "Group" || type === "Orchestra" || type === "Choir" ? "group" : null;
}

/** The record and the song an artist is best known for, as their page picks them. */
export type KnownFor = { record: string | null; song: string | null };

/**
 * What an artist is best known for (BUG-850), from the page's own picks: the record the catalogue ranks
 * first (centrality), else the record their best-known song is on; never the newest record as a guess. The
 * song is the first of their best-known songs (the stored list, else the songs pass's score).
 */
export function knownFor(
  studio: { slug: string; title: string; centralityRank: number | null }[],
  best: { title: string; albumSlug: string | null }[],
): KnownFor {
  const ranked = studio.filter((r) => r.centralityRank != null).sort((a, b) => (a.centralityRank as number) - (b.centralityRank as number));
  const songAlbum = best[0]?.albumSlug ? studio.find((r) => r.slug === best[0].albumSlug) : undefined;
  const record = ranked[0]?.title ?? songAlbum?.title ?? null;
  const song = best[0]?.title?.trim().replace(/^["“'‘]+|["”'’]+$/g, "") || null;
  return { record: record?.trim() || null, song };
}

/**
 * An artist's search line (BUG-850, founder 2026-11-10: "build from our own facts"): who they are, what
 * they're best known for, and what their page holds. Never Wikipedia's sentence (Google already shows it,
 * and the same words twice is a quick way to rank lower), never the imported genre (MusicBrainz's tag data,
 * BUG-740), never the old AI card. Who: MusicBrainz's disambiguation where there is one ("US rapper"), else
 * the country and whether it's a person or a group ("British group"). `reviewed`: the page quotes critics.
 *   "Radiohead, British group. Best known for OK Computer and “Creep”. Their records, and what critics said
 *    about them, on Cassette."
 */
export function artistSearchLine(
  a: { name: string; disambiguation?: string | null; country?: string | null; kind?: ActKind },
  known: KnownFor,
  reviewed: boolean,
): string {
  const name = a.name.trim();
  const dis = typeof a.disambiguation === "string" ? a.disambiguation.trim().replace(/\s+\|\s+/g, ", ").replace(/[.\s]+$/, "") : "";
  const place = a.country ? DEMONYM[a.country.toUpperCase()] : undefined;
  const who = dis ? `${name}, ${dis}` : place ? `${name}, ${place} ${a.kind === "group" ? "group" : "artist"}` : name;
  const parts = [/[.!?]$/.test(who) ? who : `${who}.`];
  const record = known.record?.trim() || null;
  const song = known.song?.trim() || null;
  const sameName = record && song && record.toLowerCase() === song.toLowerCase();
  // a title that ends on its own stop ("Icarus Lives!") takes no second one
  const stop = (t: string) => (/[.!?]$/.test(t) ? "" : ".");
  if (record && song && !sameName) parts.push(`Best known for ${record} and “${song}”${stop(song)}`);
  else if (record) parts.push(`Best known for ${record}${stop(record)}`);
  else if (song) parts.push(`Best known for “${song}”${stop(song)}`);
  parts.push(reviewed ? "Their records, and what critics said about them, on Cassette." : "Their records on Cassette.");
  return parts.join(" ");
}
