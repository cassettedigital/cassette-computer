import { C, mix, ease, TAU, WHITE } from "../color";
import type { FamilyDraw } from "../kit";
import { fill, disc, fitSize, twoLines } from "../kit";
import { F } from "../fonts";

type Fold = { x: number; y: number; hinge: number[][]; free: number[]; moving: boolean; slot: number };

export const draw: FamilyDraw = (ctx, S, p, name, r, ph, o, kit) => {
  const n = [4, 5, 6][Math.floor(r() * 3)], cs = S / n;
  const under = mix(p.c2, p.bg, 0.6), front = p.c1, back = p.c2;
  fill(ctx, S, under);
  const tiles: Fold[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const diag = r() < 0.5, side = r() < 0.5, moving = r() < 0.3, slot = r();
    // the crease runs corner to corner; the free corner folds over it and lands on its mirror image
    const hinge = diag ? [[1, 0], [0, 1]] : [[0, 0], [1, 1]];
    const free = diag ? (side ? [0, 0] : [1, 1]) : (side ? [1, 0] : [0, 1]);
    tiles.push({ x: i * cs, y: j * cs, hinge, free, moving, slot });
  }
  const D = 0.12, HOLD = 0.5;
  const fold = (t: Fold, k: number) => {
    const c = Math.cos(Math.PI * k), P = (v: number[]): [number, number] => [t.x + v[0] * cs, t.y + v[1] * cs];
    const tip = [0.5 + (t.free[0] - 0.5) * c, 0.5 + (t.free[1] - 0.5) * c];
    if (k > 0 && k < 1) {
      ctx.fillStyle = `rgba(0, 0, 0, ${0.3 * Math.sin(Math.PI * k)})`;
      ctx.beginPath(); ctx.moveTo(...P(t.hinge[0])); ctx.lineTo(...P(t.hinge[1])); ctx.lineTo(...P([tip[0] + 0.05, tip[1] + 0.08])); ctx.fill();
    }
    const face = c >= 0 ? front : back, lit = 0.5 + 0.5 * Math.abs(c);
    ctx.fillStyle = C([face[0] * lit + 0.03, face[1], face[2]]);
    ctx.beginPath(); ctx.moveTo(...P(t.hinge[0])); ctx.lineTo(...P(t.hinge[1])); ctx.lineTo(...P(tip)); ctx.closePath(); ctx.fill();
    // the little dot printed on the front, travelling with the fold
    if (c > 0.05) { ctx.fillStyle = C(p.c3, Math.min(1, c * 1.5)); disc(ctx, ...P([0.5 + (tip[0] - 0.5) * 0.5, 0.5 + (tip[1] - 0.5) * 0.5]), cs * 0.075 * Math.sqrt(c)); }
    ctx.strokeStyle = C(p.c3, 0.14); ctx.lineWidth = Math.max(1, S * 0.003);
    ctx.beginPath(); ctx.moveTo(...P(t.hinge[0])); ctx.lineTo(...P(t.hinge[1])); ctx.stroke();
  };
  // folds in progress are drawn last, so they lie on top of their neighbours
  const active: [Fold, number][] = [];
  for (const t of tiles) {
    let k = 0;
    if (t.moving) { const u = (((ph - t.slot) % 1) + 1) % 1; k = u < D ? ease(u / D) : u < HOLD ? 1 : u < HOLD + D ? 1 - ease((u - HOLD) / D) : 0; }
    if (k > 0 && k < 1) active.push([t, k]); else fold(t, k);
  }
  for (const [t, k] of active) fold(t, k);
  if (o.titles) {
    // the name printed across a pleated band of paper, its folds catching the light in turn
    const w = TAU * ph, K = 10, fw = S / K, bh = S * 0.25, by = S / 2 - bh / 2, paper = mix(p.c3, WHITE, 0.25);
    const lift = (k: number) => (k % 2 ? 1 : -1) * S * 0.01 * (1 + 0.4 * Math.sin(w + k * 0.6));
    ctx.fillStyle = "rgba(0, 0, 0, 0.28)"; ctx.fillRect(0, by + bh + S * 0.006, S, S * 0.02);
    const band = kit.path(); band.moveTo(0, by + lift(0));
    for (let k = 1; k <= K; k++) band.lineTo(k * fw, by + lift(k));
    for (let k = K; k >= 0; k--) band.lineTo(k * fw, by + bh + lift(k));
    band.closePath();
    ctx.fillStyle = C(paper); ctx.fill(band);
    ctx.save(); ctx.clip(band);
    const lines = twoLines(name.toUpperCase(), 12);
    const size = Math.min(...lines.map((l) => fitSize(ctx, l, F.heavy, 400, S * 0.86, bh * 0.78 / (lines.length * 0.86))));
    ctx.font = `400 ${size}px ${F.heavy}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = C(p.ink);
    lines.forEach((l, i) => ctx.fillText(l, S / 2, S / 2 + (i - (lines.length - 1) / 2) * size * 0.9 + size * 0.04));
    for (let k = 0; k < K; k++) { const sh = k % 2 ? 0.16 + 0.05 * Math.sin(w + k) : 0.02; ctx.fillStyle = `rgba(0, 0, 0, ${sh})`; ctx.fillRect(k * fw, 0, fw + 0.5, S); }
    ctx.restore(); ctx.textBaseline = "alphabetic";
  }
  kit.grain(ctx, S, 0.1);
};
