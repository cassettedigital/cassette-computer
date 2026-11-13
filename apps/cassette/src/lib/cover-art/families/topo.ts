import { C, TAU, CREAM } from "../color";
import type { FamilyDraw } from "../kit";
import { fill, fitSize } from "../kit";
import { F, MONO } from "../fonts";

export const draw: FamilyDraw = (ctx, S, p, name, r, ph, o, kit) => {
  fill(ctx, S, p.bg);
  const w = TAU * ph, G = 56;
  // the hill holds still; the four swells under it each make exactly one slow pass per loop
  const waves = Array.from({ length: 4 }, (_, k) => ({ fx: (2 + r() * 5) * (r() < 0.5 ? -1 : 1), fy: (2 + r() * 5) * (r() < 0.5 ? -1 : 1), phi: r() * TAU, m: [1, -1, 1, -1][k], a: [0.5, 0.3, 0.2, 0.12][k] }));
  const hx = 0.3 + r() * 0.4, hy = 0.3 + r() * 0.4;
  const v: number[] = []; let best = [-9, 0, 0];
  for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) {
    const x = i / G, y = j / G;
    let s = 0.9 * Math.exp(-((x - hx) ** 2 + (y - hy) ** 2) / 0.09);
    for (const q of waves) s += q.a * Math.sin(q.fx * x + q.fy * y + q.phi + q.m * w);
    v[j * (G + 1) + i] = s; if (s > best[0]) best = [s, x, y];
  }
  const at = (i: number, j: number) => v[j * (G + 1) + i], cs = S / G;
  const SEG = [[], [[3, 2]], [[2, 1]], [[3, 1]], [[0, 1]], [[3, 2], [0, 1]], [[0, 2]], [[3, 0]], [[3, 0]], [[0, 2]], [[0, 3], [2, 1]], [[0, 1]], [[3, 1]], [[2, 1]], [[3, 2]], []];
  const L = 14, lo = -0.9, hi = 1.5;
  for (let l = 0; l < L; l++) {
    const lv = lo + (hi - lo) * (l + 0.5) / L, index = l % 4 === 3;
    ctx.beginPath();
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      const k = (a > lv ? 8 : 0) | (b > lv ? 4 : 0) | (c > lv ? 2 : 0) | (d > lv ? 1 : 0);
      if (!k || k === 15) continue;
      const x = i * cs, y = j * cs;
      const e = [[x + cs * (lv - a) / (b - a), y], [x + cs, y + cs * (lv - b) / (c - b)], [x + cs * (lv - d) / (c - d), y + cs], [x, y + cs * (lv - a) / (d - a)]];
      for (const [m, n] of SEG[k]) { ctx.moveTo(e[m][0], e[m][1]); ctx.lineTo(e[n][0], e[n][1]); }
    }
    ctx.strokeStyle = index ? C(p.c2) : C(p.c1, 0.55); ctx.lineWidth = Math.max(1, S * (index ? 0.007 : 0.004)); ctx.stroke();
  }
  // spot height, the way a survey map marks a summit
  const sx = best[1] * S, sy = best[2] * S, tr = S * 0.022;
  ctx.fillStyle = C(p.c3); ctx.beginPath(); ctx.moveTo(sx, sy - tr); ctx.lineTo(sx + tr, sy + tr * 0.7); ctx.lineTo(sx - tr, sy + tr * 0.7); ctx.fill();
  ctx.font = `500 ${S * 0.045}px ${MONO}`; ctx.fillText((800 + Math.round(best[0] * 500)).toLocaleString("en-US"), sx + tr * 1.6, sy + tr * 0.6);
  if (o.titles) {
    // a survey map's title block: the name, a scale bar and a north arrow, boxed in the corner
    const t = name.toUpperCase(), bx = S * 0.06, bw = S * 0.56, bh = S * 0.19, by = S - bh - S * 0.06, pd = S * 0.025;
    ctx.fillStyle = C(p.bg, 0.94); ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = C(p.c1, 0.85); ctx.lineWidth = Math.max(1, S * 0.003); ctx.strokeRect(bx, by, bw, bh); ctx.strokeRect(bx + S * 0.008, by + S * 0.008, bw - S * 0.016, bh - S * 0.016);
    const fs = fitSize(ctx, t, F.grotesk, 700, bw * 0.7, S * 0.06);
    ctx.font = `700 ${fs}px ${F.grotesk}`; ctx.fillStyle = C(CREAM); ctx.textAlign = "left"; ctx.fillText(t, bx + pd, by + pd + fs * 0.85);
    const sbx = bx + pd, sby = by + bh - pd - S * 0.03, seg = bw * 0.1;
    for (let i = 0; i < 4; i++) { ctx.fillStyle = C(i % 2 ? p.bg : CREAM); ctx.fillRect(sbx + i * seg, sby, seg, S * 0.012); }
    ctx.strokeStyle = C(CREAM, 0.9); ctx.strokeRect(sbx, sby, seg * 4, S * 0.012);
    ctx.font = `400 ${S * 0.022}px ${F.tiny}`; ctx.fillStyle = C(CREAM, 0.8); ctx.fillText("0", sbx - S * 0.004, sby + S * 0.035);
    ctx.textAlign = "right"; ctx.fillText("2 KM", sbx + seg * 4 + S * 0.01, sby + S * 0.035); ctx.textAlign = "left";
    const nx = bx + bw - pd - S * 0.03, ny = by + bh * 0.6;
    ctx.fillStyle = C(p.c1); ctx.beginPath(); ctx.moveTo(nx, ny - S * 0.045); ctx.lineTo(nx + S * 0.018, ny + S * 0.02); ctx.lineTo(nx, ny + S * 0.008); ctx.lineTo(nx - S * 0.018, ny + S * 0.02); ctx.closePath(); ctx.fill();
    ctx.font = `700 ${S * 0.03}px ${F.grotesk}`; ctx.textAlign = "center"; ctx.fillText("N", nx, ny - S * 0.055); ctx.textAlign = "left";
  }
  kit.grain(ctx, S, 0.08);
};
