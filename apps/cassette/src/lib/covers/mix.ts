/**
 * Addresses of the made-for-you mix covers (/api/covers/mix/:key, lib/cover-art/mixes).
 *
 * The web asks for the versioned address: its `v` is the cover's key, which changes exactly
 * when the picture does, so it can be cached for good. The phone builds its own address
 * without `v` and keeps its own copy (see the route).
 */
import { siteUrl } from "@/lib/urls";
import type { MixCoverSpec } from "@/lib/cover-art/mixes/catalog";

export function mixCoverUrl(spec: MixCoverSpec, opts: { absolute?: boolean; size?: number } = {}): string {
  const q = new URLSearchParams({ variant: spec.version });
  q.set("v", spec.cacheKey);
  q.set("s", String(opts.size ?? 600));
  const path = `/api/covers/mix/${spec.key}?${q.toString()}`;
  return opts.absolute ? siteUrl(path) : path;
}
