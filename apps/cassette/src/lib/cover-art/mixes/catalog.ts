/**
 * The made-for-you mix covers as data: every version each mix has, and how a mix picks one.
 * No drawing here (that is ./index.ts), so a web page can import this without the art.
 *
 * Most mixes take their versions in turn, one a day by the listener's own calendar, so a day
 * shows the same cover everywhere. Get Pumped looks at its own songs instead: mostly rock,
 * metal or punk gets the chrome, anything else the aerobics. The phone makes the same picks
 * (HomeManager in the iOS app), so these rules exist once on each side and must stay in step
 * with it.
 */
import { hash } from "../rng";

/** Bump to redraw every mix cover: the versioned addresses change, so caches take the new picture. */
export const MIX_ART_VERSION = 1;

export type MixKey = "get-pumped" | "focus" | "wind-down" | "late-night" | "feel-good" | "road-trip" | "sweater-weather" | "sunset" | "slow-start" | "tidy-up" | "home-sweet-home";

/** One version of a mix's cover: its design version, its motion loop in seconds, and the frame its still is taken at. */
export type MixVersion = { v: number; loop: number; still: number };
export type MixCover = {
  /** "daily": the versions in turn, a day each. "heaviness": Get Pumped, by its songs. */
  pick: "daily" | "heaviness";
  /** In the order the daily pick runs through them. */
  versions: Record<string, MixVersion>;
};

export const MIX_COVERS: Record<MixKey, MixCover> = {
  "get-pumped": { pick: "heaviness", versions: { chrome: { v: 1, loop: 16, still: 0 }, aerobics: { v: 1, loop: 20, still: 0 } } },
  focus: { pick: "daily", versions: { head: { v: 1, loop: 24, still: 0 }, script: { v: 1, loop: 20, still: 0 } } },
  "wind-down": { pick: "daily", versions: { window: { v: 1, loop: 30, still: 0 } } },
  "late-night": { pick: "daily", versions: { show: { v: 2, loop: 24, still: 0 }, broadcast: { v: 2, loop: 24, still: 0 } } },
  "feel-good": { pick: "daily", versions: { memphis: { v: 1, loop: 16, still: 0.12 }, smear: { v: 1, loop: 20, still: 0 } } },
  "road-trip": { pick: "daily", versions: { "red-rock": { v: 1, loop: 40, still: 0 }, "teal-sky": { v: 1, loop: 40, still: 0 }, cloud: { v: 1, loop: 30, still: 0 } } },
  "sweater-weather": { pick: "daily", versions: { knit: { v: 1, loop: 24, still: 0 } } },
  "slow-start": { pick: "daily", versions: { conditions: { v: 1, loop: 24, still: 0.6 } } },
  "tidy-up": { pick: "daily", versions: { printad: { v: 1, loop: 24, still: 0 }, checker: { v: 1, loop: 24, still: 0 }, twotone: { v: 1, loop: 24, still: 0 }, toned: { v: 1, loop: 24, still: 0 } } },
  sunset: { pick: "daily", versions: { streak: { v: 1, loop: 24, still: 0 } } },
  "home-sweet-home": { pick: "daily", versions: { sampler: { v: 1, loop: 24, still: 0.3 } } },
};

export function isMixKey(key: string): key is MixKey {
  return Object.prototype.hasOwnProperty.call(MIX_COVERS, key);
}

/** Days since 1970 on the listener's own calendar, ticking over at their local midnight. */
export function localDay(now: Date): number {
  return Math.floor((now.getTime() - now.getTimezoneOffset() * 60000) / 86400000);
}

/** The version a daily mix shows on `now`'s day. */
export function dailyVersion(key: MixKey, now: Date): string {
  const names = Object.keys(MIX_COVERS[key].versions);
  return names[((localDay(now) % names.length) + names.length) % names.length];
}

const HEAVY = ["metal", "punk", "hardcore", "deathcore", "grunge", "screamo", "thrash", "doom", "sludge", "stoner", "hard rock", "garage rock", "noise rock"];
const HEAVY_MOODS = new Set(["aggressive", "intense", "rebellious"]);

/** A subgenre on the rock, metal or punk side. */
export function isHeavySubgenre(subgenre: string): boolean {
  const s = subgenre.toLowerCase();
  return HEAVY.some((h) => s.includes(h)) || s.split(/[\s-]+/).includes("emo");
}

/** Whether a song is heavy: by its subgenres, else by its moods; null when it carries neither. */
export function songHeaviness(subgenres?: Iterable<string> | null, moods?: Iterable<string> | null): boolean | null {
  const subs = [...(subgenres ?? [])];
  if (subs.length) return subs.some(isHeavySubgenre);
  const feel = [...(moods ?? [])];
  if (feel.length) return feel.some((m) => HEAVY_MOODS.has(m.toLowerCase()));
  return null;
}

/** Get Pumped's cover from its songs: chrome when at least 40% of the songs that say anything are heavy (or none say anything). */
export function getPumpedVersion(songs: { subgenres?: Iterable<string> | null; moods?: Iterable<string> | null }[]): "chrome" | "aerobics" {
  let heavy = 0, counted = 0;
  for (const song of songs) {
    const h = songHeaviness(song.subgenres, song.moods);
    if (h === null) continue;
    counted++;
    if (h) heavy++;
  }
  return counted === 0 || heavy / counted >= 0.4 ? "chrome" : "aerobics";
}

export type MixCoverSpec = {
  key: MixKey;
  version: string;
  /** Changes exactly when the picture does, so the cover's address can be cached for good. */
  cacheKey: string;
};

/** A mix cover, checked: null for an unknown mix or version. */
export function mixCoverSpec(key: string, version: string): MixCoverSpec | null {
  if (!isMixKey(key)) return null;
  const ver = MIX_COVERS[key].versions[version];
  if (!ver) return null;
  const cacheKey = hash([MIX_ART_VERSION, key, version, ver.v].join("|")).toString(36);
  return { key, version, cacheKey };
}

/** The version's loop and still frame. */
export function mixVersionOf(spec: MixCoverSpec): MixVersion {
  return MIX_COVERS[spec.key].versions[spec.version];
}
