/**
 * The cover-art kit in the browser, for covers drawn live (src/app/components/LiveCover.tsx).
 * Canvases come from the DOM, and the faces are Latin subsets of the server's cover fonts
 * (public/cover-fonts, made by scripts/cover-web-fonts.py) registered under the same family
 * names, so a cover draws here as it does on the server. Registering a face downloads
 * nothing; each face loads the first time a cover asks for it. Loaded on demand (a dynamic
 * import), since the families are most of the cover-art code.
 */
import FONTS from "../../../assets/cover-fonts/fonts.json";
import { drawCover } from "./draw";
import { makeKit, type CoverEnv, type Kit } from "./kit";
import type { CoverSpec } from "./spec";

export { drawCover };
export type { Kit };

/** Bump when scripts/cover-web-fonts.py's output changes: the files are cached for a year. */
const FONT_VERSION = 1;

const dom: CoverEnv = {
  createCanvas: (w, h) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    return c;
  },
  createPath: () => new Path2D(),
};

/** A kit of its own for each live cover, so two covers never resize each other's scratch canvases. */
export function createBrowserKit(): Kit {
  return makeKit(dom);
}

/** Whether the page already has this face, at this weight and style. */
function pageHas(family: string, weight: number, style: string): boolean {
  for (const f of document.fonts) {
    if (f.family.replace(/["']/g, "") !== family || f.style !== style) continue;
    const [lo, hi = lo] = f.weight.split(" ").map((w) => (w === "normal" ? 400 : w === "bold" ? 700 : Number(w)));
    if (weight >= lo && weight <= hi) return true;
  }
  return false;
}

/** The cover faces this page added, by family, weight and style. */
const added = new Map<string, FontFace>();
/**
 * Adds the cover faces to document.fonts, except any the page already has: the app loads
 * Barlow Condensed and DM Mono itself (next/font, under those very names), and a second face
 * with the same name, weight and style would take over the app's own text. A face that failed
 * to load (the server didn't answer) is added afresh, so the next cover that asks tries again.
 */
function registerFaces() {
  for (const f of FONTS as { file: string; family: string; weight: number; style: string }[]) {
    const key = `${f.family}|${f.weight}|${f.style}`;
    const had = added.get(key);
    if (had && had.status !== "error") continue;
    if (had) document.fonts.delete(had);
    else if (pageHas(f.family, f.weight, f.style)) continue;
    const url = `/cover-fonts/${f.file.replace(/\.ttf$/, ".woff")}?v=${FONT_VERSION}`;
    const face = new FontFace(f.family, `url(${url}) format("woff")`, { weight: String(f.weight), style: f.style });
    document.fonts.add(face);
    added.set(key, face);
  }
}

const FONT = typeof CanvasRenderingContext2D === "undefined" ? undefined : Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, "font");

/** A canvas whose 2d context notes every font it is set to. */
function watched(seen: Set<string>): CoverEnv {
  return {
    createCanvas: (w, h) => {
      const c = dom.createCanvas(w, h);
      const getContext = c.getContext.bind(c) as (type: string, opts?: unknown) => RenderingContext | null;
      c.getContext = ((type: string, opts?: unknown) => {
        const ctx = getContext(type, opts);
        if (ctx instanceof CanvasRenderingContext2D && FONT?.get && FONT.set && !Object.prototype.hasOwnProperty.call(ctx, "font")) {
          const { get, set } = FONT;
          Object.defineProperty(ctx, "font", {
            configurable: true,
            get() { return get.call(this); },
            set(v: string) { seen.add(v.replace(/[\d.]+px/, "16px")); set.call(this, v); },
          });
        }
        return ctx;
      }) as typeof c.getContext;
      return c;
    },
    createPath: dom.createPath,
  };
}

/** A cover's drawing, for finding the faces it sets: (context, size, loop position, kit). */
export type Drawing = (ctx: CanvasRenderingContext2D, S: number, ph: number, kit: Kit) => void;

/** Every font a drawing sets, found by drawing it small at a few points in its loop. */
export function fontsOf(draw: Drawing): string[] {
  const seen = new Set<string>();
  const env = watched(seen);
  const ctx = env.createCanvas(64, 64).getContext("2d") as CanvasRenderingContext2D;
  const kit = makeKit(env);
  for (const ph of [0, 0.25, 0.5, 0.75]) draw(ctx, 64, ph, kit);
  return [...seen];
}

/**
 * Loads the faces a drawing uses. Its own words go along (`text`), since the app's faces come
 * split by script and load per script. Throws when one of its cover faces failed to load: drawn
 * live, the cover would set its name in a stand-in face (the "Chillax" script turning into the
 * system's cursive on hover, 2026-10-22), so the caller keeps the still instead.
 */
export async function loadFontsFor(draw: Drawing, text: string): Promise<void> {
  registerFaces();
  const sample = `${text} ABC abc 0123`;
  const fonts = fontsOf(draw);
  await Promise.all(fonts.map((f) => document.fonts.load(f, sample).catch(() => [])));
  const missed = [...added.values()].filter((face) => face.status === "error" && fonts.some((f) => f.includes(face.family)));
  if (missed.length) throw new Error(`cover faces didn't load: ${missed.map((face) => face.family).join(", ")}`);
}

/** Every font a cover sets. */
export function coverFonts(spec: CoverSpec): string[] {
  return fontsOf((ctx, S, ph, kit) => drawCover(ctx, S, spec, ph, kit));
}

/** Loads the faces a cover draws with. */
export function loadCoverFonts(spec: CoverSpec): Promise<void> {
  return loadFontsFor((ctx, S, ph, kit) => drawCover(ctx, S, spec, ph, kit), spec.title);
}
