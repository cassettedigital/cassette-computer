/**
 * Shared bits for the made-for-you mix covers: their drawing type, two motion helpers and the
 * tape finish several of them share. Colour, the canvas helpers and the fonts come from the
 * cover-art kit itself, so a mix cover draws on the server exactly as it does in the browser.
 */
import { C } from "../color";
import type { Ctx, Kit } from "../kit";
import { rng } from "../rng";

export type MixOpts = { titles: boolean };
/** One mix cover's drawing: `ph` is the position in its loop, 0 to 1; frame 0 and frame 1 match. */
export type MixDraw = (ctx: Ctx, S: number, ph: number, o: MixOpts, kit: Kit) => void;

/** Hold at 0, ease to 1, hold, ease back: the shape of a slow, deliberate change. */
export function holdPulse(ph: number, up: number, upEnd: number, down: number, downEnd: number, ease: (t: number) => number): number {
  if (ph < up) return 0;
  if (ph < upEnd) return ease((ph - up) / (upEnd - up));
  if (ph < down) return 1;
  if (ph < downEnd) return 1 - ease((ph - down) / (downEnd - down));
  return 0;
}

/** Wobble that loops with the cover: a sum of whole-number harmonics of the loop. */
export function loopNoise(ph: number, seed: number, harmonics = [3, 7, 13, 23]): number {
  let v = 0, w = 0;
  harmonics.forEach((k, i) => {
    const a = 1 / Math.sqrt(k);
    v += a * Math.sin(Math.PI * 2 * k * ph + seed * (i + 1) * 1.7);
    w += a;
  });
  return v / w;
}

/** Scanlines and grain: the tape this was recorded on. */
export function tape(ctx: Ctx, S: number, kit: Kit, a = 0.22) {
  ctx.fillStyle = C([0.05, 0.02, 270], a);
  for (let y = 0; y < S; y += S * 0.0096) ctx.fillRect(0, y, S, Math.max(1, S * 0.0032));
  kit.grain(ctx, S, 0.14);
}

/** `img` blurred by about `k` pixels: halved down to 1/k, then scaled back up in steps. */
export function blurred(kit: Kit, S: number, img: CanvasImageSource, k: number, key: string): HTMLCanvasElement {
  let src = img, w = S;
  const steps: number[] = [];
  while (w / 2 >= S / k) { w = Math.max(1, Math.round(w / 2)); steps.push(w); }
  steps.forEach((sz, i) => {
    const c = kit.scratch(`${key}-d${i}`, sz), x = kit.ctxOf(c);
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, sz, sz); x.imageSmoothingEnabled = true; x.drawImage(src, 0, 0, sz, sz);
    src = c;
  });
  for (let i = steps.length - 2; i >= -1; i--) {
    const sz = i >= 0 ? steps[i] : S, c = kit.scratch(`${key}-u${i}`, sz), x = kit.ctxOf(c);
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, sz, sz); x.imageSmoothingEnabled = true; x.drawImage(src, 0, 0, sz, sz);
    src = c;
  }
  return src as HTMLCanvasElement;
}

/**
 * Film grain for photographs: one pixel fine at any size, rather than the kit's grain, which
 * scales up with the cover and turns soft and blotchy over a smooth sky. A fresh pattern each
 * few frames (the tile jumps about, `steps` times a loop), slow enough to read as texture, not motion.
 */
export function photoGrain(ctx: Ctx, S: number, kit: Kit, amt: number, ph: number, steps: number) {
  const N = 192, tile = kit.scratch("photo-grain", N) as HTMLCanvasElement & { filled?: boolean };
  if (!tile.filled) {
    const x = kit.ctxOf(tile, true), d = x.createImageData(N, N), r = rng(11);
    for (let i = 0; i < d.data.length; i += 4) { const v = 128 + (r() + r() + r() - 1.5) * 150; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
    x.putImageData(d, 0, 0);
    tile.filled = true;
  }
  const pat = ctx.createPattern(tile, "repeat");
  if (!pat) return;
  const f = Math.floor(ph * steps), ox = (f * 61) % N, oy = (f * 113) % N;
  // a pixel is a bigger share of a small cover, so small covers get a little less
  ctx.save(); ctx.globalAlpha = amt * Math.max(0.7, Math.min(1, S / 600)); ctx.globalCompositeOperation = "overlay";
  ctx.translate(-ox, -oy); ctx.fillStyle = pat; ctx.fillRect(ox, oy, S, S);
  ctx.restore();
}

/** A horizontal smear of about `k` pixels: squeeze the picture narrow, then stretch it back. */
export function smearX(kit: Kit, S: number, img: CanvasImageSource, k: number, key: string): HTMLCanvasElement {
  let src = img, w = S;
  const steps: number[] = [];
  while (w / 2 >= S / k) { w = Math.max(1, Math.round(w / 2)); steps.push(w); }
  steps.forEach((sw, i) => {
    const c = kit.scratch(`${key}-d${i}`, sw, S), x = kit.ctxOf(c);
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, sw, S); x.imageSmoothingEnabled = true; x.drawImage(src, 0, 0, sw, S);
    src = c;
  });
  for (let i = steps.length - 2; i >= -1; i--) {
    const sw = i >= 0 ? steps[i] : S, c = kit.scratch(`${key}-u${i}`, sw, S), x = kit.ctxOf(c);
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, sw, S); x.imageSmoothingEnabled = true; x.drawImage(src, 0, 0, sw, S);
    src = c;
  }
  return src as HTMLCanvasElement;
}
