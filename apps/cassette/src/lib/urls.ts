/**
 * Centralised URL helpers — use these everywhere instead of hardcoding the domain.
 *
 * One host: www.cassette.digital is what serves; the bare cassette.digital only
 * redirects to it (BUG-413). So:
 *   - PUBLIC_SITE_URL is the address anything a person carries away points at: a
 *     share link, an email, an export. It never follows a preview deploy.
 *   - siteUrl() is this deployment's own address, for a page's canonical, share
 *     card, JSON-LD and the sitemap. Resolution order:
 *       1. NEXT_PUBLIC_SITE_URL: explicit override (set on Vercel)
 *       2. NEXT_PUBLIC_VERCEL_URL / VERCEL_URL: a preview's own address
 *       3. PUBLIC_SITE_URL: final fallback (local dev, the app's own build)
 *
 * Always returns absolute URLs; required for Next.js metadata + JSON-LD.
 */

export const PUBLIC_SITE_URL = "https://www.cassette.digital";

function resolveSiteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const vercel =
    process.env.NEXT_PUBLIC_VERCEL_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return PUBLIC_SITE_URL;
}

const SITE_URL = resolveSiteUrl();

/**
 * Returns absolute site URL with given path.
 *
 * USE FOR: canonical tags, Open Graph URLs, JSON-LD structured data,
 * sitemap entries, transactional emails, share/copy-link UI.
 *
 * DO NOT USE FOR: <Link href> or <a href> internal navigation.
 * Use relative paths instead (e.g., href="/discover").
 */
export function siteUrl(path = ""): string {
  return `${SITE_URL}${path}`;
}

/**
 * Returns absolute artist profile URL.
 *
 * USE FOR: SEO metadata, JSON-LD, share URLs, sitemap.
 * DO NOT USE FOR: internal nav. Use `/artist/${slug}` instead.
 */
export function artistUrl(slug: string): string {
  return siteUrl(`/artist/${slug}`);
}

/**
 * Returns absolute album profile URL.
 *
 * USE FOR: SEO metadata, JSON-LD, share URLs, sitemap.
 * DO NOT USE FOR: internal nav. Use `/album/${slug}` instead.
 */
export function albumUrl(slug: string): string {
  return siteUrl(`/album/${slug}`);
}
