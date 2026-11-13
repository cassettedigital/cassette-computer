/**
 * Cassette image URL helper.
 *
 * Thin wrappers around @discovery/storage's getImageUrl that pre-bind the
 * Cloudflare Images custom domain from the environment.
 *
 * Usage:
 *   import { coverUrl, artistImageUrl } from "@/lib/image-url";
 *   <img src={coverUrl(album.coverArtUrl, { width: 400, height: 400 })} />
 *
 * When CF is ENABLED (host set AND NEXT_PUBLIC_CF_IMAGE_ENABLED==='true'): returns
 * a Cloudflare Image Resizing URL (AVIF/WebP, edge-cached). Otherwise — the
 * default, including every current environment — returns the raw source URL so
 * the Next.js image optimizer handles it. See CF_IMAGE_ENABLED for why CF is
 * dormant by default.
 *
 * Infrastructure setup (one-time, Cloudflare dashboard):
 *   1. R2 → cassette-covers bucket → Settings → Custom Domains → Add domain
 *      (e.g. images.cassettedigital.com → cassette-covers bucket)
 *   2. Speed → Optimization → Image Resizing → Enable (requires Pro plan)
 *   3. Set NEXT_PUBLIC_CF_IMAGE_HOST=https://images.cassettedigital.com in Vercel
 *      and locally in .env.local for testing real transforms
 */

import { getImageUrl } from "@discovery/storage";
import { caaAddressForArchiveCopy } from "./caa-address";
import { R2_DEV_MEDIA } from "./media-bucket";

const CF_IMAGE_HOST = process.env.NEXT_PUBLIC_CF_IMAGE_HOST;

/**
 * The media bucket's r2.dev development address, which every stored cover and
 * artist photo URL still uses, and our own domain in front of the same bucket.
 * Cloudflare rate-limits r2.dev and never caches it at the edge (BUG-430);
 * media.cassette.digital serves the identical objects with edge caching. Only
 * this one bucket is swapped: the uploads and products buckets have their own
 * r2.dev hosts and pass through untouched. The address lives in media-bucket.ts.
 */
const MEDIA_HOST = `${(process.env.NEXT_PUBLIC_MEDIA_HOST ?? "https://media.cassette.digital").replace(/\/+$/, "")}/`;

/**
 * Normalize a stored media URL for serving. Three rewrites, all safe by
 * construction because the bytes are identical:
 *   1. http:// becomes https://. Cover Art Archive stores ~887k of our catalog
 *      cover URLs with the legacy http:// scheme, but the app renders over https
 *      and Next/Image's remotePatterns are https-only, so an http:// source is
 *      already a broken image (rejected → initials fallback).
 *   2. The media bucket's r2.dev address becomes media.cassette.digital, so every
 *      fetch (the Next optimizer's, a phone's, a crawler's) hits Cloudflare's
 *      edge cache instead of the throttled development URL.
 *   3. A cover saved from an archive.org storage host becomes its Cover Art Archive
 *      address (BUG-439, BUG-566). The resizer refuses those hosts, and the file
 *      moves between them, so 342 covers stored that way were blank.
 * Stored URLs are never rewritten; this happens at read time, in one place.
 * Idempotent; relative URLs pass through.
 */
export function mediaUrl(url: string): string {
  const https = url.startsWith("http://") ? "https://" + url.slice("http://".length) : url;
  if (https.startsWith(R2_DEV_MEDIA)) return MEDIA_HOST + https.slice(R2_DEV_MEDIA.length);
  return caaAddressForArchiveCopy(https) ?? https;
}

/**
 * Cloudflare image resizing is DORMANT by default. It is active only when the
 * host is set AND explicitly enabled via NEXT_PUBLIC_CF_IMAGE_ENABLED==='true'.
 *
 * Why off-by-default (BUG-022): with CF on, every <Image> is rendered
 * `unoptimized` and getImageUrl() passes external hosts (coverartarchive.org)
 * through UNCHANGED — so the ~68% of catalog covers still on CAA would lose the
 * Next optimizer's resize + 30-day edge cache and load WORSE than today. Keep
 * this false until the CAA→R2 migration (BUG-021) completes and getImageUrl
 * routes every origin through the resizer.
 *
 * Requiring an explicit flag (not just the host) means a lingering
 * NEXT_PUBLIC_CF_IMAGE_HOST in a developer's .env.local no longer flips the
 * pipeline: local and production render through the same path by construction.
 *
 * This is the single source of truth for the CF decision — components import it
 * for the `unoptimized` prop rather than re-reading the env var, so the gate
 * cannot drift per call site.
 */
export const CF_IMAGE_ENABLED =
  !!CF_IMAGE_HOST && process.env.NEXT_PUBLIC_CF_IMAGE_ENABLED === "true";

/**
 * Our own pre-made cover sizes: covers/{mbid}/grid.webp (~800px) and high.webp (~1200px), written by
 * scripts/generate-grid-thumbs.ts. They are already sized and compressed, and Cloudflare caches them
 * at the edge for a year, so sending them through Vercel's optimizer again only adds a billed resize.
 */
export function isPremadeCover(url: string): boolean {
  const src = mediaUrl(url);
  return src.startsWith(`${MEDIA_HOST}covers/`) && /\/(grid|high)\.webp(\?.*)?$/.test(src);
}

// A Cover Art Archive original: release/<mbid>/<image id or "front">.<ext>, or a release group's front.
const CAA_ORIGINAL =
  /^(https:\/\/coverartarchive\.org\/(?:release|release-group)\/[0-9a-f-]{36}\/)(front|\d+)(?:\.(?:jpe?g|png|gif|webp))?$/i;

/**
 * A cover small enough for a thumbnail, for callers that hand out a raw URL to a client that draws it
 * as is (the phone's Search rows draw /api/search's covers at 48pt). mediaUrl() first, then a Cover Art
 * Archive original becomes the 500px JPEG the archive keeps beside it: originals run to 3000px and 7 MB
 * or more. Pass our own small tier first when there is one; any other URL is left as mediaUrl() makes it.
 */
export function smallCoverUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const src = mediaUrl(url);
  const m = CAA_ORIGINAL.exec(src);
  return m ? `${m[1]}${m[2]!.toLowerCase()}-500.jpg` : src;
}

/**
 * The `unoptimized` prop for a cover or photo <Image>: true when Vercel's optimizer should not touch
 * it, either because Cloudflare resizes instead or because it is one of our pre-made sizes. Every
 * other source (Cover Art Archive, uploads, originals) still goes through the optimizer.
 */
export function skipsResizer(url: string): boolean {
  return CF_IMAGE_ENABLED || isPremadeCover(url);
}

/**
 * Returns a CF Image Resizing URL for an album cover.
 * Defaults to 400×400 contain at quality 82.
 * Falls back to the raw source URL if CF is not configured.
 */
export function coverUrl(
  sourceUrl: string | null | undefined,
  options: { width?: number; height?: number; quality?: number } = {}
): string | null {
  if (!sourceUrl) return null;
  const src = mediaUrl(sourceUrl);
  if (!CF_IMAGE_ENABLED) return src;

  return getImageUrl(src, CF_IMAGE_HOST, {
    width: options.width ?? 400,
    height: options.height ?? 400,
    quality: options.quality ?? 82,
    fit: "contain",
    format: "auto",
  });
}

/**
 * Returns a CF Image Resizing URL for an artist photo.
 * Defaults to 300×300 cover-crop at quality 82.
 * Falls back to the raw source URL if CF is not configured.
 */
export function artistImageUrl(
  sourceUrl: string | null | undefined,
  options: { width?: number; height?: number } = {}
): string | null {
  if (!sourceUrl) return null;
  const src = mediaUrl(sourceUrl);
  if (!CF_IMAGE_ENABLED) return src;

  return getImageUrl(src, CF_IMAGE_HOST, {
    width: options.width ?? 300,
    height: options.height ?? 300,
    quality: 82,
    fit: "cover",
    format: "auto",
  });
}
