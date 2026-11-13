import { C, TAU, CREAM, spectral } from "../color";
import type { FamilyDraw } from "../kit";
import { fill, fitSize, twoLines } from "../kit";
import { F } from "../fonts";

export const draw: FamilyDraw = (ctx, S, p, name, r, ph, o, kit) => {
  const w = TAU * ph, vertical = r() < 0.4 || !o.titles, ground = [0.17, 0.02, 50], vol = 1 + Math.floor(r() * 12);
  fill(ctx, S, ground);
  if (!vertical) {
    // spectral bands stepping right like a staircase, each sliding on its own, with a gig-poster lockup underneath
    const B = 4, bh = S * 0.68 / B;
    for (let i = 0; i < B; i++) {
      const len = S * (0.58 + r() * 0.14), x = S * (-0.14 + i * 0.17 + r() * 0.04) + S * 0.13 * Math.sin(w + i * 1.1);
      const g = ctx.createLinearGradient(x, 0, x + len, 0);
      g.addColorStop(0, C(ground, 0));
      for (let k = 1; k <= 9; k++) { const t = k / 10; g.addColorStop(t, C(spectral(p, t), Math.min(1, Math.sin(Math.PI * t) * 1.6))); }
      g.addColorStop(1, C(ground, 0));
      ctx.fillStyle = g; ctx.fillRect(0, i * bh, S, bh + 0.5);
    }
    kit.grain(ctx, S, 0.3);
    const lines = twoLines(name.toUpperCase(), 10);
    const size = Math.min(...lines.map(l => fitSize(ctx, l, F.grotesk, 500, S * 0.6, S * 0.1)), (S * 0.17) / (lines.length * 0.95));
    const lead = size * 0.95, baseLast = S * 0.91, ruleY = S * 0.7;
    ctx.fillStyle = C(CREAM, 0.85); ctx.fillRect(S * 0.07, ruleY, S * 0.86, Math.max(1, S * 0.003));
    ctx.font = `500 ${size}px ${F.grotesk}`; ctx.fillStyle = C(CREAM); ctx.textAlign = "left";
    lines.forEach((l, i) => ctx.fillText(l, S * 0.07, baseLast - (lines.length - 1 - i) * lead));
    // a little stacked tag beside the last line, the way a poster says DJ SET
    const lw = ctx.measureText(lines[lines.length - 1]).width;
    ctx.font = `500 ${size * 0.34}px ${F.grotesk}`;
    ctx.fillText("SIDE", S * 0.07 + lw + size * 0.12, baseLast - size * 0.38); ctx.fillText("A", S * 0.07 + lw + size * 0.12, baseLast);
    ctx.textAlign = "right"; ctx.font = `500 ${size * 0.4}px ${F.grotesk}`;
    ctx.fillText(`VOL. ${String(vol).padStart(2, "0")}`, S * 0.93, baseLast);
  } else {
    // mirrored bars of light, longest at the edges, breathing in a wave from the middle out
    const N = 11 + 2 * Math.floor(r() * 2), sw = S / N, c = (N - 1) / 2;
    for (let i = 0; i < N; i++) {
      const m = 1 - Math.abs(i - c) / c;
      const dark = S * (0.04 + 0.3 * m ** 1.4) + S * 0.075 * Math.sin(w + Math.abs(i - c) * 0.9) * (0.4 + m);
      const g = ctx.createLinearGradient(0, dark, 0, S - dark);
      g.addColorStop(0, C(ground));
      for (let k = 1; k <= 9; k++) { const t = k / 10; g.addColorStop(t, C(spectral(p, t))); }
      g.addColorStop(1, C(ground));
      ctx.fillStyle = g; ctx.fillRect(i * sw, dark, sw + 0.5, S - 2 * dark);
      ctx.fillStyle = "rgba(0, 0, 0, 0.22)"; ctx.fillRect(i * sw, 0, Math.max(1, S * 0.003), S);
    }
    if (o.titles) {
      // one letter to a bar, set dark across the white core, riding up and down with it
      const chars = [...name.toUpperCase()];
      ctx.fillStyle = C(p.ink, 0.88); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      if (chars.length <= N) {
        const start = Math.floor((N - chars.length) / 2);
        ctx.font = `700 ${sw * 0.9}px ${F.grotesk}`;
        chars.forEach((ch, i) => { const k = start + i, m = 1 - Math.abs(k - c) / c, dark = S * (0.04 + 0.3 * m ** 1.4) + S * 0.075 * Math.sin(w + Math.abs(k - c) * 0.9) * (0.4 + m); ctx.fillText(ch, (k + 0.5) * sw, dark + (S - 2 * dark) * 0.45); });
      } else { const size = fitSize(ctx, name.toUpperCase(), F.grotesk, 700, S * 0.9, S * 0.08); ctx.font = `700 ${size}px ${F.grotesk}`; ctx.fillText(name.toUpperCase(), S / 2, S * 0.47); }
      ctx.textBaseline = "alphabetic";
    }
    kit.grain(ctx, S, 0.32);
  }
};
