import { C, TAU } from "../color";
import type { Ctx, Kit } from "../kit";
import { loopNoise, photoGrain, type MixDraw } from "./util";

/**
 * Road Trip: real photographs of the road (Unsplash License, see assets/cover-photos/CREDITS.md)
 * on faded seventies film from a hand-held camera, the name in a fat soft serif. Three covers
 * take the day in turn: red rock, teal sky, and a lone cloud with a paper label.
 */

const COOPER = '"Fraunces", Georgia, serif';

/**
 * A hand-held camera, held still: a slow float over several seconds and a gentle sway about a
 * second long, never a buzz. Whole-number harmonics of the loop, so it closes.
 */
function shake(ph: number, S: number) {
  return {
    dx: S * (0.004 * loopNoise(ph, 7, [2, 3, 5]) + 0.002 * loopNoise(ph, 1, [37, 53, 67])),
    dy: S * (0.004 * loopNoise(ph, 8, [2, 5, 7]) + 0.002 * loopNoise(ph, 2, [41, 59, 71])),
    rot: 0.0025 * loopNoise(ph, 3, [3, 5]),
  };
}

/** Faded film: warm the colour, lift the blacks, darken the corners, and let the exposure breathe. */
function filmGrade(ctx: Ctx, S: number, ph: number, kit: Kit, warm: number[] = [0.93, 0.05, 78], grain = 0.34) {
  ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = C(warm); ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = "screen"; ctx.fillStyle = C([0.3, 0.04, 60], 0.3); ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = "source-over";
  const v = ctx.createRadialGradient(S / 2, S / 2, S * 0.35, S / 2, S / 2, S * 0.78);
  v.addColorStop(0, "rgba(0, 0, 0, 0)"); v.addColorStop(1, C([0.15, 0.03, 50], 0.55));
  ctx.fillStyle = v; ctx.fillRect(0, 0, S, S);
  const flicker = 0.02 * loopNoise(ph, 5, [9, 13, 19]);
  ctx.fillStyle = flicker > 0 ? `rgba(255, 245, 225, ${flicker})` : `rgba(0, 0, 0, ${-flicker})`; ctx.fillRect(0, 0, S, S);
  if (grain > 0) kit.grain(ctx, S, grain, ph || 0.0001);
}

/** The photographs Road Trip draws, by file name (assets/cover-photos/<name>.jpg). */
export const ROAD_TRIP_PHOTOS = ["red-rock-road", "teal-sky-road", "single-cloud"] as const;

/** Those photographs, loaded: the host fills it (the server from assets/cover-photos, the browser from /cover-photos). */
export const PHOTOS: Record<string, CanvasImageSource & { width: number; height: number }> = {};

/** A photo cropped to fill the square, `zoom` past it so the shake never shows an edge, and pushed by (dx, dy). */
function photoFill(ctx: Ctx, S: number, img: CanvasImageSource & { width: number; height: number }, zoom: number, focus: [number, number], dx = 0, dy = 0) {
  const k = (S / Math.min(img.width, img.height)) * zoom, w = img.width * k, h = img.height * k;
  const x = S / 2 - focus[0] * w + dx, y = S / 2 - focus[1] * h + dy;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, Math.min(0, Math.max(S - w, x)), Math.min(0, Math.max(S - h, y)), w, h);
}

/** Faded print: lift the blacks, pull the saturation down, warm it; `cool` leans it to cyan instead. */
function fadedPrint(ctx: Ctx, S: number, cool = false, strength = 1) {
  ctx.globalCompositeOperation = "saturation"; ctx.fillStyle = C([0.5, cool ? 0.05 : 0.07, 60], 0.35 * strength); ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = "multiply"; ctx.fillStyle = C(cool ? [0.95, 0.04, 200] : [0.94, 0.06 * strength, 75]); ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = "screen"; ctx.fillStyle = C(cool ? [0.32, 0.04, 220] : [0.3, 0.05, 55], 0.35 * strength); ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = "source-over";
}

/**
 * Road Trip as a snapshot: a real photograph of the road, on faded film from a hand-held
 * camera, the name in a fat soft seventies serif with a dark drop, centred.
 */
export const roadPhoto = (photo: string, focus: [number, number] = [0.5, 0.5]): MixDraw => (ctx, S, ph, o, kit) => {
  const img = PHOTOS[photo];
  // until the photo arrives, a quiet sand-coloured card
  if (!img) { ctx.fillStyle = C([0.42, 0.05, 60]); ctx.fillRect(0, 0, S, S); return; }
  const sh = shake(ph, S);
  ctx.save(); ctx.translate(S / 2, S / 2); ctx.rotate(sh.rot); ctx.translate(-S / 2, -S / 2);
  photoFill(ctx, S, img, 1.08, focus, sh.dx, sh.dy);
  ctx.restore();
  fadedPrint(ctx, S);
  if (o.titles) {
    let size = S * 0.24;
    ctx.font = `900 ${size}px ${COOPER}`; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    const w = Math.max(ctx.measureText("Road").width, ctx.measureText("Trip").width);
    if (w > S * 0.72) { size *= (S * 0.72) / w; ctx.font = `900 ${size}px ${COOPER}`; }
    const y1 = S * 0.5 - size * 0.06, y2 = y1 + size * 0.84, d = size * 0.055;
    ctx.fillStyle = C([0.3, 0.07, 35], 0.92); ctx.fillText("Road", S / 2 + d, y1 + d); ctx.fillText("Trip", S / 2 + d, y2 + d);
    ctx.fillStyle = C([0.8, 0.16, 72]); ctx.fillText("Road", S / 2, y1); ctx.fillText("Trip", S / 2, y2);
  }
  filmGrade(ctx, S, ph, kit, [0.96, 0.03, 80], 0);
  photoGrain(ctx, S, kit, 0.36, ph, 80);
};

/**
 * Road Trip after "A New Concept": a real cloud floating in its own sky, the photo set smaller
 * than the frame and feathered into a fill of the same blue, on a faded warm print, drifting,
 * with a paper label laid across it.
 */
export const cloudPhoto = (photo: string, sky: [string, string], zoom = 0.66): MixDraw => (ctx, S, ph, o, kit) => {
  const img = PHOTOS[photo];
  if (!img) { ctx.fillStyle = sky[0]; ctx.fillRect(0, 0, S, S); return; }
  const sh = shake(ph, S), drift = S * 0.03 * Math.sin(TAU * ph);
  const bg = ctx.createLinearGradient(0, 0, S, S);
  bg.addColorStop(0, sky[0]); bg.addColorStop(1, sky[1]);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, S, S);
  // the photo, feathered at every edge so it melts into the sky round it
  const k = (S / Math.min(img.width, img.height)) * zoom, w = img.width * k, h = img.height * k;
  const buf = kit.scratch("cloud-photo", S), b = kit.ctxOf(buf);
  b.setTransform(1, 0, 0, 1, 0, 0); b.globalCompositeOperation = "source-over"; b.clearRect(0, 0, S, S);
  const x = (S - w) / 2 + sh.dx * 0.6 + drift, y = (S - h) / 2 + sh.dy * 0.6, f = S * 0.12;
  b.imageSmoothingEnabled = true; b.drawImage(img, x, y, w, h);
  b.globalCompositeOperation = "destination-out";
  const edge = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number) => {
    const g = b.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, "rgba(0, 0, 0, 1)"); g.addColorStop(1, "rgba(0, 0, 0, 0)");
    b.fillStyle = g; b.fillRect(rx, ry, rw, rh);
  };
  edge(x, 0, x + f, 0, x - 1, 0, f + 1, S); edge(x + w, 0, x + w - f, 0, x + w - f, 0, f + 1, S);
  edge(0, y, 0, y + f, 0, y - 1, S, f + 1); edge(0, y + h, 0, y + h - f, 0, y + h - f, S, f + 1);
  b.globalCompositeOperation = "source-over";
  ctx.drawImage(buf, 0, 0);
  fadedPrint(ctx, S, false, 0.5);
  if (o.titles) {
    const text = "ROAD TRIP", size = S * 0.068;
    ctx.font = `700 ${size}px "Schibsted Grotesk", "Helvetica Neue", sans-serif`;
    const track = size * 0.16, chars = [...text], cw = chars.map((ch) => ctx.measureText(ch).width);
    const tw = cw.reduce((a2, b2) => a2 + b2, 0) + track * (chars.length - 1), pw = tw + size * 1.1, phh = size * 1.55;
    ctx.save(); ctx.translate(S * 0.5 + sh.dx * 0.3 + drift * 0.6, S * 0.53 + sh.dy * 0.3); ctx.rotate(-0.015);
    ctx.fillStyle = C([0.2, 0.03, 240], 0.25); ctx.fillRect(-pw / 2 + S * 0.006, -phh / 2 + S * 0.008, pw, phh);
    ctx.fillStyle = C([0.92, 0.05, 88]); ctx.fillRect(-pw / 2, -phh / 2, pw, phh);
    ctx.fillStyle = C([0.2, 0.015, 60]); ctx.textAlign = "left"; ctx.textBaseline = "middle";
    let tx = -tw / 2; chars.forEach((ch, i) => { ctx.fillText(ch, tx, size * 0.05); tx += cw[i] + track; });
    ctx.restore();
  }
  filmGrade(ctx, S, ph, kit, [0.97, 0.03, 85], 0);
  photoGrain(ctx, S, kit, 0.3, ph, 60);
};
