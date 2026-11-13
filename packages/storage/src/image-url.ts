/**
 * Cloudflare Image Resizing URL builder.
 *
 * Transforms an image URL through Cloudflare's cdn-cgi/image endpoint, which
 * resizes, converts format, and caches at the edge globally.
 *
 * Works for:
 *   - Images stored in your R2 bucket (pub-{hash}.r2.dev or custom CF domain)
 *   - Any URL served through your Cloudflare zone
 *
 * Falls back to the raw source URL when:
 *   - cfImageHost is not configured (local dev, unconfigured env)
 *   - The source URL is from an external host (Google Books, Open Library, etc.)
 *
 * Cost: $0.50 / 1,000 unique transformations/month (account-level, not per-zone).
 * Same image + same params = 1 billable transformation regardless of traffic.
 *
 * Setup:
 *   1. Add a custom domain to your R2 bucket in the Cloudflare dashboard
 *      (e.g. images.wonderlit.co → bucket wonderlit-media)
 *   2. Enable Cloudflare Images on the account (Speed tab in dashboard)
 *   3. Set NEXT_PUBLIC_CF_IMAGE_HOST=https://images.wonderlit.co in your env
 */

export interface ImageTransformOptions {
  /** Target width in pixels */
  width?: number;
  /** Target height in pixels */
  height?: number;
  /** Compression quality 1–100 (default: 82) */
  quality?: number;
  /**
   * How to fit the image into the requested dimensions.
   * - contain: scale down to fit, preserve aspect ratio, no crop (default)
   * - cover: fill the box, crop to fit
   * - scale-down: like contain but never upscales
   * - pad: contain + letterbox padding
   */
  fit?: "contain" | "cover" | "crop" | "pad" | "scale-down";
  /**
   * Output format. "auto" selects the best format the browser accepts
   * (AVIF > WebP > original). (default: "auto")
   */
  format?: "webp" | "avif" | "auto";
}

/**
 * Returns a Cloudflare Image Resizing URL for a source image.
 *
 * @param sourceUrl  - The original image URL (R2 or external)
 * @param cfImageHost - Your Cloudflare custom domain (NEXT_PUBLIC_CF_IMAGE_HOST)
 * @param options    - Resize/format options
 * @returns Transformed URL, or the raw sourceUrl if CF is not configured
 */
export function getImageUrl(
  sourceUrl: string | null | undefined,
  cfImageHost: string | null | undefined,
  options: ImageTransformOptions = {},
): string | null {
  if (!sourceUrl) return null;
  if (!cfImageHost) return sourceUrl;

  const cfHost = cfImageHost.replace(/\/$/, "");
  const params = buildTransformParams(options);

  // Already on our CF zone (custom domain) — extract path directly
  if (sourceUrl.startsWith(cfHost + "/")) {
    const path = sourceUrl.slice(cfHost.length + 1); // strip leading slash — params already ends with /
    return `${cfHost}/cdn-cgi/image/${params}${path}`;
  }

  // On our R2 bucket via the pub-{hash}.r2.dev URL — rewrite host to CF zone.
  // R2 public URLs always match https://pub-{hex32}.r2.dev/{key}.
  const r2Match = sourceUrl.match(/^https:\/\/pub-[0-9a-f]+\.r2\.dev(\/.+)$/);
  if (r2Match) {
    const path = r2Match[1].slice(1); // strip leading slash — params already ends with /
    return `${cfHost}/cdn-cgi/image/${params}${path}`;
  }

  // External URL (Google Books, Open Library, ISBNdb, etc.) — return unchanged.
  // These images are not on our CF zone and cannot be transformed.
  return sourceUrl;
}

function buildTransformParams(options: ImageTransformOptions): string {
  const parts: string[] = [];
  if (options.width) parts.push(`width=${options.width}`);
  if (options.height) parts.push(`height=${options.height}`);
  parts.push(`quality=${options.quality ?? 82}`);
  if (options.fit) parts.push(`fit=${options.fit}`);
  parts.push(`format=${options.format ?? "auto"}`);
  return parts.join(",") + "/";
}
