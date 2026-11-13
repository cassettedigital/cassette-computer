/**
 * Which cover a playlist gets. Pure: no canvas, safe to import anywhere.
 *
 * A playlist's family and colours come from its id, so renaming it changes only the
 * title and never the art; its owner can choose another family in the cover picker
 * (`coverSpec`'s `chosen`). The key folds in everything that changes the picture (the
 * art and family versions, the colour setting, the title), so the cover's address
 * changes exactly when the picture does and caches can keep it forever. Bump a
 * family's `v` when its drawing changes; bump ART_VERSION when everything should redraw.
 */
import type { ColorMode } from "./color";
import { hash } from "./rng";

export const ART_VERSION = 1;

/**
 * Every family that ships, with its loop length in seconds, whether it can be drawn without a
 * name, and (`still`) the moment in its loop a still is taken when the first frame isn't its best.
 */
export const FAMILIES = {
  echo: { v: 1, loop: 16, untitled: false },
  discs: { v: 1, loop: 24, untitled: true },
  rays: { v: 1, loop: 24, untitled: true },
  spectrum: { v: 1, loop: 24, untitled: true },
  rings: { v: 1, loop: 20, untitled: false },
  arena: { v: 1, loop: 40, untitled: false },
  extrude: { v: 1, loop: 30, untitled: false },
  script: { v: 1, loop: 20, untitled: false },
  marble: { v: 1, loop: 40, untitled: false },
  eq: { v: 1, loop: 30, untitled: true },
  ribbon: { v: 1, loop: 20, untitled: false },
  sunflower: { v: 1, loop: 30, untitled: true },
  bauhaus: { v: 1, loop: 40, untitled: true },
  riso: { v: 1, loop: 16, untitled: true },
  ridge: { v: 1, loop: 16, untitled: true },
  bloom: { v: 1, loop: 30, untitled: true, still: 0.75 }, // the title at its sharpest
  topo: { v: 1, loop: 60, untitled: true },
  dither: { v: 1, loop: 40, untitled: false },
  scope: { v: 1, loop: 40, untitled: true },
  origami: { v: 1, loop: 24, untitled: true },
  lens: { v: 1, loop: 20, untitled: true },
  moire: { v: 1, loop: 40, untitled: true },
  signal: { v: 1, loop: 20, untitled: true },
  seigaiha: { v: 1, loop: 40, untitled: true },
  jcard: { v: 1, loop: 12, untitled: false },
  poster: { v: 1, loop: 12, untitled: false },
} as const;

export type FamilyId = keyof typeof FAMILIES;
export const FAMILY_IDS = Object.keys(FAMILIES) as FamilyId[];

/** Where in a family's loop its still is taken. */
export function stillPhase(family: FamilyId): number {
  const f = FAMILIES[family];
  return "still" in f ? f.still : 0;
}
const UNTITLED_IDS = FAMILY_IDS.filter((id) => FAMILIES[id].untitled);

/** The account's cover settings. `hue` is the app colour's accent hue; ink mode ignores it. */
export type CoverSettings = { colors: ColorMode; titles: boolean; hue: number };
/** Ink colours, names on: the defaults until the settings ship. 52 is the Classic orange. */
export const DEFAULT_COVER_SETTINGS: CoverSettings = { colors: "ink", titles: true, hue: 52 };

export type CoverSpec = {
  /** What the art is seeded from: the playlist id. */
  seed: string;
  family: FamilyId;
  mode: ColorMode;
  hue: number;
  titles: boolean;
  /** The name as the families will set it; empty when titles are off. */
  title: string;
  /** Changes exactly when the picture does. */
  key: string;
};

/**
 * The name as the cover fonts can set it: Latin letters (accents included), digits, spaces and
 * common punctuation. Emoji and other scripts are dropped, since the faces have no glyphs for them.
 */
export function artTitle(name: string): string {
  return (name ?? "")
    .normalize("NFC")
    .replace(/[^\p{Script=Latin}\p{Nd}\p{Zs}'’&!?.,:;()\-+#/]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

export function isFamilyId(id: string | null | undefined): id is FamilyId {
  return !!id && Object.prototype.hasOwnProperty.call(FAMILIES, id);
}

/** The families a cover can be drawn in: every one when it carries a name, else those that work without one. */
export function coverFamilies(titles: boolean): readonly FamilyId[] {
  return titles ? FAMILY_IDS : UNTITLED_IDS;
}

/** The family a playlist gets: from every family when names are on, else from those that work without one. */
export function pickFamily(seed: string, titles: boolean): FamilyId {
  const pool = coverFamilies(titles);
  return pool[hash(`family|${seed}`) % pool.length];
}

/**
 * `family` is one the owner chose in the cover picker. Without one (or with one that needs a
 * name this cover can't set) the playlist keeps the family its id gives it, so choosing that
 * same family changes nothing, key included.
 */
export function coverSpec(seed: string, name: string, settings: CoverSettings = DEFAULT_COVER_SETTINGS, chosen?: FamilyId | null): CoverSpec {
  const title = settings.titles ? artTitle(name) : "";
  // a name with nothing the fonts can set is drawn as if names were off
  const titles = settings.titles && title.length > 0;
  const family = chosen && coverFamilies(titles).includes(chosen) ? chosen : pickFamily(seed, titles);
  const mode = settings.colors;
  const hue = mode === "ink" ? 0 : Math.round(settings.hue);
  const key = hash([ART_VERSION, family, FAMILIES[family].v, seed, mode, hue, titles ? 1 : 0, title].join("|")).toString(36);
  return { seed, family, mode, hue, titles, title, key };
}
