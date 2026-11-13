import { C, mix, ease, TAU } from "../color";
import { sparkle, glint } from "../kit";
import type { Ctx, Kit } from "../kit";
import { rng, hash } from "../rng";
import { PROFILE } from "./profile";
import { blurred, holdPulse, tape, type MixDraw } from "./util";

/** The head as a path, mapping its unit box through `X` and `Y`. */
function headPath(kit: Kit, X: (u: number) => number, Y: (v: number) => number): Path2D {
  const p = kit.path();
  p.moveTo(X(PROFILE.start[0]), Y(PROFILE.start[1]));
  for (const c of PROFILE.curves) p.bezierCurveTo(X(c[0]), Y(c[1]), X(c[2]), Y(c[3]), X(c[4]), Y(c[5]));
  p.closePath();
  return p;
}

/** How far each point inside the head lies from its outline, on a grid in the unit box. */
type Field = { nx: number; ny: number; x0: number; y0: number; step: number; d: Float32Array; deep: [number, number]; max: number };
let FIELD: Field | null = null;

/** Squared distance to the nearest zero along one line (Felzenszwalb and Huttenlocher). */
function edt1d(f: Float64Array, n: number, out: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; out[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}

function headField(kit: Kit): Field {
  if (FIELD) return FIELD;
  const step = 1 / 200, x0 = -0.06, y0 = -0.06, x1 = 1.04, y1 = 1.36;
  const nx = Math.ceil((x1 - x0) / step), ny = Math.ceil((y1 - y0) / step);
  const c = kit.scratch("head-mask", nx, ny), m = kit.ctxOf(c, true);
  m.setTransform(1, 0, 0, 1, 0, 0); m.clearRect(0, 0, nx, ny);
  m.fillStyle = "#fff"; m.fill(headPath(kit, (u) => (u - x0) / step, (v) => (v - y0) / step));
  const px = m.getImageData(0, 0, nx, ny).data;
  const BIG = 1e12, grid = new Float64Array(nx * ny);
  for (let i = 0; i < nx * ny; i++) grid[i] = px[i * 4 + 3] > 127 ? BIG : 0;
  const n = Math.max(nx, ny), f = new Float64Array(n), out = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) f[x] = grid[y * nx + x];
    edt1d(f, nx, out, v, z);
    for (let x = 0; x < nx; x++) grid[y * nx + x] = out[x];
  }
  for (let x = 0; x < nx; x++) {
    for (let y = 0; y < ny; y++) f[y] = grid[y * nx + x];
    edt1d(f, ny, out, v, z);
    for (let y = 0; y < ny; y++) grid[y * nx + x] = out[y];
  }
  let d = new Float32Array(nx * ny);
  for (let i = 0; i < nx * ny; i++) d[i] = Math.sqrt(grid[i]) * step;
  // soften the ridge down the middle, where the lines would otherwise turn to corners
  for (let pass = 0; pass < 4; pass++) {
    const nd = new Float32Array(nx * ny);
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = y * nx + x;
      if (d[i] === 0) continue;
      let sum = 0, cnt = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= nx || yy >= ny) continue;
        sum += d[yy * nx + xx]; cnt++;
      }
      nd[i] = sum / cnt;
    }
    d = nd;
  }
  let max = 0, deep: [number, number] = [0.45, 0.45];
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const dist = d[y * nx + x];
    // the deepest point of the skull, ignoring the neck
    if (y0 + y * step < 0.85 && dist > max) { max = dist; deep = [x0 + x * step, y0 + y * step]; }
  }
  FIELD = { nx, ny, x0, y0, step, d, deep, max };
  return FIELD;
}

/**
 * The lines at depths `levels` inside the head, one path per level, by marching squares over
 * the distance field: each is the outline moved evenly inward, so the inner ones smooth out.
 */
function contours(kit: Kit, F: Field, levels: number[], X: (u: number) => number, Y: (v: number) => number): Path2D[] {
  const { nx, ny, x0, y0, step, d } = F;
  const paths = levels.map(() => kit.path());
  const lo = levels[0], hi = levels[levels.length - 1];
  const gx = (i: number) => X(x0 + i * step), gy = (j: number) => Y(y0 + j * step);
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = d[j * nx + i], b = d[j * nx + i + 1], c = d[(j + 1) * nx + i + 1], e = d[(j + 1) * nx + i];
    const mn = Math.min(a, b, c, e), mx = Math.max(a, b, c, e);
    if (mx <= lo || mn > hi) continue;
    levels.forEach((L, k) => {
      if (L <= mn || L > mx) return;
      const idx = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (c > L ? 2 : 0) | (e > L ? 1 : 0);
      const T = (): [number, number] => [gx(i + (L - a) / (b - a)), gy(j)];
      const R = (): [number, number] => [gx(i + 1), gy(j + (L - b) / (c - b))];
      const B = (): [number, number] => [gx(i + (L - e) / (c - e)), gy(j + 1)];
      const Lf = (): [number, number] => [gx(i), gy(j + (L - a) / (e - a))];
      const seg = (p: [number, number], q: [number, number]) => { paths[k].moveTo(p[0], p[1]); paths[k].lineTo(q[0], q[1]); };
      const centre = (a + b + c + e) / 4 > L;
      switch (idx) {
        case 1: case 14: seg(Lf(), B()); break;
        case 2: case 13: seg(B(), R()); break;
        case 3: case 12: seg(Lf(), R()); break;
        case 4: case 11: seg(T(), R()); break;
        case 6: case 9: seg(T(), B()); break;
        case 7: case 8: seg(Lf(), T()); break;
        case 5: if (centre) { seg(Lf(), T()); seg(B(), R()); } else { seg(Lf(), B()); seg(T(), R()); } break;
        case 10: if (centre) { seg(T(), R()); seg(Lf(), B()); } else { seg(Lf(), T()); seg(B(), R()); } break;
      }
    });
  }
  return paths;
}

/** A sparkle with its colours split, the way a worn tape smears a highlight. */
export function splitStar(ctx: Ctx, x: number, y: number, rad: number, a: number) {
  const d = rad * 0.18;
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = C([0.62, 0.24, 28], 0.8 * a); sparkle(ctx, x - d, y, rad);
  ctx.fillStyle = C([0.6, 0.2, 262], 0.8 * a); sparkle(ctx, x + d, y, rad);
  ctx.fillStyle = C([0.99, 0.01, 90], a); sparkle(ctx, x, y, rad * 0.8);
  ctx.globalCompositeOperation = "source-over";
}

const RAINBOW: [number, number[]][] = [
  [0, [0.88, 0.15, 90]], [0.2, [0.79, 0.18, 52]], [0.38, [0.71, 0.22, 10]], [0.54, [0.65, 0.23, 335]],
  [0.7, [0.6, 0.2, 298]], [0.86, [0.66, 0.15, 256]], [1, [0.8, 0.11, 220]],
];

/** The rainbow the contours run through, outside in: gold, orange, red, magenta, violet, blue. */
function rainbowAt(t: number): number[] {
  const u = Math.max(0, Math.min(1, t)) * (RAINBOW.length - 1), i = Math.min(RAINBOW.length - 2, Math.floor(u)), f = u - i;
  const [, p] = RAINBOW[i], [, q] = RAINBOW[i + 1];
  return mix(p, q, f);
}

/**
 * Focus: a head in profile, its contours following the face inward like the lines of a map and
 * flowing slowly in toward a bright orb at the centre of the skull, a ring of light round it,
 * stars in a scanlined sky. Each line takes the colour of its depth.
 */
export const head: MixDraw = (ctx, S, ph, o, kit) => {
  const r = rng(hash("mix|focus"));
  ctx.fillStyle = C([0.15, 0.05, 275]); ctx.fillRect(0, 0, S, S);
  const W = S * (o.titles ? 0.66 : 0.78), ox = (S - 0.95 * W) / 2, oy = S * (o.titles ? 0.05 : 0.07);
  const X = (u: number) => ox + u * W, Y = (v: number) => oy + v * W;
  const F = headField(kit), cx = X(F.deep[0]), cy = Y(F.deep[1]);
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.5);
  glow.addColorStop(0, C([0.3, 0.12, 320], 0.55)); glow.addColorStop(1, C([0.15, 0.05, 275], 0));
  ctx.fillStyle = glow; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 14; i++) {
    const x = r() * S, y = r() * S * 0.8, rad = S * (0.008 + r() * r() * 0.022), k = 1 + Math.floor(r() * 2), q = r() * TAU;
    splitStar(ctx, x, y, rad * (0.75 + 0.25 * Math.sin(TAU * k * ph + q)), 0.5 + 0.4 * r());
  }
  // the lines: each moves one spacing inward a loop, a new one fading in at the outline as the
  // innermost fades into the orb, so frame 1 matches frame 0
  const N = 11, reach = F.max * 0.86, spacing = reach / N;
  const levels = Array.from({ length: N }, (_, k) => (k + ph) * spacing + 1e-4);
  const paths = contours(kit, F, levels, X, Y);
  const outline = headPath(kit, X, Y);
  const lw = Math.max(1, S * 0.0085);
  ctx.lineWidth = lw; ctx.lineJoin = "round"; ctx.lineCap = "round";
  const fadeOf = (L: number) => Math.min(1, L / (spacing * 0.8)) * Math.min(1, (reach - L) / (spacing * 1.6));
  // the colour split: a red ghost to the left and a blue one to the right
  ctx.globalCompositeOperation = "screen";
  for (const [dx, col] of [[-S * 0.0045, [0.6, 0.23, 28]], [S * 0.0045, [0.56, 0.2, 262]]] as [number, number[]][]) {
    ctx.save(); ctx.translate(dx, 0);
    ctx.strokeStyle = C(col, 0.5); ctx.stroke(outline);
    paths.forEach((p, k) => { const a = fadeOf(levels[k]); if (a > 0) { ctx.strokeStyle = C(col, 0.5 * a); ctx.stroke(p); } });
    ctx.restore();
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = C(rainbowAt(0)); ctx.stroke(outline);
  paths.forEach((p, k) => {
    const a = fadeOf(levels[k]);
    if (a <= 0) return;
    ctx.globalAlpha = a; ctx.strokeStyle = C(rainbowAt(levels[k] / reach)); ctx.stroke(p);
  });
  ctx.globalAlpha = 1;

  // the ring of light through the orb
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.05);
  ctx.strokeStyle = C([0.9, 0.13, 92], 0.85); ctx.lineWidth = Math.max(1, S * 0.0055);
  ctx.beginPath(); ctx.ellipse(0, 0, S * 0.46, S * 0.042, 0, 0, TAU); ctx.stroke();
  ctx.restore();

  // the orb at the centre of the skull
  const pr = S * 0.07 * (1 + 0.06 * Math.sin(TAU * ph * 2));
  ctx.globalCompositeOperation = "screen";
  const og = ctx.createRadialGradient(cx, cy, 0, cx, cy, pr * 1.8);
  og.addColorStop(0, C([0.99, 0.03, 95], 1)); og.addColorStop(0.25, C([0.92, 0.14, 88], 0.95)); og.addColorStop(0.55, C([0.7, 0.22, 350], 0.45)); og.addColorStop(1, C([0.6, 0.2, 300], 0));
  ctx.fillStyle = og; ctx.beginPath(); ctx.arc(cx, cy, pr * 1.8, 0, TAU); ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  glint(ctx, cx, cy, pr * 2.6, [0.99, 0.02, 95], 0.85);

  if (o.titles) {
    // the name in an inline face whose stripes run like the contours
    const backing = ctx.createLinearGradient(0, S * 0.76, 0, S);
    backing.addColorStop(0, C([0.15, 0.05, 275], 0)); backing.addColorStop(0.4, C([0.13, 0.045, 275], 0.94)); backing.addColorStop(1, C([0.12, 0.04, 275], 0.97));
    ctx.fillStyle = backing; ctx.fillRect(0, S * 0.76, S, S * 0.24);
    let size = S * 0.17;
    ctx.font = `400 ${size}px "Monoton", sans-serif`;
    const w = ctx.measureText("FOCUS").width;
    if (w > S * 0.78) { size *= (S * 0.78) / w; ctx.font = `400 ${size}px "Monoton", sans-serif`; }
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    const tg = ctx.createLinearGradient(S * 0.1, 0, S * 0.9, 0);
    for (const [t, col] of RAINBOW.slice(0, 6)) tg.addColorStop(t / 0.86, C(col));
    ctx.fillStyle = tg; ctx.fillText("FOCUS", S / 2, S * 0.935);
  }
  tape(ctx, S, kit, 0.18);
};

/** Speckled black, like a scuffed record sleeve: fixed scuffs and a little dust that comes and goes. */
function scuffs(ctx: Ctx, S: number, ph: number, seed: string, a = 1) {
  const r = rng(hash(seed)), frame = Math.floor(ph * 48);
  for (let i = 0; i < 420; i++) {
    const x = r() * S, y = r() * S, w = S * (0.0015 + r() * r() * 0.006), h = S * (0.0015 + r() * 0.003), live = r() < 0.15, on = r();
    if (live && ((frame * 7 + i) % 5) > 1) continue;
    ctx.fillStyle = C([0.95, 0.01, 90], (0.12 + on * 0.4) * a);
    ctx.fillRect(x, y, w, h);
  }
}

/** a and b blended, t of the way from a to b, into the scratch canvas `key`. */
function crossfade(kit: Kit, S: number, a: CanvasImageSource, b: CanvasImageSource, t: number, key: string): HTMLCanvasElement {
  const c = kit.scratch(key, S), x = kit.ctxOf(c);
  x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, S, S); x.globalCompositeOperation = "lighter";
  x.globalAlpha = 1 - t; x.drawImage(a, 0, 0); x.globalAlpha = t; x.drawImage(b, 0, 0);
  x.globalAlpha = 1; x.globalCompositeOperation = "source-over";
  return c;
}

/**
 * Focus, the other way (after Chill Out): the word in a seventies script, mustard over a deep
 * red drop, on a scuffed black sleeve. Once a loop the lens racks gently: the right of the
 * word slides softly out of focus and back, the left staying sharp.
 */
export const script: MixDraw = (ctx, S, ph, o, kit) => {
  ctx.fillStyle = C([0.17, 0.006, 60]); ctx.fillRect(0, 0, S, S);
  scuffs(ctx, S, ph, "mix|focus|chill", 0.7);
  const face = [0.79, 0.15, 72], drop = [0.55, 0.21, 28];
  // the lettering, sharp, centred on its own box (the face and its drop together)
  const A = kit.scratch("chill-a", S), a = kit.ctxOf(A);
  a.setTransform(1, 0, 0, 1, 0, 0); a.clearRect(0, 0, S, S);
  const depth = S * 0.04, steps = 18;
  a.translate(S / 2, S / 2); a.rotate(-0.16);
  if (o.titles) {
    let size = S * 0.36;
    a.font = `400 ${size}px "Lobster", cursive`; a.textAlign = "center"; a.textBaseline = "alphabetic";
    let m = a.measureText("Focus");
    if (m.width > S * 0.78) { size *= (S * 0.78) / m.width; a.font = `400 ${size}px "Lobster", cursive`; m = a.measureText("Focus"); }
    const left = m.actualBoundingBoxLeft ?? m.width / 2, right = m.actualBoundingBoxRight ?? m.width / 2;
    const asc = m.actualBoundingBoxAscent ?? size * 0.75, desc = m.actualBoundingBoxDescent ?? 0;
    const x0 = -((right - left) / 2 + depth / 2), y0 = -((desc - asc) / 2 + depth / 2);
    a.fillStyle = C(drop);
    for (let k = steps; k >= 1; k--) a.fillText("Focus", x0 + (depth * k) / steps, y0 + (depth * k) / steps);
    a.fillStyle = C(face); a.fillText("Focus", x0, y0);
  } else {
    // seventies stripes bending round, with the same drop
    const bands = [[0.79, 0.15, 72], [0.68, 0.18, 48], [0.55, 0.21, 28]];
    for (let k = 14; k >= 0; k--) {
      const d = (depth * k) / 14 - depth / 2;
      bands.forEach((col, i) => {
        a.strokeStyle = C(k ? drop : col); a.lineWidth = S * 0.05; a.lineCap = "round";
        a.beginPath(); a.arc(d, d + S * 0.1, S * (0.3 - i * 0.07), Math.PI * 1.05, Math.PI * 1.95); a.stroke();
      });
    }
  }
  a.setTransform(1, 0, 0, 1, 0, 0);
  // the rack: soft on the right, easing out of focus, holding, and easing back; sharp at the still
  const w = 0.8 * holdPulse(ph, 0.12, 0.4, 0.6, 0.88, ease);
  if (w < 0.01) ctx.drawImage(A, 0, 0);
  else {
    const B1 = blurred(kit, S, A, 6, "chill-b1"), B2 = blurred(kit, S, A, 14, "chill-b2");
    const soft = w < 0.5 ? crossfade(kit, S, A, B1, w * 2, "chill-soft") : crossfade(kit, S, B1, B2, w * 2 - 1, "chill-soft");
    const ramp = (key: string, img: CanvasImageSource, flip: boolean) => {
      const c = kit.scratch(key, S), x = kit.ctxOf(c);
      x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = "source-over"; x.clearRect(0, 0, S, S); x.drawImage(img, 0, 0);
      const g = x.createLinearGradient(S * 0.5, 0, S * 0.86, 0);
      g.addColorStop(0, flip ? "rgba(0, 0, 0, 1)" : "rgba(0, 0, 0, 0)"); g.addColorStop(1, flip ? "rgba(0, 0, 0, 0)" : "rgba(0, 0, 0, 1)");
      x.globalCompositeOperation = "destination-in"; x.fillStyle = g; x.fillRect(0, 0, S, S); x.globalCompositeOperation = "source-over";
      return c;
    };
    const sharpPart = ramp("chill-l", A, true), softPart = ramp("chill-r", soft, false);
    const L = kit.scratch("chill-out", S), l = kit.ctxOf(L);
    l.setTransform(1, 0, 0, 1, 0, 0); l.clearRect(0, 0, S, S); l.globalCompositeOperation = "lighter";
    l.drawImage(sharpPart, 0, 0); l.drawImage(softPart, 0, 0); l.globalCompositeOperation = "source-over";
    ctx.drawImage(L, 0, 0);
  }
  // the scuffs run over the lettering too
  scuffs(ctx, S, ph, "mix|focus|chill|top", 0.35);
  kit.grain(ctx, S, 0.16);
};
