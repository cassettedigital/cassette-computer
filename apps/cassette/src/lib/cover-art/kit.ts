/**
 * Drawing helpers for the cover families. The pure ones only need a context; the
 * ones that need scratch canvases, text masks or the grain tile come from makeKit(),
 * which binds them to a canvas factory: the DOM in the browser, @napi-rs/canvas on
 * the server. That factory is the only thing that differs between the two.
 */
import type { Col, Palette } from "./color";
import { C, TAU, WHITE, clamp, mix } from "./color";
import { F } from "./fonts";
import { rng } from "./rng";
import type { Rand } from "./rng";

export type Ctx = CanvasRenderingContext2D;
export type Canvas = HTMLCanvasElement;
export type CoverEnv = {
  createCanvas: (w: number, h: number) => Canvas;
  createPath: () => Path2D;
};
export type DrawOpts = { titles: boolean };
/** One family's drawing: `ph` is the position in its motion loop, 0 to 1; frame 0 and frame 1 match. */
export type FamilyDraw = (ctx: Ctx, S: number, p: Palette, name: string, r: Rand, ph: number, o: DrawOpts, k: Kit) => void;

/** The size the families were designed at; grain and hairlines scale from it. */
export const DESIGN_SIZE = 312;
/** Seconds per motion loop when a family does not set its own. */
export const LOOP = 12;

export function fill(ctx: Ctx, S: number, c: Col) {
  ctx.fillStyle = C(c);
  ctx.fillRect(0, 0, S, S);
}

export function disc(ctx: Ctx, x: number, y: number, rad: number) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, rad), 0, TAU);
  ctx.fill();
}

export function fitSize(ctx: Ctx, text: string, face: string, weight: string | number, width: number, max: number): number {
  ctx.font = `${weight} 100px ${face}`;
  return Math.min(max, (width * 100) / Math.max(1, ctx.measureText(text).width));
}

/** One line, or two balanced lines once a name gets long. */
export function twoLines(text: string, maxChars: number): string[] {
  const w = text.split(/\s+/).filter(Boolean);
  if (text.length <= maxChars || w.length < 2) return [text];
  let best: { m: number; l: string[] } | null = null;
  for (let k = 1; k < w.length; k++) {
    const a = w.slice(0, k).join(" "), b = w.slice(k).join(" "), m = Math.max(a.length, b.length);
    if (!best || m < best.m) best = { m, l: [a, b] };
  }
  return best ? best.l : [text];
}

export type NameLines = { size: number; lines: string[]; face: string; weight: string | number };

/** Break a name into the lines that set it biggest inside a box, then size it. */
export function nameLines(ctx: Ctx, text: string, W: number, H: number, face: string, weight: string | number): NameLines {
  const words = text.split(/\s+/).filter(Boolean), n = words.length;
  ctx.font = `${weight} 100px ${face}`;
  let best = { size: 0, lines: [text] };
  for (let mask = 0; mask < (n <= 6 ? 1 << Math.max(0, n - 1) : 1); mask++) {
    const lines: string[] = [];
    let cur = [words[0] ?? text];
    for (let k = 1; k < n; k++) {
      if (mask & (1 << (k - 1))) { lines.push(cur.join(" ")); cur = [words[k]]; } else cur.push(words[k]);
    }
    lines.push(cur.join(" "));
    const size = Math.min((W * 100) / Math.max(...lines.map((l) => ctx.measureText(l).width), 1), H / (lines.length * 0.86));
    if (size > best.size) best = { size, lines };
  }
  return { ...best, face, weight };
}

/** Text with even letter spacing, drawn a character at a time so every canvas engine spaces it alike. */
export function spacedText(ctx: Ctx, text: string, x: number, y: number, spacing: number, align: "left" | "center" | "right" = "left") {
  const chars = [...text], widths = chars.map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((s, v) => s + v, 0) + spacing * Math.max(0, chars.length - 1);
  let cx = align === "left" ? x : align === "center" ? x - total / 2 : x - total;
  const prev = ctx.textAlign;
  ctx.textAlign = "left";
  chars.forEach((ch, i) => { ctx.fillText(ch, cx, y); cx += widths[i] + spacing; });
  ctx.textAlign = prev;
}

/** A four-point star with concave sides. */
export function sparkle(ctx: Ctx, x: number, y: number, rad: number, rot = 0) {
  const k = rad * 0.14;
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.beginPath(); ctx.moveTo(0, -rad);
  ctx.quadraticCurveTo(k, -k, rad, 0); ctx.quadraticCurveTo(k, k, 0, rad); ctx.quadraticCurveTo(-k, k, -rad, 0); ctx.quadraticCurveTo(-k, -k, 0, -rad);
  ctx.fill(); ctx.restore();
}

/** A thin cross of light, like a lens catching a star. */
export function glint(ctx: Ctx, x: number, y: number, len: number, col: Col, a = 1) {
  if (len < 0.5) return;
  const t = Math.max(1, len * 0.06);
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    const g = ctx.createLinearGradient(x - dx * len, y - dy * len, x + dx * len, y + dy * len);
    g.addColorStop(0, C(col, 0)); g.addColorStop(0.5, C(col, a)); g.addColorStop(1, C(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(dx ? x - len : x - t / 2, dy ? y - len : y - t / 2, dx ? 2 * len : t, dy ? 2 * len : t);
  }
  ctx.fillStyle = C(col, a);
  disc(ctx, x, y, Math.max(1, len * 0.08));
}

export function star5(ctx: Ctx, x: number, y: number, rad: number, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot - Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? rad * 0.45 : rad;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath(); ctx.fill();
}

/** The 8 × 8 ordered-dither matrix. */
export const BAYER: number[][] = (() => {
  let m = [[0]];
  for (let n = 1; n < 8; n *= 2) {
    m = [...m.map((row) => [...row.map((v) => 4 * v), ...row.map((v) => 4 * v + 2)]), ...m.map((row) => [...row.map((v) => 4 * v + 3), ...row.map((v) => 4 * v + 1)])];
  }
  return m;
})();

export function makeKit(env: CoverEnv) {
  const scratch = new Map<string, Canvas>();
  const sized = (key: string, w: number, h = w): Canvas => {
    let c = scratch.get(key);
    if (!c) { c = env.createCanvas(w, h); scratch.set(key, c); }
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return c;
  };
  const ctxOf = (c: Canvas, read = false): Ctx => c.getContext("2d", read ? { willReadFrequently: true } : undefined) as Ctx;
  let turn = 0;
  let tile: Canvas | null = null;
  // seeded noise, so a cover's grain is the same every time it is drawn
  const grainTile = (): Canvas => {
    if (tile) return tile;
    tile = env.createCanvas(256, 256);
    const x = ctxOf(tile), d = x.createImageData(256, 256), r = rng(7);
    for (let i = 0; i < d.data.length; i += 4) { const v = r() * 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    x.putImageData(d, 0, 0);
    return tile;
  };

  const kit = {
    path: (): Path2D => env.createPath(),
    /** One of six rotating scratch canvases the size of the cover. */
    buffer: (S: number): Canvas => sized(`buffer${turn++ % 6}`, S),
    /** A named scratch canvas, kept between draws. */
    scratch: sized,
    ctxOf,
    /** Film grain laid over everything; `live` flickers it frame to frame. */
    grain(ctx: Ctx, S: number, amt: number, live = 0) {
      const pat = ctx.createPattern(grainTile(), "repeat");
      if (!pat) return;
      const g = S / DESIGN_SIZE;
      let ox = 0, oy = 0;
      if (live) { const f = Math.floor(live * LOOP * 12); ox = (f * 73) % 256; oy = (f * 151) % 256; }
      ctx.save(); ctx.globalAlpha = amt; ctx.globalCompositeOperation = "overlay";
      ctx.scale(g, g); ctx.translate(ox, oy); ctx.fillStyle = pat; ctx.fillRect(-ox, -oy, S / g, S / g);
      ctx.restore();
    },
    /** The name set in a scratch canvas, for families that draw it more than once. */
    textLayer(S: number, { size, lines, face, weight }: NameLines, fillStyle: string): Canvas {
      const c = kit.buffer(S), x = ctxOf(c);
      x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = "source-over"; x.clearRect(0, 0, S, S);
      x.font = `${weight} ${size}px ${face}`; x.textAlign = "center"; x.textBaseline = "middle"; x.fillStyle = fillStyle;
      lines.forEach((l, i) => x.fillText(l, S / 2, S / 2 + (i - (lines.length - 1) / 2) * size * 0.86 + size * 0.04));
      return c;
    },
    /** The name as a coverage map, for families that build letters out of their own marks: (u, v) → 0..1. */
    textMask(name: string, res: number, face: string, weight: string | number, W: number, H: number): (u: number, v: number) => number {
      const c = sized("mask", res), m = ctxOf(c, true);
      m.setTransform(1, 0, 0, 1, 0, 0); m.clearRect(0, 0, res, res);
      const best = nameLines(m, name.toUpperCase(), W * res, H * res, face, weight);
      m.font = `${weight} ${best.size}px ${face}`; m.textAlign = "center"; m.textBaseline = "middle"; m.fillStyle = "#fff";
      best.lines.forEach((l, i) => m.fillText(l, res / 2, res / 2 + (i - (best.lines.length - 1) / 2) * best.size * 0.86));
      const d = m.getImageData(0, 0, res, res).data;
      return (u, v) => d[(clamp(Math.floor(v * res), 0, res - 1) * res + clamp(Math.floor(u * res), 0, res - 1)) * 4 + 3] / 255;
    },
    /** The name in an 8-pixel bitmap face, for dot-matrix readouts. */
    ledText(text: string): { w: number; on: (x: number, y: number) => boolean } {
      const probe = ctxOf(sized("led-probe", 8), true);
      probe.font = '8px "Press Start 2P"';
      const w = Math.max(8, Math.ceil(probe.measureText(text).width));
      const c = sized("led", w, 8), x = ctxOf(c, true);
      x.clearRect(0, 0, w, 8); x.font = '8px "Press Start 2P"'; x.textBaseline = "top"; x.fillStyle = "#fff"; x.fillText(text, 0, 0);
      const d = x.getImageData(0, 0, w, 8).data;
      return { w, on: (px, py) => d[(py * w + px) * 4 + 3] > 110 };
    },
    /**
     * Chrome lettering for the VHS sleeve: a bright face with a dark horizon through it, outlined and
     * extruded in near-black so it holds up on any background, with a gleam rolling across the face once per loop.
     */
    chrome(ctx: Ctx, S: number, p: Palette, text: string, x: number, y: number, size: number, ph: number, font = (s: number) => `italic 900 ${s}px ${F.vhs}`) {
      const buf = kit.buffer(S), b = ctxOf(buf);
      b.setTransform(1, 0, 0, 1, 0, 0); b.globalCompositeOperation = "source-over"; b.clearRect(0, 0, S, S);
      b.save(); b.translate(x, y); b.font = font(size); b.textAlign = "center"; b.lineJoin = "round";
      const tg = b.createLinearGradient(0, -size * 0.74, 0, 0);
      tg.addColorStop(0, C(WHITE)); tg.addColorStop(0.3, C(mix(p.c2, WHITE, 0.62))); tg.addColorStop(0.48, C(mix(p.c2, WHITE, 0.3)));
      tg.addColorStop(0.5, C([0.2, 0.04, p.c2[2]])); tg.addColorStop(0.54, C(mix(p.c1, WHITE, 0.25))); tg.addColorStop(0.8, C(mix(p.c1, WHITE, 0.6))); tg.addColorStop(1, C(WHITE));
      b.fillStyle = tg; b.fillText(text, 0, 0);
      b.globalCompositeOperation = "source-atop";
      const sx = (-1 + 2.6 * ph) * S * 0.6, sg = b.createLinearGradient(sx - S * 0.07, 0, sx + S * 0.07, 0);
      sg.addColorStop(0, "rgba(255, 255, 255, 0)"); sg.addColorStop(0.5, "rgba(255, 255, 255, 0.75)"); sg.addColorStop(1, "rgba(255, 255, 255, 0)");
      b.fillStyle = sg; b.fillRect(-S, -S, S * 2, S * 2);
      b.globalCompositeOperation = "destination-over";
      const dark = C([0.12, 0.03, p.c2[2]]), d = Math.max(1, size * 0.022);
      b.strokeStyle = dark; b.fillStyle = dark; b.lineWidth = Math.max(2, size * 0.09);
      for (let k = 0; k <= 4; k++) { b.strokeText(text, k * d, k * d); b.fillText(text, k * d, k * d); }
      b.restore();
      ctx.save(); ctx.shadowColor = C(p.c1, 0.5); ctx.shadowBlur = S * 0.03; ctx.drawImage(buf, 0, 0); ctx.restore();
    },
  };
  return kit;
}

export type Kit = ReturnType<typeof makeKit>;
