"use client";

/**
 * A record's colour, one path for every page (F3): read off its cover in the browser, then brightened
 * once to read as an accent on the dark paper (accentOf: OK Computer is #79b4d8 wherever it shows), plus
 * one text-safe version of it, lifted until it reads at 4.5:1 on the paper (inkOf), for anything set in
 * the record's colour. A page sets the two as --accent-c and --accent-ink. On a page whose paper follows
 * the device (light or dark), accentVars writes both in a version for each paper: the light card stock
 * takes the same hue deepened, since a colour brightened for the dark reads washed out on cream.
 *
 * Covers are read at the image ladder's smallest size, which the edge lets any page read the pixels of
 * (docs/reference/CASSETTE_IMAGES.md), and cached per cover. A grey cover (saturation under 0.12), an unreadable one or none has no colour to give, so it
 * takes the paper's brass.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { IMAGE_RUNGS } from "@discovery/cassette-kit/images";
import { mediaUrl } from "@/lib/image-url";
import { ladderSrc } from "@/lib/images/picture";

/** The paper's own light, used when the record gives no colour. */
export const BRASS = "#c9a25a";
/** Cassette's flat stock, the lighter of the two dark stocks, for contrast checks. */
const OWN = "#1c1914";
/** The light card stock, the darker of the two light stocks, for contrast checks on the light paper. */
const CREAM = "#f3eadb";
/** What coverColor resolves to when it cannot read a cover: counts as no colour. */
export const READ_FAILED = "#b53f27";

const cache = new Map<string, Promise<string>>();

/** A cover at the ladder's size that holds `w` pixels (the original when the ladder cannot serve it). */
export const coverAt = (url: string, w = 120) => ladderSrc(url, IMAGE_RUNGS.find((r) => r >= w) ?? 1200) ?? mediaUrl(url);

/**
 * One usable colour out of a cover, pushed toward a poster palette: vivid enough to read as a stripe,
 * dark enough to hold up on cream. READ_FAILED for no cover or any error.
 */
export function coverColor(url: string | null | undefined): Promise<string> {
  if (!url) return Promise.resolve(READ_FAILED);
  let p = cache.get(url);
  if (!p) {
    p = extract(url).catch(() => READ_FAILED);
    cache.set(url, p);
  }
  return p;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const hexToHsl = (hex: string) => rgbToHsl(...hexToRgb(hex));
const isHex = (hex: string | null | undefined): hex is string => !!hex && /^#[0-9a-f]{6}$/i.test(hex);

/** HSL saturation of a "#rrggbb" colour, 0..1. */
export function saturation(hex: string): number {
  if (!isHex(hex)) return 0;
  return hexToHsl(hex)[1];
}

/** The same hue, lifted to read as an accent on a near-black page. */
export function brighten(hex: string, l = 0.66): string {
  const [h, s, l0] = hexToHsl(hex);
  return hslToHex(h, s < 0.1 ? s : Math.max(s, 0.5), Math.max(l0, l));
}

/** The same hue, deepened to sit behind cream text. */
export function deepen(hex: string, l = 0.2): string {
  const [h, s] = hexToHsl(hex);
  return hslToHex(h, Math.min(1, s * 0.8 + 0.05), l);
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The record's accent: the cover's colour brightened for the dark paper; the brass when it has none. */
export function accentOf(hex: string | null | undefined): string {
  if (!isHex(hex) || hex.toLowerCase() === READ_FAILED || saturation(hex) < 0.12) return BRASS;
  return brighten(hex);
}

/** The accent made safe for type: lifted until it reads at 4.5:1 or better on the lighter of the two dark stocks. */
export function inkOf(accent: string): string {
  if (!isHex(accent)) return BRASS;
  const [h, s, l0] = hexToHsl(accent);
  let l = l0;
  let out = accent;
  for (let i = 0; i < 60 && contrast(out, OWN) < 4.5; i++) {
    l = Math.min(1, l + 0.015);
    out = hslToHex(h, s, l);
  }
  return out;
}

/** The accent on the light card stock: the same hue, deepened until it reads at `min` on it (3:1 for a
 *  stripe or a bar, 4.5:1 for type). */
function onCream(accent: string, min: number): string {
  const [h, s, l0] = hexToHsl(accent);
  let l = l0;
  let out = accent;
  for (let i = 0; i < 60 && contrast(out, CREAM) < min; i++) {
    l = Math.max(0, l - 0.015);
    out = hslToHex(h, s, l);
  }
  return out;
}

/** A record's colour (an accentOf result) as a page sets it, --accent-c and --accent-ink, each in a
 *  version for both papers (light-dark(), read where a part uses it). */
export function accentVars(accent: string): CSSProperties {
  const a = isHex(accent) ? accent : BRASS;
  return {
    "--accent-c": `light-dark(${onCream(a, 3)}, ${a})`,
    "--accent-ink": `light-dark(${onCream(a, 4.5)}, ${inkOf(a)})`,
  } as CSSProperties;
}

/** A cover the canvas may read: across origins, which the ladder allows (a same-origin drawn cover needs nothing). */
async function readable(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = "async";
  img.crossOrigin = "anonymous";
  img.src = src;
  await img.decode();
  return img;
}

async function extract(url: string): Promise<string> {
  // the smallest size, else the original should the ladder not answer; a host that allows neither
  // takes the paper's brass
  const small = coverAt(url, 120);
  const img = await readable(small).catch((e) => (small === mediaUrl(url) ? Promise.reject(e) : readable(mediaUrl(url))));

  const size = 24;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return READ_FAILED;
  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  // The strongest hue family wins, weighted toward saturated mid-tones.
  const bins = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  const all = { w: 0, r: 0, g: 0, b: 0 };
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    all.w += 1;
    all.r += r;
    all.g += g;
    all.b += b;
    const [h, s, l] = rgbToHsl(r, g, b);
    if (s < 0.2 || l < 0.1 || l > 0.9) continue;
    const w = s * (1 - Math.abs(l - 0.5));
    const bin = bins[Math.floor(h * 12) % 12];
    bin.w += w;
    bin.r += r * w;
    bin.g += g * w;
    bin.b += b * w;
  }
  const best = bins.reduce((a, c) => (c.w > a.w ? c : a));
  const src = best.w > 8 ? best : all;
  const [h, s0, l0] = rgbToHsl(src.r / src.w, src.g / src.w, src.b / src.w);
  const s = s0 > 0.12 ? Math.max(s0, 0.55) : s0 * 0.5;
  const l = Math.min(0.55, Math.max(0.28, l0));
  return hslToHex(h, s, l);
}

/** One cover's accent (the album page). BRASS until the read lands. */
export function useCoverAccent(src: string | null | undefined): string {
  const [accent, setAccent] = useState(BRASS);
  useEffect(() => {
    if (!src) {
      setAccent(BRASS);
      return;
    }
    let live = true;
    void coverColor(src).then((c) => {
      if (!live) return;
      setAccent(accentOf(c));
    });
    return () => {
      live = false;
    };
  }, [src]);
  return accent;
}

/**
 * Many covers' accents, keyed (the artist page), read only for the `keys` asked for: the lead record at
 * once, then each record as a person points at it or opens it. Reading a colour costs one small resized
 * copy of the cover, so a long list never reads them all. Each is accentOf(c), the same colour the
 * record's own page shows: BRASS for grey or unreadable covers.
 */
export function useCoverColours(items: Array<{ key: string; src: string | null | undefined }>, keys: Array<string | null | undefined>): Record<string, string> {
  const [colours, setColours] = useState<Record<string, string>>({});
  const asked = useRef(new Set<string>());
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const want = useCallback((key: string | null | undefined) => {
    if (!key || asked.current.has(key)) return;
    const item = itemsRef.current.find((i) => i.key === key);
    if (!item) return;
    asked.current.add(key);
    if (!item.src) {
      setColours((m) => ({ ...m, [key]: BRASS }));
      return;
    }
    void coverColor(item.src).then((c) => setColours((m) => ({ ...m, [key]: accentOf(c) })));
  }, []);

  const list = keys.filter(Boolean).join("|");
  useEffect(() => {
    list.split("|").forEach((k) => want(k));
  }, [list, want]);

  return colours;
}
