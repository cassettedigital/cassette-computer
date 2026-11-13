import { C, mix, TAU, WHITE } from "../color";
import type { Col } from "../color";
import type { FamilyDraw } from "../kit";
import { fill, fitSize } from "../kit";
import { F } from "../fonts";

export const draw: FamilyDraw = (ctx, S, p, name, r, ph, o, kit) => {
  fill(ctx, S, p.ink);
  const T = o.titles, cyS = T ? S * 0.58 : S / 2;
  const w = TAU * ph, pad = S * 0.06, g = (S - pad * 2) / 8;
  // the graticule: 8 divisions with minor ticks on the centre axes
  ctx.strokeStyle = C(p.c1, 0.12); ctx.lineWidth = Math.max(1, S * 0.003); ctx.beginPath();
  for (let i = 0; i <= 8; i++) { ctx.moveTo(pad + i * g, pad); ctx.lineTo(pad + i * g, S - pad); ctx.moveTo(pad, pad + i * g); ctx.lineTo(S - pad, pad + i * g); }
  for (let i = 0; i <= 40; i++) { const t = pad + i * g / 5; ctx.moveTo(t, S / 2 - S * 0.008); ctx.lineTo(t, S / 2 + S * 0.008); ctx.moveTo(S / 2 - S * 0.008, t); ctx.lineTo(S / 2 + S * 0.008, t); }
  ctx.stroke();
  const harmono = r() < 0.35, traces = r() < 0.4 ? 2 : 1;
  const pairs = [[1, 2], [2, 3], [3, 4], [3, 5], [1, 3], [4, 5], [5, 6], [2, 5]];
  ctx.globalCompositeOperation = "lighter"; ctx.lineJoin = "round"; ctx.lineCap = "round";
  for (let t = 0; t < traces; t++) {
    const [a, b] = pairs[Math.floor(r() * pairs.length)], d0 = r() * TAU, col = t ? p.c2 : p.c1, amp = S * (t ? 0.28 : 0.38) * (T ? 0.78 : 1);
    const N = harmono ? 2400 : 900, span = harmono ? TAU * 14 : TAU;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const s = i / N * span, decay = harmono ? Math.exp(-s * 0.035) : 1;
      const x = S / 2 + amp * decay * Math.sin(a * s + d0 + w), y = cyS + amp * decay * Math.sin((b + (harmono ? 0.012 : 0)) * s);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    for (const [lw, al, c] of [[0.03, 0.07, col], [0.012, 0.22, col], [0.004, 0.9, mix(col, [0.98, 0.02, col[2]], 0.5)]] as [number, number, Col][]) {
      ctx.strokeStyle = C(c, al); ctx.lineWidth = Math.max(1, S * lw * (harmono ? 0.6 : 1)); ctx.stroke();
    }
  }
  if (T) {
    // the name traced by the beam, as glowing vector strokes across the top of the screen
    const t = name.toUpperCase(), size = fitSize(ctx, t, F.wide, 500, S * 0.78, S * 0.12);
    ctx.font = `500 ${size}px ${F.wide}`; ctx.textAlign = "center"; ctx.lineJoin = "round";
    for (const [lw, al, c] of [[0.014, 0.1, p.c1], [0.006, 0.3, p.c1], [0.002, 0.95, mix(p.c1, WHITE, 0.5)]] as [number, number, Col][]) { ctx.strokeStyle = C(c, al); ctx.lineWidth = Math.max(1, S * lw); ctx.strokeText(t, S / 2, S * 0.21); }
  }
  ctx.globalCompositeOperation = "source-over";
  kit.grain(ctx, S, 0.07);
};
