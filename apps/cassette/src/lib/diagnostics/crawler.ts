/**
 * Crawler / headless-browser detection for the diagnostics spine (BUG-309).
 *
 * Two bots produced ~760 of the ~770 open production web reports found on 2026-09-03:
 * Facebook's `meta-externalagent/1.1` link crawler (which runs our client JS long after a
 * deploy and hits stale chunk URLs, filing a ChunkLoadError per visit) and `Lightpanda/1.0`
 * (a headless browser that breaks next-auth's `_getSession`). Neither is a person, so
 * neither belongs in the error queue. The same pattern is applied in three places so
 * they can't drift: the client reporter (before the POST), the ingest route (so native
 * clients and old bundles are covered), and the admin Issues/Events views (a default
 * "hide crawlers" filter for rows that landed before this shipped).
 *
 * ONE pattern string, valid as both a JS RegExp source and a Postgres `~*` regex — so no
 * `\b` (Postgres spells word boundaries `\m`/`\M`). `bot[/; )]` covers Googlebot/2.1,
 * bingbot/2.0), "Discordbot/" and "(compatible; SemrushBot;" without matching "Abbott".
 * Manual user feedback is never gated on this: a person's browser is theirs to name.
 */
export const CRAWLER_UA_PATTERN =
  "(meta-externalagent|facebookexternalhit|lightpanda|headlesschrome|puppeteer|playwright|phantomjs|crawl|spider|slurp|python-requests|python-urllib|bot[/; )]|curl/|wget/)";

const CRAWLER_UA_RE = new RegExp(CRAWLER_UA_PATTERN, "i");

export function isCrawlerUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false;
  return CRAWLER_UA_RE.test(userAgent);
}
