import { C, mix, TAU } from "../color";
import { glint } from "../kit";
import type { Ctx, Kit } from "../kit";
import { rng, hash } from "../rng";
import type { MixDraw } from "./util";

/** A night sky of pinpricks and a few cross-glints, with the dust of an old print. */
export function starfield(ctx: Ctx, S: number, ph: number, seed: string, base: number[] = [0.12, 0.025, 275], edge: number[] = [0.06, 0.015, 275]) {
  const r = rng(hash(seed));
  const bg = ctx.createRadialGradient(S * 0.5, S * 0.45, S * 0.05, S * 0.5, S * 0.5, S * 0.8);
  bg.addColorStop(0, C(base)); bg.addColorStop(1, C(edge));
  ctx.fillStyle = bg; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 70; i++) {
    const x = r() * S, y = r() * S, a = 0.25 + r() * 0.6, k = 1 + Math.floor(r() * 3), q = r() * TAU;
    ctx.fillStyle = C([0.95, 0.02, 250], a * (0.6 + 0.4 * Math.sin(TAU * k * ph + q)));
    ctx.fillRect(x, y, Math.max(1, S * 0.003), Math.max(1, S * 0.003));
  }
  // dust and a hair or two, the way a scanned sleeve looks
  ctx.strokeStyle = C([0.9, 0.01, 90], 0.12); ctx.lineWidth = Math.max(1, S * 0.0018);
  for (let i = 0; i < 3; i++) {
    const x = r() * S, y = r() * S, l = S * (0.05 + r() * 0.1), a = r() * TAU;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.6 + l * 0.2, y + Math.sin(a) * l * 0.6, x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
  }
}

/**
 * Chrome lettering in the eighties way: a sky-to-sunset reflection with a hard horizon, rimmed
 * in light, with a gleam crossing once a loop (during `sweep`) so the still stays clean.
 * `stretch` draws it taller than the face does, up from the baseline; `floor` stands it on a
 * glossy floor, its reflection hanging straight off the letters' feet.
 */
export function chromeText(ctx: Ctx, S: number, kit: Kit, text: string, font: string, x: number, y: number, size: number, ph: number, sweep: [number, number], stretch = 1, floor: number[] | null = null) {
  const buf = kit.buffer(S), b = kit.ctxOf(buf);
  b.setTransform(1, 0, 0, 1, 0, 0); b.globalCompositeOperation = "source-over"; b.clearRect(0, 0, S, S);
  b.font = font; b.textAlign = "center"; b.textBaseline = "alphabetic"; b.lineJoin = "round";
  const top = y - size * 0.74, bot = y + size * 0.02;
  b.setTransform(1, 0, 0, stretch, 0, y * (1 - stretch));
  // the face
  const face = b.createLinearGradient(0, top, 0, bot);
  face.addColorStop(0, C([0.2, 0.05, 268])); face.addColorStop(0.2, C([0.36, 0.14, 305])); face.addColorStop(0.33, C([0.6, 0.2, 28]));
  face.addColorStop(0.45, C([0.86, 0.15, 75])); face.addColorStop(0.5, C([0.98, 0.02, 95])); face.addColorStop(0.515, C([0.16, 0.05, 262]));
  face.addColorStop(0.62, C([0.42, 0.15, 252])); face.addColorStop(0.83, C([0.8, 0.09, 222])); face.addColorStop(1, C([0.97, 0.02, 205]));
  b.fillStyle = face; b.fillText(text, x, y);
  // the gleam, on the face only
  const g0 = (ph - sweep[0]) / (sweep[1] - sweep[0]);
  if (g0 > 0 && g0 < 1) {
    b.globalCompositeOperation = "source-atop";
    const gx = -S * 0.3 + g0 * S * 1.6, gl = b.createLinearGradient(gx - S * 0.12, top, gx + S * 0.12, bot);
    gl.addColorStop(0, "rgba(255, 255, 255, 0)"); gl.addColorStop(0.5, "rgba(255, 255, 255, 0.8)"); gl.addColorStop(1, "rgba(255, 255, 255, 0)");
    b.fillStyle = gl; b.fillRect(0, 0, S, S / stretch + top);
    b.globalCompositeOperation = "source-over";
  }
  // a thin rim of light round each letter
  const rim = Math.max(1, size * 0.018);
  b.lineWidth = rim; b.strokeStyle = C([0.97, 0.03, 220], 0.85); b.strokeText(text, x, y);
  b.setTransform(1, 0, 0, 1, 0, 0);
  const base = y + rim * 0.5;
  if (floor) {
    // the reflection, mirrored at the letters' feet, strongest where they touch the glass
    const fade = ctx.createLinearGradient(0, base, 0, base + size * 0.9);
    fade.addColorStop(0, C(floor, 0)); fade.addColorStop(1, C(floor, 1));
    ctx.save(); ctx.globalAlpha = 0.42; ctx.translate(0, 2 * base); ctx.scale(1, -1); ctx.drawImage(buf, 0, 0); ctx.restore();
    ctx.fillStyle = fade; ctx.fillRect(0, base, S, S - base);
  }
  ctx.save(); ctx.shadowColor = C([0.6, 0.2, 290], 0.55); ctx.shadowBlur = S * 0.04; ctx.drawImage(buf, 0, 0); ctx.restore();
  return { top: y - (y - top) * stretch, bot: base };
}

/** A lens star: a bright point with long thin rays, the kind chrome throws off. */
export function lensStar(ctx: Ctx, x: number, y: number, len: number, a: number) {
  const halo = ctx.createRadialGradient(x, y, 0, x, y, len * 0.35);
  halo.addColorStop(0, C([0.99, 0.02, 90], 0.9 * a)); halo.addColorStop(1, C([0.99, 0.02, 90], 0));
  ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(x, y, len * 0.35, 0, TAU); ctx.fill();
  glint(ctx, x, y, len, [0.99, 0.02, 90], a);
}

/**
 * Get Pumped, the heavy metal way: PUMPED in chrome on a black starfield, a hot pink
 * neon "Get" slung across it, a lens star on the chrome. The gleam rolls across once a loop.
 */
export const chrome: MixDraw = (ctx, S, ph, o, kit) => {
  starfield(ctx, S, ph, "mix|get-pumped");
  const breathe = 0.9 + 0.1 * Math.sin(TAU * ph * 2);
  if (!o.titles) {
    // a chrome bolt instead of the name
    const bolt = [[0.58, 0.1], [0.3, 0.55], [0.48, 0.55], [0.38, 0.9], [0.72, 0.42], [0.53, 0.42], [0.66, 0.1]];
    const pts = bolt.map(([x, y]) => [x * S, y * S]);
    const buf = kit.buffer(S), b = kit.ctxOf(buf);
    b.setTransform(1, 0, 0, 1, 0, 0); b.clearRect(0, 0, S, S);
    const path = (dx: number, dy: number) => { b.beginPath(); pts.forEach(([x, y], i) => (i ? b.lineTo(x + dx, y + dy) : b.moveTo(x + dx, y + dy))); b.closePath(); };
    for (let k = 12; k >= 1; k--) { b.fillStyle = C(mix([0.45, 0.12, 250], [0.08, 0.03, 265], k / 12)); path(S * 0.004 * k, S * 0.004 * k); b.fill(); }
    const f = b.createLinearGradient(0, S * 0.1, 0, S * 0.9);
    f.addColorStop(0, C([0.2, 0.05, 268])); f.addColorStop(0.3, C([0.6, 0.2, 28])); f.addColorStop(0.47, C([0.9, 0.12, 80])); f.addColorStop(0.5, C([0.98, 0.02, 95]));
    f.addColorStop(0.515, C([0.16, 0.05, 262])); f.addColorStop(0.75, C([0.62, 0.13, 240])); f.addColorStop(1, C([0.95, 0.03, 210]));
    b.fillStyle = f; path(0, 0); b.fill();
    b.strokeStyle = C([0.97, 0.03, 220], 0.85); b.lineWidth = Math.max(1, S * 0.004); b.stroke();
    ctx.save(); ctx.shadowColor = C([0.6, 0.2, 290], 0.6); ctx.shadowBlur = S * 0.05; ctx.drawImage(buf, 0, 0); ctx.restore();
    lensStar(ctx, S * 0.66, S * 0.1, S * 0.16 * breathe, 0.9);
    kit.grain(ctx, S, 0.16);
    return;
  }
  const word = "PUMPED", font = (s: number) => `400 ${s}px "Ultra", "Archivo Black", sans-serif`;
  let size = S * 0.3;
  ctx.font = font(size);
  const w = ctx.measureText(word).width;
  if (w > S * 0.86) size *= (S * 0.86) / w;
  // centre the lockup, from the top of the neon "Get" to the letters' feet, a touch above the middle
  const stretch = 1.75, gs = S * 0.27, faceH = size * 0.74 * stretch, getH = S * 0.035 + gs * 0.62;
  const y = S * 0.47 + (getH + faceH) / 2;
  const { top } = chromeText(ctx, S, kit, word, font(size), S / 2, y, size, ph, [0.55, 0.8], stretch, [0.07, 0.015, 275]);
  // a long anamorphic streak through the lens star
  const sy = top + size * 0.06, streak = ctx.createLinearGradient(0, 0, S, 0);
  streak.addColorStop(0, C([0.75, 0.12, 250], 0)); streak.addColorStop(0.2, C([0.8, 0.12, 250], 0.55)); streak.addColorStop(1, C([0.75, 0.12, 250], 0));
  ctx.fillStyle = streak; ctx.fillRect(0, sy - S * 0.002, S, S * 0.004);
  ctx.font = font(size);
  const lw = ctx.measureText(word).width;
  // the lens star sits on the corner of the P
  const tw = 0.5 + 0.5 * Math.sin(TAU * ph * 3);
  lensStar(ctx, S / 2 - lw / 2 + size * 0.06, top + size * 0.04, S * (0.1 + 0.06 * tw), 0.6 + 0.4 * tw);

  // the neon "Get", slung across the top of the chrome
  const neon = [0.72, 0.24, 352], core = [0.97, 0.04, 350];
  const flick = ph > 0.31 && ph < 0.335 ? (Math.sin((ph - 0.31) * 900) > 0 ? 0.25 : 1) : 1;
  const a = breathe * flick;
  ctx.save(); ctx.translate(S / 2 - lw * 0.15, top - S * 0.035); ctx.rotate(-0.14);
  ctx.font = `400 ${gs}px "Sacramento", cursive`; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.shadowColor = C(neon, 0.95 * a); ctx.shadowBlur = S * 0.045; ctx.strokeStyle = C(neon, a); ctx.lineWidth = gs * 0.05; ctx.strokeText("Get", 0, 0);
  ctx.shadowBlur = S * 0.015; ctx.strokeText("Get", 0, 0);
  ctx.shadowBlur = 0; ctx.strokeStyle = C(mix(neon, core, 0.75), 0.5 + 0.5 * a); ctx.lineWidth = gs * 0.018; ctx.strokeText("Get", 0, 0);
  ctx.restore();
  kit.grain(ctx, S, 0.16);
};

/**
 * Get Pumped, the aerobics way (after Retrosweat): a sun cut out of a field of pink
 * stripes on electric blue, and the name in a monoline script with a pink drop.
 */
export const aerobics: MixDraw = (ctx, S, ph, o, kit) => {
  const r = rng(hash("mix|get-pumped|sweat"));
  const bg = ctx.createLinearGradient(0, 0, 0, S);
  bg.addColorStop(0, C([0.64, 0.15, 230])); bg.addColorStop(1, C([0.52, 0.17, 248]));
  ctx.fillStyle = bg; ctx.fillRect(0, 0, S, S);
  // the stripes drift down one spacing every quarter loop, so the loop closes
  const cx = S * 0.5, cy = S * 0.5, R = S * 0.37, gap = S * 0.034, th = S * 0.011, off = ((ph * 4) % 1) * gap;
  ctx.fillStyle = C([0.84, 0.09, 330], 0.92);
  for (let y = -gap + off; y < S; y += gap) ctx.fillRect(0, y, S, th);
  // the sun, the same blue a shade lighter, cut clean out of the stripes
  const sun = ctx.createLinearGradient(0, cy - R, 0, cy + R);
  sun.addColorStop(0, C([0.68, 0.14, 228])); sun.addColorStop(1, C([0.56, 0.16, 245]));
  ctx.fillStyle = sun; ctx.beginPath(); ctx.arc(cx, cy, R * (1 + 0.012 * Math.sin(TAU * ph)), 0, TAU); ctx.fill();
  // worn print: specks and scuffs
  for (let i = 0; i < 90; i++) { ctx.fillStyle = C([0.95, 0.03, 220], 0.08 + r() * 0.2); ctx.fillRect(r() * S, r() * S, S * 0.002 * (1 + r() * 2), S * 0.002); }
  if (o.titles) {
    const gs = S * 0.2, a = 0.92 + 0.08 * Math.sin(TAU * ph * 2);
    ctx.save(); ctx.translate(cx, cy + S * 0.04); ctx.rotate(-0.1);
    ctx.font = `400 ${gs}px "Sacramento", cursive`; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    const w = ctx.measureText("Get Pumped.").width;
    const k = Math.min(1, (S * 0.9) / w); ctx.scale(k, k);
    // the pink drop, then the white line
    ctx.strokeStyle = C([0.72, 0.2, 350]); ctx.lineWidth = gs * 0.05; ctx.strokeText("Get Pumped.", gs * 0.03, gs * 0.035);
    ctx.shadowColor = C([0.95, 0.05, 220], 0.7 * a); ctx.shadowBlur = S * 0.02;
    ctx.strokeStyle = C([0.97, 0.02, 210], a); ctx.lineWidth = gs * 0.042; ctx.strokeText("Get Pumped.", 0, 0);
    ctx.restore();
  }
  kit.grain(ctx, S, 0.14);
};
