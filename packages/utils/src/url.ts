/** Extract the hostname from a URL. Returns null if the URL is invalid. */
export function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Normalize a URL for deduplication.
 * Strips tracking params (utm_*, ref, fbclid, gclid, etc.),
 * removes trailing slashes, and lowercases the hostname.
 */
export function normalizeUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl.trim());

    const stripParams = [
      "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
      "ref", "mc_cid", "mc_eid", "fbclid", "gclid",
    ];
    for (const param of stripParams) {
      url.searchParams.delete(param);
    }

    let normalized = url.toString();
    if (normalized.endsWith("/")) {
      normalized = normalized.slice(0, -1);
    }

    const parsed = new URL(normalized);
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString();
  } catch {
    return null;
  }
}
