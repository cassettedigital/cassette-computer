import { C, TAU, CREAM } from "../color";
import type { FamilyDraw } from "../kit";
import { fill, spacedText } from "../kit";
import { F } from "../fonts";

export const draw: FamilyDraw = (ctx, S, p, name, r, ph, o, kit) => {
  fill(ctx, S, p.bg);
  const w = TAU * ph;
  const T = o.titles;
  const N = 24, pad = S * 0.1, top = T ? S * 0.28 : S * 0.22, bottom = S * 0.92, step = (bottom - top) / N;
  const hot = new Set([Math.floor(r() * N), Math.floor(r() * N)]);
  const fr = [3 + r() * 4, 9 + r() * 6, 17 + r() * 10];
  ctx.lineWidth = Math.max(1, S * 0.006); ctx.lineJoin = "round";
  for (let i = 0; i < N; i++) {
    const base = top + i * step, phs = [r() * TAU, r() * TAU, r() * TAU];
    const pts = [];
    for (let x = pad; x <= S - pad + 0.1; x += S / 140) {
      const t = (x - pad) / (S - 2 * pad);
      const env = Math.exp(-(((t - 0.5) / 0.19) ** 2));
      const n = Math.sin(t * fr[0] + phs[0] + w) * 0.5 + Math.sin(t * fr[1] + phs[1] - 2 * w) * 0.3 + Math.sin(t * fr[2] + phs[2] + 3 * w) * 0.2;
      pts.push([x, base - env * Math.abs(n) ** 1.4 * S * 0.13]);
    }
    ctx.beginPath(); pts.forEach(([x, y], k) => k ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.lineTo(S - pad, S); ctx.lineTo(pad, S); ctx.closePath(); ctx.fillStyle = C(p.bg); ctx.fill();
    ctx.beginPath(); pts.forEach(([x, y], k) => k ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.strokeStyle = hot.has(i) ? C(p.c2) : C(p.c1, 0.9); ctx.stroke();
  }
  if (T) {
    // set small and wide above the signal, the way a record sleeve would
    const t = name.toUpperCase(); let fs = S * 0.046;
    ctx.font = `500 ${fs}px ${F.grotesk}`;
    const wd = ctx.measureText(t).width + fs * 0.4 * (t.length - 1); if (wd > S * 0.8) { fs *= S * 0.8 / wd; ctx.font = `500 ${fs}px ${F.grotesk}`; }
    ctx.fillStyle = C(CREAM, 0.92); spacedText(ctx, t, S / 2, S * 0.13, fs * 0.4, "center");
  }
  kit.grain(ctx, S, 0.08);
};
