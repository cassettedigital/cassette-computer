/**
 * Every artist and album address. Pure. Links to these use next/link so the dock keeps playing; links
 * to the rest of the site are plain <a>.
 */

/** Where the artist and album pages live (they were under /proto/taste while they were mocks). */
export const TASTE = "";

/** The mockups' slug alphabet (artist-taste/a/[slug]/page.tsx:44), with a length cap. Pages lower-case
 *  an address first (canonicalSlug redirects /artist/RADIOHEAD), then check it. */
export const SLUG = /^[a-z0-9-]+$/;
export const isSlug = (s: string): boolean => s.length > 0 && s.length <= 160 && SLUG.test(s);

/**
 * Album page anchors. `pressAll` lands on the press section with Read all already open, so the artist
 * page's "Read all 21 reviews" is one click, not two.
 */
export const ALBUM_SECTION = { songs: "songs", press: "press", pressAll: "press-all" } as const;
export type AlbumSection = (typeof ALBUM_SECTION)[keyof typeof ALBUM_SECTION];

export const artistHref = (slug: string): string => `${TASTE}/artist/${slug}`;
export const albumHref = (slug: string, section?: AlbumSection): string =>
  `${TASTE}/album/${slug}${section ? `#${section}` : ""}`;
