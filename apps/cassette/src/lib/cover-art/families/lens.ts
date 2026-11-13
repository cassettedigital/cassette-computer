import { C, mix, TAU } from "../color";
import type { FamilyDraw } from "../kit";
import { fill, disc } from "../kit";
import { F } from "../fonts";

export const draw: FamilyDraw = (ctx, S, p, name, r, ph, o, kit) => {
  fill(ctx, S, p.bg);
  const T = o.titles, w = TAU * ph, sr = r(), stripes = !T && sr < 0.4, nn = 11 + Math.floor(r() * 6), n = T ? 30 : nn, R = S * (0.26 + r() * 0.12);
  const orb = S * (0.1 + r() * 0.1), c0x = S * (0.4 + r() * 0.2), c0y = S * (0.4 + r() * 0.2), k = 0.8 + r() * 0.5;
  const lx = c0x + orb * Math.cos(w), ly = c0y + orb * Math.sin(w);
  const g = (x: number, y: number) => Math.exp(-((x - lx) ** 2 + (y - ly) ** 2) / (R * R));
  if (!stripes) {
    // with titles on the grid gets finer and the letters are picked out in the light ink, swelling under the lens with everything else
    const cell = S / n, mask = T ? kit.textMask(name, 120, F.heavy, 400, 0.88, 0.62) : null;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const x = (i + 0.5) * cell, y = (j + 0.5) * cell, gv = g(x, y), tv = mask ? mask(x / S, y / S) : 0;
      ctx.fillStyle = C(tv > 0.5 ? p.c3 : mix(p.c1, p.c2, gv));
      disc(ctx, x + (x - lx) * gv * k * 0.5, y + (y - ly) * gv * k * 0.5, cell * (T ? 0.3 : 0.17) * (1 + (T ? 1.1 : 2.3) * gv) * (tv > 0.5 ? 1.15 : 1));
    }
  } else {
    const grad = ctx.createRadialGradient(lx, ly, 0, lx, ly, R * 1.4);
    grad.addColorStop(0, C(p.c2)); grad.addColorStop(1, C(p.c1));
    ctx.fillStyle = grad;
    const bh = S / (n * 2), Y = (y: number, x: number) => y + (y - ly) * g(x, y) * k * 0.9;
    for (let b = -1; b < n + 1; b++) {
      const y0 = b * 2 * bh, y1 = y0 + bh;
      ctx.beginPath();
      for (let x = 0; x <= S; x += S / 80) ctx.lineTo(x, Y(y0, x));
      for (let x = S; x >= 0; x -= S / 80) ctx.lineTo(x, Y(y1, x));
      ctx.closePath(); ctx.fill();
    }
  }
  kit.grain(ctx, S, 0.08);
};
