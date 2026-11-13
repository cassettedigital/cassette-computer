/**
 * Colour for the cover families. Colours are written as OKLCH triples [L, C, H] so the
 * palette maths (mixing, hue runs) happens in a perceptual space, then every colour is
 * converted to plain sRGB here before it reaches a canvas. Canvas engines disagree on
 * oklch() strings (the server's draws them black), so nothing else may emit one.
 */
import type { Rand } from "./rng";

export type Col = number[];
export type Palette = { bg: Col; c1: Col; c2: Col; c3: Col; ink: Col };
/** The three "Cover colors" settings: fixed riso ink pairs, the app colour plus its opposite, or the app colour alone. */
export type ColorMode = "ink" | "match" | "one";

export const TAU = Math.PI * 2;
export const WHITE: Col = [0.97, 0.01, 90];
export const CREAM: Col = [0.93, 0.03, 85];

export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Blend two colours, taking the short way round the hue wheel. */
export function mix(a: Col, b: Col, t: number): Col {
  const dh = ((((b[2] - a[2]) % 360) + 540) % 360) - 180;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + dh * t];
}

const toSrgb = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
const cache = new Map<string, string>();

/** An OKLCH triple as an rgba() string, clipped to the sRGB gamut. */
export function C(t: Col, a = 1): string {
  const key = `${t[0]}|${t[1]}|${t[2]}|${a}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const h = (t[2] * Math.PI) / 180, A = t[1] * Math.cos(h), B = t[1] * Math.sin(h);
  const l = (t[0] + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (t[0] - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (t[0] - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.round(clamp(toSrgb(clamp(v, 0, 1)), 0, 1) * 255));
  const out = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.round(clamp(a, 0, 1) * 1000) / 1000})`;
  if (cache.size > 4000) cache.clear();
  cache.set(key, out);
  return out;
}

// Riso ink approximations: [L, C, H]
const INK: Record<string, Col> = {
  pink: [0.68, 0.25, 350], blue: [0.55, 0.15, 245], yellow: [0.91, 0.19, 103], teal: [0.6, 0.11, 200],
  orange: [0.69, 0.2, 40], federal: [0.5, 0.12, 265], green: [0.65, 0.16, 155], purple: [0.56, 0.15, 300],
  red: [0.7, 0.19, 25], mint: [0.85, 0.09, 190],
};
const RISO: [string, string][] = [["pink", "blue"], ["yellow", "teal"], ["orange", "federal"], ["green", "pink"], ["yellow", "purple"], ["red", "mint"], ["mint", "orange"]];

/** A cover's palette. `H` is the app colour's hue (only used by "match" and "one"); ink mode ignores it. */
export function palette(H: number, mode: ColorMode, r: Rand): Palette {
  if (mode === "one") return { bg: [0.2, 0.015, H], c1: [0.68, 0.17, H], c2: [0.46, 0.12, H], c3: [0.86, 0.07, H], ink: [0.18, 0.02, H] };
  if (mode === "match") {
    const s = r() < 0.5 ? 165 : 195;
    return { bg: [0.2, 0.02, H], c1: [0.7, 0.17, H], c2: [0.74, 0.13, H + s], c3: [0.9, 0.05, H + 25], ink: [0.18, 0.03, H] };
  }
  const [a, b] = RISO[Math.floor(r() * RISO.length)].map((k) => INK[k]);
  return { bg: [0.2, 0.04, b[2]], c1: a, c2: b, c3: [0.92, 0.07, a[2]], ink: [0.18, 0.03, b[2]] };
}

/** A run of colour from one ink to the other the long way round the wheel, so it passes through the whole rainbow; shades of the accent in one-colour mode. */
export function rainbow(p: Palette, t: number): Col {
  const h1 = p.c1[2], h2 = p.c2[2];
  if (Math.abs(((((h2 - h1) % 360) + 540) % 360) - 180) < 1) return [0.86 - t * 0.38, 0.15, h1];
  let d = (((h2 - h1) % 360) + 360) % 360;
  if (d < 180) d -= 360;
  return [0.8 - 0.06 * Math.sin(t * Math.PI), 0.17, h1 + d * t];
}

/** The same run from the cool ink to the warm one, with a near-white core, like light through a prism. */
export function spectral(p: Palette, t: number): Col {
  const c = rainbow(p, 1 - t), core = Math.exp(-(((t - 0.45) / 0.12) ** 2));
  return [c[0] * (1 - core) + 0.96 * core, c[1] * (1 - core * 0.85), c[2]];
}
