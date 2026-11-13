/**
 * Which picture of an album wins, in ONE place.
 *
 * The choice between the person's own folder cover (served by their hub), their pick (the override kept in
 * the cloud) and our catalog cover was written out three times: here, in the now-playing candidates
 * (playback-remote) and in the desktop window's cover list (desk/Art). They agreed, but three copies of
 * one rule is how a rule drifts (2026-11-08, the image lock-in). Every caller now asks this file.
 *
 * The rule (docs/reference/CASSETTE_IMAGES.md, the ownership model):
 *  - Library surfaces only pass `local`. Discovery surfaces never do, so they always show our catalog.
 *  - Desktop app (the hub on the same origin): the folder cover leads. It is an instant local read, works
 *    with no signal, and already holds any pick (a pick is written into the folder).
 *  - Website (no hub in reach): the person's pick leads, then the folder cover, then the catalog.
 *  - Then initials.
 */

import { SIDECAR_SAME_ORIGIN } from "@/lib/hub-origin";

export type AlbumCoverTier = "override" | "local" | "catalog" | "none";

/** The tiers in the order they are tried, best first. */
export function tierOrder(localFirst: boolean = SIDECAR_SAME_ORIGIN): Array<Exclude<AlbumCoverTier, "none">> {
  return localFirst ? ["local", "override", "catalog"] : ["override", "local", "catalog"];
}

export function pickAlbumCoverTier(
  available: {
    /** The user's chosen cover override is usable (present, no load error, online). */
    override: boolean;
    /** The local folder cover (sidecar proxy) is usable (present, no load error). */
    local: boolean;
    /** Our catalog cover is usable (present, no load error, online). */
    catalog: boolean;
  },
  localFirst: boolean = SIDECAR_SAME_ORIGIN,
): AlbumCoverTier {
  return tierOrder(localFirst).find((t) => available[t]) ?? "none";
}

type Some<T> = T | null | undefined | ReadonlyArray<T | null | undefined>;
const list = <T>(v: Some<T>): T[] =>
  (Array.isArray(v) ? v : [v]).filter((x): x is T => x != null && x !== "");

/**
 * Every source of a picture in the order to try them, best first, without repeats: for a renderer that
 * moves to the next one when a picture fails to load. Each tier may hold several addresses (a size, then
 * the original).
 */
export function coverOrder<T>(
  sources: { local?: Some<T>; override?: Some<T>; catalog?: Some<T> },
  localFirst: boolean = SIDECAR_SAME_ORIGIN,
): T[] {
  const out: T[] = [];
  for (const tier of tierOrder(localFirst)) {
    for (const s of list(sources[tier])) if (!out.includes(s)) out.push(s);
  }
  return out;
}
