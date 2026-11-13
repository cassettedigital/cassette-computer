/**
 * An artist's own places on the web, as the artist page shows them (founder, 2026-11-12): their website, listed with
 * the rest of their facts, and their Bandcamp, a row in every record's Buy list. Both come from the artist's own
 * MusicBrainz links (the website also from Wikidata), kept only while the address still opens: the fill
 * (scripts/artist-own-links.ts) checks each one and saves the live ones in artist_external_ids, one row per kind.
 * Nothing here reads a store or checks one is current: a site that opens is listed.
 *
 * The rules are plain so the page, the fill and their tests agree: which addresses count as a website at all (never a
 * social profile, a streaming page or a link-in-bio page), which one wins when there are several, how a website is
 * named on the page (its address, without "www."), what counts as a page that is still up, and what counts as a
 * Bandcamp page of their own.
 */

/** The two kinds the page shows, as stored in artist_external_ids.source. */
export const OWN_LINK_SOURCES = ["website", "bandcamp"] as const;
export type OwnLinkSource = (typeof OWN_LINK_SOURCES)[number];

export type OwnLinks = { website: string | null; bandcamp: string | null };
export const NO_OWN_LINKS: OwnLinks = { website: null, bandcamp: null };

/** An address the page can link to: http or https, with a host. Anything else is no address. */
export function webAddress(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".")) return null;
    return u;
  } catch {
    return null;
  }
}

/** The host without "www.", lower case: "mavisstaples.com". */
export function hostOf(u: URL): string {
  return u.hostname.toLowerCase().replace(/^www\./, "");
}

/** How the website is named on the page: its address as a person would type it, "mavisstaples.com". */
export function siteLabel(raw: string): string | null {
  const u = webAddress(raw);
  return u ? hostOf(u) : null;
}

/**
 * Places that are somebody's profile on another company's site, not a website of their own: social networks, video
 * and streaming services, link-in-bio pages, wikis and databases. MusicBrainz and Wikidata sometimes list one of
 * these as an artist's "official homepage"; it is never shown as their website. Bandcamp is its own kind.
 */
const NOT_A_WEBSITE = [
  "facebook.com", "instagram.com", "twitter.com", "x.com", "threads.net", "tiktok.com", "myspace.com", "bsky.app",
  "youtube.com", "youtu.be", "soundcloud.com", "spotify.com", "apple.com", "deezer.com", "tidal.com", "last.fm",
  "bandcamp.com", "audiomack.com", "mixcloud.com", "reverbnation.com", "vk.com", "weibo.com", "linkedin.com",
  "linktr.ee", "lnk.to", "ffm.to", "found.ee", "smarturl.it", "hypeddit.com", "link.fans", "fanlink.to", "solo.to",
  "beacons.ai", "carrd.co", "wikipedia.org", "wikidata.org", "discogs.com", "allmusic.com", "imdb.com",
  "blogspot.com", "tumblr.com", "patreon.com", "kickstarter.com", "google.com", "sites.google.com",
];

function onHost(host: string, list: readonly string[]): boolean {
  return list.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Whether an address can stand as the artist's own website. */
export function isWebsite(raw: string): boolean {
  const u = webAddress(raw);
  return !!u && !onHost(hostOf(u), NOT_A_WEBSITE);
}

/** Whether an address is a Bandcamp page of the artist's own: a name.bandcamp.com page (not bandcamp.com itself). */
export function isOwnBandcamp(raw: string): boolean {
  const u = webAddress(raw);
  if (!u) return false;
  const h = hostOf(u);
  return h.endsWith(".bandcamp.com") && h !== "daily.bandcamp.com";
}

/**
 * The website to check first when there are several: a site's front page before a page deep inside another site (a
 * label's page about them), then the order they came in (MusicBrainz's before Wikidata's). Duplicates go.
 */
export function rankSites(candidates: string[]): string[] {
  const seen = new Set<string>();
  const out: Array<{ url: string; deep: boolean; i: number }> = [];
  candidates.forEach((raw, i) => {
    const u = webAddress(raw);
    if (!u || !isWebsite(raw)) return;
    const key = hostOf(u) + u.pathname.replace(/\/+$/, "");
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ url: u.toString(), deep: u.pathname.replace(/\/+$/, "").split("/").filter(Boolean).length > 0, i });
  });
  return out.sort((a, b) => Number(a.deep) - Number(b.deep) || a.i - b.i).map((x) => x.url);
}

/** A page offered for sale or parked by a registrar: up, but not theirs any more. */
const PARKED =
  /(domain (is )?for sale|buy this domain|this domain (name )?(may be|is) (for sale|available)|parked (free|domain|by)|domain parking|hugedomains\.com|sedo\.com|dan\.com\/|afternic\.com|domainmarket\.com|the domain [^<]{0,60} (is|may be) for sale)/i;
const PARKING_HOSTS = ["hugedomains.com", "sedo.com", "dan.com", "afternic.com", "godaddy.com", "domainmarket.com", "parkingcrew.net", "bodis.com", "sedoparking.com"];

/** What an address did when it was opened once. `status` is the HTTP status, or null when nothing answered. */
export type Opened = { status: number | null; finalUrl: string | null; body: string };

/**
 * Whether a website is still live: it answered, and not with a page that is gone (404, 410), broken (5xx) or parked.
 * A site that turns robots away (401, 403, 429) is up: a person's browser opens it (coldplay.com does this).
 */
export function siteIsLive(o: Opened): boolean {
  if (o.status == null) return false;
  const final = webAddress(o.finalUrl);
  if (final && onHost(hostOf(final), PARKING_HOSTS)) return false;
  if (o.status === 401 || o.status === 403 || o.status === 429) return true;
  if (o.status >= 400) return false;
  return !PARKED.test(o.body);
}

/**
 * Whether a Bandcamp page is still theirs and up: it opened, isn't Bandcamp's "isn't here" page, and is still a
 * Bandcamp page (on bandcamp.com, or on the artist's own domain, which Bandcamp allows and still serves).
 */
export function bandcampIsLive(o: Opened): boolean {
  if (o.status == null || o.status >= 400) return false;
  if (/Sorry, that something isn.t here/i.test(o.body)) return false;
  const final = webAddress(o.finalUrl);
  return !final || isOwnBandcamp(final.toString()) || /bcbits\.com/.test(o.body);
}

/**
 * The address to keep for a live site: its front door. Where it ended up when that is the same site (so an old
 * http:// address that now moves to https:// is saved as https://); the address we were given when it sent us
 * somewhere else (ledzeppelin.com to a promotion's page, elvis.com to its shop), when it turned robots away, or when
 * nothing came back to say.
 */
export function addressToKeep(asked: string, o: Opened): string {
  const a = webAddress(asked);
  const final = o.status != null && o.status < 400 ? webAddress(o.finalUrl) : null;
  return a && final && hostOf(final) === hostOf(a) ? final.toString() : asked;
}

/**
 * An artist whose life or band ended before 1950 runs no website of their own: what MusicBrainz and Wikidata list for
 * them is a museum's, a society's or a festival's (Beethoven's is the Beethoven-Haus in Bonn). Later estates keep real
 * official sites (prince.com, johnnycash.com), so they stay. `endDate` is MusicBrainz's life-span end, "1827-03-26".
 */
export function endedBeforeWebsites(endDate: string | null | undefined): boolean {
  const y = endDate ? Number(endDate.slice(0, 4)) : NaN;
  return Number.isFinite(y) && y > 0 && y < 1950;
}
