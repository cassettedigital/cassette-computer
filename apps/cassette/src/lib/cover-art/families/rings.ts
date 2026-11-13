import { C, TAU, CREAM, rainbow } from "../color";
import type { Col } from "../color";
import type { FamilyDraw } from "../kit";
import { fill, fitSize, twoLines } from "../kit";
import { F } from "../fonts";

export const draw: FamilyDraw = (ctx, S, p, name, r, ph, o, kit) => {
  const w = TAU * ph, roll = r(), mode = roll < 0.5 ? "hoops" : roll < 0.8 ? "stack" : "tunnel";
  fill(ctx, S, [0.16, 0.012, p.ink[2]]);
  const lines = twoLines(name.toUpperCase(), 10);
  if (mode === "hoops") {
    // the name on a rod with rainbow hoops sliding along it forever: each hoop opens up as it moves away from the middle,
    // its far half passing behind the letters and its near half in front
    const size = Math.min(...lines.map(l => fitSize(ctx, l, F.heavy, 400, S * 0.84, S * 0.22)));
    ctx.font = `400 ${size}px ${F.heavy}`; ctx.textAlign = "center";
    const cap = size * 0.72, lead = size * 0.95, blockH = cap + (lines.length - 1) * lead, cy = S * 0.47, base0 = cy - blockH / 2 + cap;
    const N = 9, travel = S * 1.5, ry = blockH / 2 + S * 0.08;
    const hoops = Array.from({ length: N }, (_, k) => {
      const x = ((k / N + ph) % 1) * travel - S * 0.25, off = (x - S / 2) / (S * 0.5);
      return { x, rx: Math.max(S * 0.004, Math.abs(off) * S * 0.13), side: off >= 0 ? 1 : -1, col: rainbow(p, k / (N - 1)) };
    });
    ctx.lineWidth = Math.max(1.4, S * 0.01);
    const half = (h: { x: number; rx: number; side: number; col: Col }, front: boolean) => {
      const start = (front ? h.side > 0 : h.side < 0) ? -Math.PI / 2 : Math.PI / 2;
      ctx.strokeStyle = C(h.col, front ? 1 : 0.5); ctx.beginPath(); ctx.ellipse(h.x, cy, h.rx, ry, 0, start, start + Math.PI); ctx.stroke();
    };
    hoops.forEach(h => half(h, false));
    ctx.fillStyle = C(CREAM); lines.forEach((l, i) => ctx.fillText(l, S / 2, base0 + i * lead));
    hoops.forEach(h => half(h, true));
  } else {
    const size = Math.min(...lines.map(l => fitSize(ctx, l, F.heavy, 400, S * 0.86, S * 0.2)));
    ctx.font = `400 ${size}px ${F.heavy}`; ctx.fillStyle = C(CREAM); ctx.textAlign = "center";
    lines.forEach((l, i) => ctx.fillText(l, S / 2, S * 0.07 + size * 0.74 + i * size * 0.92));
    const top = S * 0.07 + size * 0.74 + (lines.length - 1) * size * 0.92 + S * 0.07;
    const N = 7 + Math.floor(r() * 4), rx = S * (0.34 + r() * 0.06), ry = S * (0.05 + r() * 0.02);
    ctx.lineWidth = Math.max(1.2, S * 0.0065);
    // the rings ripple like a slinky, each a beat behind the one above
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1), wave = Math.sin(w * 2 + i * 0.6);
      ctx.strokeStyle = C(rainbow(p, t)); ctx.beginPath();
      if (mode === "tunnel") { const k = 1 - t * 0.78; ctx.ellipse(S / 2, top + (S * 0.88 - top) * 0.5 + S * 0.03 * t + S * 0.025 * wave, rx * k, ry * 1.5 * k * (1 + 0.3 * wave), 0, 0, TAU); }
      else { const gap = (S * 0.88 - top - ry * 2) / (N - 1); ctx.ellipse(S / 2, top + ry + i * gap + S * 0.025 * wave, rx * (1 - 0.04 * wave), ry * (1 + 0.35 * Math.sin(w * 2 + i * 0.6 + 1.2)), 0, 0, TAU); }
      ctx.stroke();
    }
  }
  kit.grain(ctx, S, 0.18);
};
