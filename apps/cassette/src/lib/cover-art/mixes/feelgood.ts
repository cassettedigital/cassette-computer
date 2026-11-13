import { C, TAU } from "../color";
import { sparkle } from "../kit";
import type { Ctx } from "../kit";
import { rng, hash } from "../rng";
import { tape, type MixDraw } from "./util";

const CONDENSED = '"Bebas Neue", "Anton", sans-serif';

/** A beat that lands and settles: 1 on the hit, easing back to 0 before the next. */
function bounce(ph: number, beats: number, offset = 0) {
  const u = (((ph * beats + offset) % 1) + 1) % 1;
  return Math.pow(1 - u, 3);
}

/**
 * Feel Good, full jazzercise: a peach sleeve thrown with Memphis shapes (a mint triangle, a
 * pink slab, a zigzag, a squiggle, a dotted disc) and confetti, the name in fat italic capitals
 * with a deep teal drop. Everything bounces on the beat; the confetti falls.
 */
export const memphis: MixDraw = (ctx, S, ph, o, kit) => {
  const r = rng(hash("mix|feel-good|memphis"));
  ctx.fillStyle = C([0.86, 0.06, 62]); ctx.fillRect(0, 0, S, S);
  const mint = [0.84, 0.085, 170], pink = [0.75, 0.14, 2], teal = [0.46, 0.08, 195], yellow = [0.88, 0.15, 95], blue = [0.6, 0.15, 262], ink = [0.2, 0.02, 280];
  const b1 = bounce(ph, 8), b2 = bounce(ph, 8, 0.5);
  const poly = (pts: number[][], col: number[], dx = 0, dy = 0) => {
    ctx.fillStyle = C(col); ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * S + dx, y * S + dy) : ctx.moveTo(x * S + dx, y * S + dy))); ctx.closePath(); ctx.fill();
  };
  // the big mint triangle up top and the pink slab underfoot, each with a hard shadow
  const lift = -S * 0.012 * b1;
  poly([[0.06, 0.1], [0.98, 0.0], [0.5, 0.46]], teal, S * 0.014, S * 0.014 + lift);
  poly([[0.06, 0.1], [0.98, 0.0], [0.5, 0.46]], mint, 0, lift);
  poly([[0.22, 0.86], [1.04, 0.68], [1.04, 1.04], [0.4, 1.04]], [0.6, 0.15, 5], S * 0.012, S * 0.012 - S * 0.01 * b2);
  poly([[0.22, 0.86], [1.04, 0.68], [1.04, 1.04], [0.4, 1.04]], pink, 0, -S * 0.01 * b2);
  // a dotted disc
  const dx = S * 0.17, dy = S * 0.75 - S * 0.015 * b2;
  ctx.fillStyle = C(yellow); ctx.beginPath(); ctx.arc(dx, dy, S * 0.09, 0, TAU); ctx.fill();
  ctx.fillStyle = C(ink, 0.85);
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) { const x = dx + i * S * 0.024, y = dy + j * S * 0.024; if (Math.hypot(x - dx, y - dy) < S * 0.08) { ctx.beginPath(); ctx.arc(x, y, S * 0.0045, 0, TAU); ctx.fill(); } }
  // a black zigzag and a blue squiggle, wriggling
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = C(ink); ctx.lineWidth = S * 0.012; ctx.beginPath();
  for (let i = 0; i <= 6; i++) { const x = S * (0.7 + i * 0.035), y = S * (0.52 + (i % 2 ? -0.03 : 0.03) * (1 + 0.25 * b1)); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
  ctx.stroke();
  ctx.strokeStyle = C(blue); ctx.lineWidth = S * 0.011; ctx.beginPath();
  for (let i = 0; i <= 40; i++) { const t = i / 40, x = S * (0.05 + t * 0.24), y = S * (0.5 + 0.025 * Math.sin(t * TAU * 2 + TAU * ph * 2)); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
  ctx.stroke();
  // confetti, falling one frame-height a loop
  const tones = [pink, mint, yellow, blue, teal];
  for (let i = 0; i < 130; i++) {
    const x = r() * S, y0 = r(), rad = S * (0.003 + r() * r() * 0.01), col = tones[Math.floor(r() * tones.length)], sp = 1 + Math.floor(r() * 2);
    const y = ((y0 + ph * sp) % 1) * S;
    ctx.fillStyle = C(col, 0.9); ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill();
  }
  if (o.titles) {
    // FEEL / GOOD in fat italic capitals, white with a deep teal drop to the lower left
    let size = S * 0.31;
    ctx.font = `400 ${size}px ${CONDENSED}`;
    const w = Math.max(ctx.measureText("FEEL").width, ctx.measureText("GOOD").width);
    if (w > S * 0.62) { size *= (S * 0.62) / w; ctx.font = `400 ${size}px ${CONDENSED}`; }
    ctx.save(); ctx.translate(S * 0.5, S * 0.5 - S * 0.012 * b1); ctx.transform(1, 0, -0.2, 1, 0, 0);
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    const lines: [string, number][] = [["FEEL", -size * 0.06], ["GOOD", size * 0.82]];
    const depth = S * 0.024;
    for (let k = 10; k >= 1; k--) { ctx.fillStyle = C(teal); for (const [t, y] of lines) ctx.fillText(t, (-depth * k) / 10, y + (depth * k) / 10); }
    ctx.fillStyle = C([0.99, 0.01, 90]); for (const [t, y] of lines) ctx.fillText(t, 0, y);
    ctx.restore();
  }
  // a couple of studio sparkles
  ctx.fillStyle = C([0.99, 0.01, 90]);
  sparkle(ctx, S * 0.86, S * 0.2, S * 0.035 * (0.6 + 0.4 * b2)); sparkle(ctx, S * 0.14, S * 0.3, S * 0.022 * (0.6 + 0.4 * b1));
  kit.grain(ctx, S, 0.16);
};

/** A rounded bar, for the stage lights when the cover carries no name. */
function bar(c: Ctx, x: number, y: number, w: number, h: number, rad: number) {
  c.beginPath(); c.moveTo(x + rad, y); c.arcTo(x + w, y, x + w, y + h, rad); c.arcTo(x + w, y + h, x, y + h, rad);
  c.arcTo(x, y + h, x, y, rad); c.arcTo(x, y, x + w, y, rad); c.closePath(); c.fill();
}

/**
 * Feel Good, smeared (after NO LIMITS and KEEP GOING): FEEL over GOOD in white, glowing, the
 * letters' edges pulled out into liquid ribbons of colour, down from GOOD's feet and up from
 * FEEL's heads, the way a pixel stretch pulls an image. Each ribbon is a row of the letters
 * themselves, taken just inside the edge and drawn out line by line, so it is exactly as wide
 * as the stroke it leaves and starts under it. Straight where they leave the letters, the
 * ribbons sway more the further they run, and the colours flow out along them.
 */
export const smear: MixDraw = (ctx, S, ph, o, kit) => {
  const r = rng(hash("mix|feel-good|dust"));
  ctx.fillStyle = C([0.08, 0.012, 290]); ctx.fillRect(0, 0, S, S);
  const font = (px: number) => `400 ${px}px "Anton", "Bebas Neue", sans-serif`;
  // letters spaced apart, so each pours its own ribbon
  const tracked = (c: Ctx, t: string, px: number) => { c.font = font(px); return [...t].reduce((sum, ch) => sum + c.measureText(ch).width, 0) + px * 0.16 * (t.length - 1); };
  let size = S * 0.23;
  const w = Math.max(tracked(ctx, "FEEL", size), tracked(ctx, "GOOD", size));
  if (w > S * 0.74) size *= (S * 0.74) / w;
  const y1 = S * 0.5 - size * 0.06, y2 = S * 0.5 + size * 0.86;
  const layout = (c: Ctx) => {
    c.textAlign = "left"; c.textBaseline = "alphabetic";
    if (o.titles) for (const [t, y] of [["FEEL", y1], ["GOOD", y2]] as [string, number][]) {
      let x = S / 2 - tracked(c, t, size) / 2;
      for (const ch of t) { c.fillText(ch, x, y); x += c.measureText(ch).width + size * 0.16; }
    } else for (let i = 0; i < 6; i++) bar(c, S * (0.17 + i * 0.12), S * 0.47, S * 0.06, S * 0.06, S * 0.012);
  };
  // where the ribbons leave: FEEL's top edge and GOOD's foot, and a band just inside each
  ctx.font = font(size);
  const topEdge = Math.round(o.titles ? y1 - (ctx.measureText("FEEL").actualBoundingBoxAscent ?? size * 0.73) : S * 0.47);
  const footEdge = Math.round(o.titles ? y2 + (ctx.measureText("GOOD").actualBoundingBoxDescent ?? 0) : S * 0.53);
  const band = Math.max(2, Math.round(o.titles ? size * 0.14 : S * 0.02));
  const topRow = topEdge + band, footRow = footEdge - band;

  // the letters as a white mask, to take the rows from
  const M = kit.scratch("smear-mask", S), m = kit.ctxOf(M);
  m.setTransform(1, 0, 0, 1, 0, 0); m.globalCompositeOperation = "source-over"; m.clearRect(0, 0, S, S); m.fillStyle = "#fff";
  layout(m);
  // each ribbon's cross-section: every row of the band laid on one line, so a column is inked if
  // the letter is anywhere in it. One row alone would split at a notch, like the gap in the G's foot.
  const footprint = (key: string, rows: number[]) => {
    const F = kit.scratch(key, S, 1), f = kit.ctxOf(F);
    f.setTransform(1, 0, 0, 1, 0, 0); f.globalCompositeOperation = "source-over"; f.clearRect(0, 0, S, 1);
    f.globalCompositeOperation = "lighter";
    for (const y of rows) f.drawImage(M, 0, y, S, 1, 0, 0, S, 1);
    f.globalCompositeOperation = "source-over";
    return F;
  };
  const span = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const footSrc = footprint("smear-foot", span(footRow, footEdge)), topSrc = footprint("smear-top", span(topEdge, topRow));

  // the ribbons, drawn out a line at a time from that one row
  const L = kit.scratch("smear-run", S), l = kit.ctxOf(L);
  l.setTransform(1, 0, 0, 1, 0, 0); l.globalCompositeOperation = "source-over"; l.globalAlpha = 1; l.clearRect(0, 0, S, S);
  l.imageSmoothingEnabled = true;
  const step = Math.max(1, S / 320);
  const pour = (src: CanvasImageSource, from: number, to: number, seed: number) => {
    const dir = Math.sign(to - from), len = Math.abs(to - from);
    for (let d = 0; d <= len + step; d += step) {
      const t = Math.min(1, d / len), y = from + dir * d;
      const sway = S * (0.05 * t * t * Math.sin(TAU * (t * 1.1 - ph * 2) + seed) + 0.012 * t * Math.sin(TAU * (t * 2.7 - ph * 3) + seed * 2));
      const wd = S * (1 + 0.28 * t * t);
      l.drawImage(src, 0, 0, S, 1, S / 2 - wd / 2 + sway, dir > 0 ? y : y - step, wd, step + 0.6);
    }
  };
  pour(footSrc, footRow, S, 0);
  pour(topSrc, topRow, 0, 2.1);

  // colour: the rainbow flowing out along each set of ribbons, mixed a little across them
  l.globalCompositeOperation = "source-atop";
  const flow = (from: number, to: number, h0: number) => {
    const g = l.createLinearGradient(0, from, 0, to);
    for (let i = 0; i <= 10; i++) { const t = i / 10; g.addColorStop(t, C([0.76 - 0.06 * t, 0.2, (((h0 - t * 420 + ph * 360) % 360) + 360) % 360])); }
    l.fillStyle = g; l.fillRect(0, Math.min(from, to), S, Math.abs(to - from));
  };
  flow(footRow, S, 330);
  flow(topRow, 0, 200);
  const across = l.createLinearGradient(0, 0, S, 0);
  for (let i = 0; i <= 6; i++) across.addColorStop(i / 6, C([0.74, 0.2, (i * 60 + ph * 360) % 360]));
  l.globalAlpha = 0.35; l.fillStyle = across; l.fillRect(0, 0, S, S); l.globalAlpha = 1;
  // brightest where they leave the letters, as if lit from inside them
  for (const [from, to] of [[footEdge, footEdge + S * 0.06], [topEdge, topEdge - S * 0.06]]) {
    const lit = l.createLinearGradient(0, from, 0, to);
    lit.addColorStop(0, "rgba(255, 248, 240, 0.4)"); lit.addColorStop(1, "rgba(255, 248, 240, 0)");
    l.fillStyle = lit; l.fillRect(0, Math.min(from, to), S, Math.abs(to - from));
  }
  l.globalCompositeOperation = "source-over";

  // a soft glow under the ribbons, then the ribbons themselves
  const q = Math.max(8, Math.round(S / 6)), Q = kit.scratch("smear-glow", q), qc = kit.ctxOf(Q);
  qc.setTransform(1, 0, 0, 1, 0, 0); qc.clearRect(0, 0, q, q); qc.imageSmoothingEnabled = true; qc.drawImage(L, 0, 0, q, q);
  ctx.save(); ctx.imageSmoothingEnabled = true; ctx.globalCompositeOperation = "screen"; ctx.globalAlpha = 0.7; ctx.drawImage(Q, 0, 0, S, S); ctx.restore();
  ctx.drawImage(L, 0, 0);

  // the letters on top, white and glowing, with a faint split of colour like a worn tape
  ctx.save();
  ctx.shadowColor = "rgba(255, 240, 230, 0.7)"; ctx.shadowBlur = S * 0.03;
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = C([0.62, 0.23, 25], 0.7); ctx.translate(-S * 0.003, 0); layout(ctx);
  ctx.fillStyle = C([0.58, 0.2, 262], 0.7); ctx.translate(S * 0.006, 0); layout(ctx);
  ctx.restore();
  ctx.fillStyle = C([0.98, 0.01, 90]); layout(ctx);
  // dust
  for (let i = 0; i < 160; i++) { ctx.fillStyle = C([0.95, 0.01, 90], 0.15 + r() * 0.45); ctx.fillRect(r() * S, r() * S, S * (0.0015 + r() * r() * 0.005), S * 0.002); }
  tape(ctx, S, kit, 0.16);
};
