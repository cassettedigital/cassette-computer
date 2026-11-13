import { C, TAU, CREAM } from "../color";
import type { FamilyDraw } from "../kit";
import { fill, fitSize, twoLines } from "../kit";
import { F } from "../fonts";

export const draw: FamilyDraw = (ctx, S, p, name, r, ph, o, kit) => {
  fill(ctx, S, p.bg);
  const w = TAU * ph;
  [p.c1, p.c2, p.c3, p.c1].forEach((c, i) => {
    const x0 = r() * S, y0 = r() * S, R = S * (0.45 + r() * 0.55), m = 1 + Math.floor(r() * 2), phi = r() * TAU, dir = r() < 0.5 ? 1 : -1;
    const x = x0 + S * 0.16 * Math.cos(w * m * dir + phi), y = y0 + S * 0.16 * Math.sin(w * m * dir + phi);
    const g = ctx.createRadialGradient(x, y, 0, x, y, R);
    g.addColorStop(0, C(c, i === 2 ? 0.45 : 0.85)); g.addColorStop(1, C(c, 0));
    ctx.globalCompositeOperation = i ? "screen" : "source-over";
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  });
  ctx.globalCompositeOperation = "source-over";
  if (o.titles) {
    // the name in a soft italic, drifting in and out of focus
    const lines = twoLines(name, 12), OFF = S * 4;
    const size = Math.min(...lines.map(l => fitSize(ctx, l, F.serif, "italic 400", S * 0.84, S * 0.24)));
    ctx.font = `italic 400 ${size}px ${F.serif}`; ctx.textAlign = "center";
    const top = S / 2 - (lines.length - 1) * size * 0.45 + size * 0.28;
    ctx.save(); ctx.shadowColor = C(CREAM, 0.95); ctx.shadowBlur = S * 0.014 * (0.5 + 0.5 * Math.sin(w)); ctx.shadowOffsetX = OFF; ctx.fillStyle = "#000";
    lines.forEach((l, i) => ctx.fillText(l, S / 2 - OFF, top + i * size * 0.9)); ctx.restore();
  }
  kit.grain(ctx, S, 0.16, ph || 0.0001);
};
