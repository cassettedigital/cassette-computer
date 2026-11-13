import { C, TAU, type Col } from "../color";
import type { Ctx, Kit } from "../kit";
import { photoGrain, type MixDraw } from "./util";
import { PHOTOS } from "./roadtrip";

/*
 * Tidy Up (was Clean House), first sketches: one stock photograph, a man in a polka-dot apron reaching up
 * with a rainbow feather duster, cut out of his studio wall and set four ways, from a sixties
 * print ad to a toned modern photo. The duster keeps its colour in all of them; it's the joke.
 * Stills only; one gets built out. References: docs/mix-cover-refs/README.md.
 */

const PHOTO = "clean-duster";
const NAME = "Tidy Up";

type Img = CanvasImageSource & { width: number; height: number };

/** Where the duster's feathers are in the cutout (fractions of it): they keep their colour. */
const isFeather = (u: number, v: number, r: number, g: number, b: number) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return u > 0.6 && v < 0.33 && mx - mn > 60;
};

/** The cutout, re-coloured pixel by pixel once per treatment and kept. */
const treated = new Map<string, HTMLCanvasElement>();
function treat(kit: Kit, img: Img, key: string, fn: (r: number, g: number, b: number, feather: boolean) => number[]) {
  let c = treated.get(key);
  if (c) return c;
  c = kit.scratch(`ch-${key}`, img.width, img.height);
  const x = kit.ctxOf(c, true);
  x.clearRect(0, 0, img.width, img.height);
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, img.width, img.height), p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    if (!p[i + 3]) continue;
    const px = (i / 4) % img.width, py = Math.floor(i / 4 / img.width);
    const out = fn(p[i], p[i + 1], p[i + 2], isFeather(px / img.width, py / img.height, p[i], p[i + 1], p[i + 2]));
    p[i] = out[0]; p[i + 1] = out[1]; p[i + 2] = out[2];
  }
  x.putImageData(d, 0, 0);
  treated.set(key, c);
  return c;
}

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
const rgbOf = (col: Col) => (C(col).match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);

/** The subject set on the cover: `w` wide, its bottom on the cover's bottom, its left at `x`. */
function subject(ctx: Ctx, S: number, img: CanvasImageSource, iw: number, ih: number, w: number, x: number) {
  const h = (w * ih) / iw;
  ctx.drawImage(img, x * S, S - h * S, w * S, h * S);
}

function card(ctx: Ctx, S: number) {
  ctx.fillStyle = C([0.9, 0.03, 85]); ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = C([0.5, 0.02, 60]); ctx.font = `600 ${S * 0.05}px "Schibsted Grotesk", sans-serif`; ctx.textAlign = "center";
  ctx.fillText("photo missing", S / 2, S / 2);
}

// ---------- 1. print ad: a black-and-white cutout on a flat panel, the duster in colour ----------

export const printad: MixDraw = (ctx, S, _ph, o, kit) => {
  const img = PHOTOS[PHOTO];
  if (!img) return card(ctx, S);
  ctx.fillStyle = C([0.93, 0.03, 88]); ctx.fillRect(0, 0, S, S);
  // the panel, a flat aqua with rounded corners, a little uneven like a print
  ctx.fillStyle = C([0.8, 0.075, 215]);
  ctx.beginPath(); ctx.roundRect(S * 0.05, S * 0.05, S * 0.9, S * 0.9, S * 0.06); ctx.fill();
  const mono = treat(kit, img, "mono", (r, g, b, f) => {
    if (f) return [r, g, b];
    const l = Math.min(255, Math.max(0, (lum(r, g, b) - 128) * 1.15 + 132));
    return [l * 1.02, l, l * 0.94];
  });
  ctx.save();
  ctx.beginPath(); ctx.roundRect(S * 0.05, S * 0.05, S * 0.9, S * 0.9, S * 0.06); ctx.clip();
  subject(ctx, S, mono, img.width, img.height, 1.02, -0.06);
  ctx.restore();
  if (o.titles) {
    ctx.fillStyle = C([0.28, 0.04, 255]); ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.font = `italic 600 ${S * 0.1}px "Fraunces", serif`;
    ctx.fillText("Tidy", S * 0.1, S * 0.17);
    ctx.fillText("Up", S * 0.1, S * 0.27);
  }
  // print: a fine dot screen and paper grain over everything
  ctx.fillStyle = C([0.3, 0.02, 60], 0.05);
  const step = Math.max(2, S / 160);
  for (let y = 0; y < S; y += step) for (let x = (y / step) % 2 ? step / 2 : 0; x < S; x += step) ctx.fillRect(x, y, step * 0.4, step * 0.4);
  kit.grain(ctx, S, 0.06);
};

// ---------- 2. checkerboard: a fifties ad, the man on a checkered kitchen floor, a script line ----------

export const checker: MixDraw = (ctx, S, _ph, o, kit) => {
  const img = PHOTOS[PHOTO];
  if (!img) return card(ctx, S);
  const wall = ctx.createLinearGradient(0, 0, 0, S * 0.62);
  wall.addColorStop(0, C([0.93, 0.035, 85])); wall.addColorStop(1, C([0.88, 0.05, 75]));
  ctx.fillStyle = wall; ctx.fillRect(0, 0, S, S);
  // the floor in perspective: rows shrinking toward the horizon, columns converging
  const hz = 0.62, vx = 0.62, rows = 9, cols = 14;
  const rowY = (i: number) => hz + (1 - hz) * Math.pow(i / rows, 1.6);
  for (let i = 0; i < rows; i++) for (let j = -cols; j < cols; j++) {
    const y0 = rowY(i), y1 = rowY(i + 1), t0 = (y0 - hz) / (1 - hz), t1 = (y1 - hz) / (1 - hz);
    const xa = (u: number, t: number) => vx + (u / 4 - vx) * t * 2.2;
    ctx.fillStyle = C((i + j) % 2 === 0 ? [0.6, 0.085, 152] : [0.93, 0.03, 95]);
    ctx.beginPath();
    ctx.moveTo(xa(j, t0) * S, y0 * S); ctx.lineTo(xa(j + 1, t0) * S, y0 * S); ctx.lineTo(xa(j + 1, t1) * S, y1 * S); ctx.lineTo(xa(j, t1) * S, y1 * S);
    ctx.fill();
  }
  const warm = treat(kit, img, "fifties", (r, g, b, f) => {
    if (f) return [r * 0.95 + 10, g * 0.92 + 8, b * 0.85 + 8];
    const l = lum(r, g, b);
    return [l + (r - l) * 0.75 + 12, l + (g - l) * 0.75 + 4, l + (b - l) * 0.75 - 10];
  });
  subject(ctx, S, warm, img.width, img.height, 0.98, -0.12);
  if (o.titles) {
    ctx.fillStyle = C([0.6, 0.17, 18]); ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.font = `400 ${S * 0.13}px "Yellowtail", cursive`;
    ctx.save(); ctx.translate(S * 0.68, S * 0.6); ctx.rotate(-0.08); ctx.fillText(NAME + "!", 0, 0); ctx.restore();
  }
  kit.grain(ctx, S, 0.07);
};

// ---------- 3. two-colour: the photo printed in navy on pink, the duster in full colour ----------

export const twotone: MixDraw = (ctx, S, _ph, o, kit) => {
  const img = PHOTOS[PHOTO];
  if (!img) return card(ctx, S);
  const paper: Col = [0.9, 0.05, 20], ink: Col = [0.3, 0.09, 268];
  ctx.fillStyle = C(paper); ctx.fillRect(0, 0, S, S);
  const P = rgbOf(paper), K = rgbOf(ink);
  const duo = treat(kit, img, "duo", (r, g, b, f) => {
    if (f) return [r, g, b];
    const t = Math.min(1, Math.max(0, lum(r, g, b) / 255)) ** 1.8;
    return [K[0] + (P[0] - K[0]) * t, K[1] + (P[1] - K[1]) * t, K[2] + (P[2] - K[2]) * t];
  });
  // a big ink disc behind him, like a sun on a poster
  ctx.fillStyle = C(ink, 0.12); ctx.beginPath(); ctx.arc(S * 0.4, S * 0.62, S * 0.36, 0, TAU); ctx.fill();
  subject(ctx, S, duo, img.width, img.height, 1.0, -0.08);
  if (o.titles) {
    ctx.fillStyle = C(ink); ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.font = `800 ${S * 0.15}px "Barlow Condensed", sans-serif`;
    ctx.fillText("TIDY", S * 0.06, S * 0.17); ctx.fillText("UP", S * 0.06, S * 0.3);
  }
  kit.grain(ctx, S, 0.07);
};

// ---------- 4. toned: the photograph kept, the wall extended and calmed, a quiet line of type ----------

export const toned: MixDraw = (ctx, S, ph, o, kit) => {
  const img = PHOTOS[PHOTO];
  if (!img) return card(ctx, S);
  const wall = ctx.createRadialGradient(S * 0.62, S * 0.3, S * 0.05, S * 0.5, S * 0.5, S * 0.85);
  wall.addColorStop(0, C([0.86, 0.04, 210])); wall.addColorStop(1, C([0.68, 0.05, 220]));
  ctx.fillStyle = wall; ctx.fillRect(0, 0, S, S);
  const film = treat(kit, img, "film", (r, g, b, f) => {
    const l = lum(r, g, b), s = f ? 0.9 : 0.7;
    const lift = (v: number) => 18 + v * 0.9;
    return [lift(l + (r - l) * s) + 4, lift(l + (g - l) * s), lift(l + (b - l) * s) - 4];
  });
  subject(ctx, S, film, img.width, img.height, 1.0, -0.12);
  if (o.titles) {
    ctx.fillStyle = C([0.25, 0.03, 250]); ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.font = `700 ${S * 0.065}px "Schibsted Grotesk", sans-serif`;
    ctx.fillText(NAME, S * 0.07, S * 0.12);
  }
  photoGrain(ctx, S, kit, 0.22, ph, 1);
};
