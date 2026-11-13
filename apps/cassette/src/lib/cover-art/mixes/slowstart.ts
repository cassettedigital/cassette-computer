import { C, TAU, type Col } from "../color";
import type { Ctx, Kit } from "../kit";
import { blurred, photoGrain, smearX, type MixDraw } from "./util";

/*
 * Slow Start: the current-conditions page of a nineties cable weather channel, off a VHS tape,
 * cut right down to two things: the name, big, in pale yellow across the header band burning
 * orange to red into the navy, and below it a bevelled panel holding one big forecast icon. No
 * temperature: the cover is the same picture for everyone, so a number would be wrong for most
 * of them. The type is a character generator's bitmap with its gradient fill and hard shadow;
 * the icon is drawn small and blown up whole; the tape bleeds colour sideways. Through the loop
 * the sun climbs out from behind its cloud a step at a time, until the tape's tracking rolls and
 * the page comes round again. Genre, never a channel's marks. References:
 * docs/mix-cover-refs/README.md.
 */

const COND = '"Barlow Condensed", "Arial Narrow", sans-serif';

const NAVY: Col = [0.28, 0.13, 268];
/** The character generator's fill for the name, top to bottom: a pale yellow, barely deepening, so it holds against the orange band. */
const YELLOW: [Col, Col] = [[0.96, 0.12, 102], [0.88, 0.16, 96]];

/** The morning, a step every two seconds: how far the sun still has to climb out from behind its cloud (icon pixels). */
const STEPS = [13, 12, 11, 10, 9, 8, 6, 5, 4, 3, 1, 0];
/** The tracking roll that carries the page round the loop: its share of the loop either side of the seam. */
const ROLL = 0.035;

/**
 * Type the way a nineties character generator set it: a bitmap about twenty pixels to the
 * capital, hard-edged, filled top to bottom with a gradient, blown up whole, a one-pixel black
 * shadow down and to the right. `cap` is the capital's height on the cover.
 */
function cgText(ctx: Ctx, kit: Kit, text: string, x: number, base: number, cap: number, fill: [Col, Col], align: "left" | "right" = "left") {
  const rows = 20, font = `700 ${rows / 0.7}px ${COND}`, k = cap / rows;
  const probe = kit.ctxOf(kit.scratch("cg-probe", 4));
  probe.font = font;
  const w = Math.ceil(probe.measureText(text).width) + 4, h = Math.ceil(rows * 2), y0 = Math.ceil(rows * 1.45);
  const bits = kit.scratch("cg-bits", w, h), b = kit.ctxOf(bits, true);
  b.setTransform(1, 0, 0, 1, 0, 0); b.globalCompositeOperation = "source-over"; b.clearRect(0, 0, w, h);
  b.font = font; b.textBaseline = "alphabetic"; b.textAlign = "left"; b.fillStyle = "#fff";
  b.fillText(text, 2, y0);
  const d = b.getImageData(0, 0, w, h);
  for (let i = 3; i < d.data.length; i += 4) d.data[i] = d.data[i] > 120 ? 255 : 0;
  b.putImageData(d, 0, 0);
  const tint = kit.scratch("cg-tint", w, h), t = kit.ctxOf(tint);
  const left = align === "right" ? x - w * k : x, top = base - y0 * k;
  ctx.imageSmoothingEnabled = false;
  for (const shadow of [true, false]) {
    t.setTransform(1, 0, 0, 1, 0, 0); t.globalCompositeOperation = "source-over"; t.clearRect(0, 0, w, h);
    t.drawImage(bits, 0, 0);
    t.globalCompositeOperation = "source-in";
    if (shadow) t.fillStyle = C([0.08, 0.02, 265]);
    else {
      const g = t.createLinearGradient(0, y0 - rows, 0, y0);
      g.addColorStop(0, C(fill[0])); g.addColorStop(1, C(fill[1]));
      t.fillStyle = g;
    }
    t.fillRect(0, 0, w, h);
    ctx.drawImage(tint, left + (shadow ? k : 0), top + (shadow ? k : 0), w * k, h * k);
  }
  ctx.imageSmoothingEnabled = true;
}

/**
 * The forecast icon as the channel drew it: seventy-two pixels square, smoothly shaded but
 * hard-edged, blown up whole. A sun with eight rays behind a cloud, `rise` grid steps lower than
 * clear of it, so it can climb out a step at a time.
 */
function icon(ctx: Ctx, kit: Kit, cx: number, cy: number, size: number, rise: number) {
  const n = 72, ic = kit.scratch("ss-icon", n), c = kit.ctxOf(ic, true);
  c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = "source-over"; c.clearRect(0, 0, n, n);
  // drawn on a forty-eight grid, set down at seventy-two
  c.setTransform(n / 48, 0, 0, n / 48, 0, 0);
  const disc = (x: number, y: number, r: number, col: Col | CanvasGradient) => { c.fillStyle = typeof col === "object" && "addColorStop" in col ? col : C(col as Col); c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); };
  const sx = 28, sy = 17 + rise * 0.75, sr = 10;
  // the sun never shows below the cloud's base: it is rising from behind it
  c.save();
  c.beginPath(); c.rect(0, 0, 48, 37); c.clip();
  // the rays: eight tapered spokes, a shade deeper than the sun
  c.fillStyle = C([0.8, 0.17, 72]);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + TAU / 16;
    c.beginPath();
    c.moveTo(sx + Math.cos(a - 0.17) * (sr + 1), sy + Math.sin(a - 0.17) * (sr + 1));
    c.lineTo(sx + Math.cos(a) * (sr + 7), sy + Math.sin(a) * (sr + 7));
    c.lineTo(sx + Math.cos(a + 0.17) * (sr + 1), sy + Math.sin(a + 0.17) * (sr + 1));
    c.closePath(); c.fill();
  }
  const ball = c.createRadialGradient(sx - 4, sy - 4, 1, sx, sy, sr);
  ball.addColorStop(0, C([0.99, 0.06, 100])); ball.addColorStop(0.5, C([0.9, 0.16, 92])); ball.addColorStop(1, C([0.76, 0.17, 66]));
  disc(sx, sy, sr, ball);
  c.restore();
  // the cloud: a dark underside, a lit body, a bright crown, all on one flat bottom
  const puffs: number[][] = [[10, 33, 6.5], [18, 28, 8.5], [27, 31, 7.5], [34, 34, 5.5], [16, 35, 6.5], [25, 36, 6]];
  c.save();
  c.beginPath(); c.rect(0, 0, 48, 40); c.clip();
  for (const [x, y, r] of puffs) disc(x, y + 1.5, r, [0.56, 0.02, 258]);
  const body = c.createLinearGradient(0, 20, 0, 40);
  body.addColorStop(0, C([0.97, 0.005, 250])); body.addColorStop(1, C([0.74, 0.012, 255]));
  for (const [x, y, r] of puffs) disc(x - 0.6, y - 0.6, r - 0.8, body);
  c.restore();
  c.setTransform(1, 0, 0, 1, 0, 0);
  const d = c.getImageData(0, 0, n, n);
  for (let i = 3; i < d.data.length; i += 4) d.data[i] = d.data[i] > 120 ? 255 : 0;
  c.putImageData(d, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(ic, cx - size / 2, cy - size / 2, size, size);
  ctx.imageSmoothingEnabled = true;
}

/** The page itself, sharp, before the tape gets it. */
function page(c: Ctx, kit: Kit, S: number, titles: boolean, rise: number) {
  c.fillStyle = C(NAVY); c.fillRect(0, 0, S, S);
  // the burned orange down both sides, purple at the ends
  for (const x0 of [0, S * 0.925]) {
    const g = c.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, C([0.38, 0.15, 290])); g.addColorStop(0.32, C([0.68, 0.19, 45])); g.addColorStop(0.72, C([0.66, 0.2, 40])); g.addColorStop(1, C([0.35, 0.15, 285]));
    c.fillStyle = g; c.fillRect(x0, 0, S * 0.075, S);
  }
  // the header band, orange burning out to red and then into the navy
  const head = c.createLinearGradient(0, 0, S, 0);
  head.addColorStop(0, C([0.68, 0.19, 48])); head.addColorStop(0.5, C([0.52, 0.2, 28])); head.addColorStop(0.9, C(NAVY));
  c.fillStyle = head; c.fillRect(0, S * 0.05, S, S * 0.215);
  // the panel: a soft gradient, a bevel lit from the top left
  const pan = { x: 0.075, y: 0.3, w: 0.85, h: 0.62 }, e = S * 0.006;
  const fill = c.createLinearGradient(0, pan.y * S, 0, (pan.y + pan.h) * S);
  fill.addColorStop(0, C([0.42, 0.15, 261])); fill.addColorStop(1, C([0.3, 0.14, 265]));
  c.fillStyle = fill; c.fillRect(pan.x * S, pan.y * S, pan.w * S, pan.h * S);
  c.fillStyle = C([0.62, 0.13, 255]); c.fillRect(pan.x * S, pan.y * S, pan.w * S, e); c.fillRect(pan.x * S, pan.y * S, e, pan.h * S);
  c.fillStyle = C([0.18, 0.1, 268]); c.fillRect(pan.x * S, (pan.y + pan.h) * S - e, pan.w * S, e); c.fillRect((pan.x + pan.w) * S - e, pan.y * S, e, pan.h * S);
  if (titles) cgText(c, kit, "Slow Start", S * 0.075, S * 0.215, S * 0.15, YELLOW);
  icon(c, kit, S * 0.5, S * 0.62, S * 0.56, rise);
}

/**
 * The tape: what a VHS recording does to a broadcast. Detail softens a touch, colour smears
 * sideways past the edges it belongs to while brightness stays put, a faint red ghost sits to
 * the right, the lines show, there is noise, and along the very bottom the head-switching
 * band tears a few lines sideways. `roll` (0 to 1) is the tracking giving way: a band of noise
 * climbing the frame, the lines in it torn and shoved aside.
 */
function tape(ctx: Ctx, S: number, kit: Kit, scene: HTMLCanvasElement, ph: number, roll: number) {
  const px = (k: number) => Math.max(1, (k * S) / 600);
  const out = kit.scratch("ss-out", S), o = kit.ctxOf(out);
  o.setTransform(1, 0, 0, 1, 0, 0); o.globalCompositeOperation = "source-over"; o.globalAlpha = 1;
  o.drawImage(blurred(kit, S, scene, px(1.3), "ss-tape-soft"), 0, 0);
  o.globalCompositeOperation = "color";
  o.globalAlpha = 0.9;
  o.drawImage(smearX(kit, S, scene, px(14), "ss-tape-bleed"), px(2), 0);
  o.globalCompositeOperation = "lighter";
  o.globalAlpha = 0.07;
  o.drawImage(scene, px(4), 0);
  o.globalAlpha = 1;
  o.globalCompositeOperation = "source-over";
  o.fillStyle = C([0, 0, 0], 0.06);
  for (let y = 0; y < S; y += px(3)) o.fillRect(0, y, S, px(1));
  photoGrain(o, S, kit, 0.24, ph, 48);
  // tear lines: a slice of rows shoved sideways, the gap filled with what was beside it
  const frame = Math.floor(ph * 288);
  const jitter = (i: number) => { const v = Math.sin(frame * 12.9898 + i * 78.233) * 43758.5453; return v - Math.floor(v); };
  const tear = (y0: number, h: number, push: number) => {
    const y = Math.max(0, Math.round(y0)), hh = Math.max(1, Math.round(h));
    if (y >= S) return;
    o.drawImage(out, 0, y, S, hh, push, y, S, hh);
    o.drawImage(out, 0, y, S, hh, push - S * Math.sign(push || 1), y, S, hh);
  };
  // head switching: the last few lines, always a little torn
  for (let i = 0; i < 4; i++) tear(S * (0.982 + i * 0.0045), S * 0.0045, px(6 + jitter(i) * 10));
  if (roll > 0) {
    const band = S * 0.1, yc = S * (1.05 - roll * 1.15);
    for (let i = 0; i < 14; i++) tear(yc - band / 2 + (i * band) / 14, band / 14, px((jitter(i + 9) - 0.3) * 60 * Math.sin(roll * Math.PI)));
    const g = o.createLinearGradient(0, yc - band, 0, yc + band);
    g.addColorStop(0, C([1, 0, 0], 0)); g.addColorStop(0.5, C([0.9, 0.01, 250], 0.35 * Math.sin(roll * Math.PI))); g.addColorStop(1, C([1, 0, 0], 0));
    o.fillStyle = g; o.fillRect(0, yc - band, S, band * 2);
  }
  ctx.drawImage(out, 0, 0);
}

export const conditions: MixDraw = (ctx, S, ph, o, kit) => {
  const scene = kit.scratch("ss-scene", S), c = kit.ctxOf(scene);
  c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = "source-over"; c.globalAlpha = 1; c.clearRect(0, 0, S, S);
  page(c, kit, S, o.titles, STEPS[Math.min(STEPS.length - 1, Math.floor(ph * STEPS.length))]);
  // the tracking rolls across the seam: from just before the loop's end to just after its start
  const roll = ph > 1 - ROLL ? (ph - (1 - ROLL)) / (2 * ROLL) : ph < ROLL ? 0.5 + ph / (2 * ROLL) : 0;
  tape(ctx, S, kit, scene, ph, roll);
};
