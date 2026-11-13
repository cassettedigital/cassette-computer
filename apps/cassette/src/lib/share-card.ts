import type { Metadata } from "next";

type OpenGraph = NonNullable<Metadata["openGraph"]>;

/** The site's own share picture (app/opengraph-image.tsx), for any page that has none of its own. */
export const SITE_SHARE_IMAGE = { url: "/opengraph-image", width: 1200, height: 630, alt: "Cassette" };

/**
 * A page's share card (what iMessage, Slack or X show for its link). A page that sets its own openGraph
 * replaces the whole card its layouts set, picture included (Next merges metadata one key deep), so every
 * openGraph on the site goes through here: the site's name, and the site's picture unless the page
 * brings its own (a record's cover). share-card.test.ts holds every page to it.
 */
export function shareCard<T extends OpenGraph>(card: T): T {
  return { siteName: "Cassette", ...card, images: card.images ?? SITE_SHARE_IMAGE } as T;
}
