import { C, mix, TAU } from "../color";
import type { FamilyDraw } from "../kit";
import { fill, disc, fitSize, twoLines, star5, DESIGN_SIZE } from "../kit";
import { F } from "../fonts";

export const draw: FamilyDraw = (ctx, S, p, name, r, ph, o, kit) => {
  const w = TAU * ph, ground = mix(p.c2, p.ink, 0.5), ink = p.c1;
  fill(ctx, S, ground);
  // the knit of the shirt it is printed on
  ctx.strokeStyle = C(mix(ground, p.c3, 0.07)); ctx.lineWidth = Math.max(1, S / DESIGN_SIZE); ctx.beginPath();
  for (let y = 0; y < S; y += Math.max(2, S / 150)) { ctx.moveTo(0, y); ctx.lineTo(S, y); }
  ctx.stroke();
  kit.grain(ctx, S, 0.2);
  // chunky specks of the ink, sparing, drifting slowly across the shirt one width per loop
  ctx.fillStyle = C(ink);
  const specks = 60 + Math.floor(r() * 30);
  for (let i = 0; i < specks; i++) {
    const x = (r() * S + ph * S) % S, y = r() * S + Math.sin(w + i) * S * 0.008, sz = S * (0.004 + r() * 0.007), h = sz * (0.6 + r() * 0.8);
    ctx.globalAlpha = 0.35 + r() * 0.5; ctx.fillRect(x - sz / 2, y - h / 2, sz, h);
  }
  ctx.globalAlpha = 1;
  for (let i = 0; i < 9; i++) { const x = r() * S, y = r() * S, q = r() * TAU; star5(ctx, x, y, S * (0.012 + r() * 0.014) * (0.8 + 0.2 * Math.sin(w * 2 + q)), q * 0.1); }
  for (let i = 0; i < 10; i++) disc(ctx, r() * S, r() * S, S * 0.005);
  const lines = twoLines(name.toUpperCase(), 9);
  const size = Math.min(...lines.map(l => fitSize(ctx, l, F.block, 400, S * 0.84, S * 0.22)));
  ctx.font = `400 ${size}px ${F.block}`; ctx.textAlign = "center";
  const lead = size * 0.95, top = S * 0.38 - (lines.length - 1) * lead / 2;
  // the depth is printed as stripes: copies shrink toward a vanishing point that swings slowly side to side, alternating ink and shirt
  const vx = S / 2 + S * 0.14 * Math.sin(w), vy = S * 1.02, K = 18;
  for (let k = K; k >= 0; k--) {
    const s = 1 - k * 0.02;
    ctx.save(); ctx.translate(vx, vy); ctx.scale(s, s); ctx.translate(-vx, -vy);
    ctx.fillStyle = C(k % 2 ? ground : ink);
    lines.forEach((l, i) => ctx.fillText(l, S / 2, top + i * lead + size * 0.36));
    ctx.restore();
  }
};
