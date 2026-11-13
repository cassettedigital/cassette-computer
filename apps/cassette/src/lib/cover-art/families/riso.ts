import { C, clamp, TAU } from "../color";
import type { Col } from "../color";
import type { FamilyDraw } from "../kit";
import { fill, disc } from "../kit";
import { F } from "../fonts";

export const draw: FamilyDraw = (ctx, S, p, name, r, ph, o, kit) => {
  fill(ctx, S, p.ink);
  const w = TAU * ph;
  const cx = 0.25 + r() * 0.5, cy = 0.25 + r() * 0.5, R = 0.35 + r() * 0.3, a0 = 15 + r() * 10;
  const lin = r() < 0.5, th = r() * TAU, cx2 = r(), cy2 = r(), R2 = 0.3 + r() * 0.3, a1 = 70 + r() * 10;
  const f0 = (x: number, y: number) => 1 - Math.hypot(x - cx - 0.06 * Math.cos(w), y - cy - 0.06 * Math.sin(w)) / R;
  const tt = th + 0.3 * Math.sin(w), ct = Math.cos(tt), st = Math.sin(tt);
  const f1 = lin ? (x: number, y: number) => (x - 0.5) * ct + (y - 0.5) * st + 0.5 : (x: number, y: number) => 1 - Math.abs(Math.hypot(x - cx2, y - cy2) - R2 - 0.07 * Math.sin(w)) / 0.2;
  const layers: [Col, number, (x: number, y: number) => number][] = [[p.c1, a0 + 3 * Math.sin(w), f0], [p.c2, a1 - 3 * Math.sin(w), f1]];
  const cell = S / 20;
  ctx.globalCompositeOperation = "screen";
  layers.forEach(([col, ang, f], i) => {
    const a = ang * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    const dx = i ? S * 0.012 : 0, dy = i ? -S * 0.008 : 0;
    ctx.fillStyle = C(col, 0.95);
    for (let gx = -S; gx < S; gx += cell) for (let gy = -S; gy < S; gy += cell) {
      const wx = gx * ca - gy * sa + S / 2 + dx, wy = gx * sa + gy * ca + S / 2 + dy;
      if (wx < -cell || wy < -cell || wx > S + cell || wy > S + cell) continue;
      const rad = cell * 0.66 * Math.sqrt(clamp(f(wx / S, wy / S), 0, 1));
      if (rad < 0.4) continue;
      disc(ctx, wx, wy, rad);
    }
  });
  if (o.titles) {
    // the name as a third, finer screen in the light ink, a touch off register
    const mask = kit.textMask(name, 180, F.anton, 400, 0.86, 0.72), c2 = S / 48, ta = Math.PI / 4 + 0.04 * Math.sin(w), ca = Math.cos(ta), sa = Math.sin(ta);
    ctx.fillStyle = C(p.c3, 0.95);
    for (let gx = -S; gx < S; gx += c2) for (let gy = -S; gy < S; gy += c2) {
      const wx = gx * ca - gy * sa + S / 2 + S * 0.006, wy = gx * sa + gy * ca + S / 2 - S * 0.004;
      if (wx < 0 || wy < 0 || wx > S || wy > S) continue;
      const v = mask(wx / S, wy / S); if (v < 0.3) continue;
      disc(ctx, wx, wy, c2 * 0.56 * Math.sqrt(v));
    }
  }
  ctx.globalCompositeOperation = "source-over";
  kit.grain(ctx, S, 0.12);
};
