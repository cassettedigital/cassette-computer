import { C, mix, clamp, WHITE } from "../color";
import type { Col } from "../color";
import type { FamilyDraw } from "../kit";
import { fill, disc } from "../kit";
import { F } from "../fonts";

export const draw: FamilyDraw = (ctx, S, p, name, r, ph, o, kit) => {
  const R = S / (3 + Math.floor(r() * 3)), rings = 4 + Math.floor(r() * 2), scheme = Math.floor(r() * 3);
  const A = [p.c1, p.c2, p.c1][scheme], B = p.bg, shade = r() < 0.5;
  const ringCol = (k: number, tone: Col) => k % 2 ? B : scheme === 2 && k % 4 === 2 ? p.c2 : tone;
  fill(ctx, S, B);
  const rows = Math.ceil(S / (R / 2)) + 3;
  // drawn top to bottom so each row of scales overlaps the one above; rows drift a full scale per loop, alternating direction
  for (let j = -1; j < rows; j++) {
    const y = j * R / 2, dir = j % 2 ? 1 : -1, off = (j % 2 ? R : 0) + dir * ph * 2 * R;
    const tone = shade ? mix(A, p.c2, clamp(y / S, 0, 1) * 0.8) : A;
    for (let x = ((off % (2 * R)) + 2 * R) % (2 * R) - 2 * R; x < S + 2 * R; x += 2 * R)
      for (let k = 0; k < rings; k++) { ctx.fillStyle = C(ringCol(k, tone)); disc(ctx, x, y, R * (1 - k / rings)); }
  }
  if (o.titles) {
    // a woodblock print's title cartouche: a tall paper slip in the corner with the name set top to bottom
    const chars = [...name.toUpperCase()], pd = S * 0.06, tall = (k: number) => chars.reduce((sum, ch) => sum + (ch === " " ? 0.45 : 1.02), 0) * k;
    let ls = S * 0.075; if (tall(ls) > S * 0.78) ls = S * 0.78 / tall(1);
    const bw = ls * 1.55, bh = tall(ls) + ls * 0.7, bx = S - pd - bw, by = pd;
    ctx.fillStyle = C(mix(p.c3, WHITE, 0.3)); ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = C(p.ink); ctx.lineWidth = Math.max(1, S * 0.004); ctx.strokeRect(bx + S * 0.006, by + S * 0.006, bw - S * 0.012, bh - S * 0.012);
    ctx.font = `400 ${ls}px ${F.dela}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = C(p.ink);
    let y = by + ls * 0.85;
    chars.forEach(ch => { if (ch === " ") { y += ls * 0.45; return; } ctx.fillText(ch, bx + bw / 2, y); y += ls * 1.02; });
    ctx.textBaseline = "alphabetic";
  }
  kit.grain(ctx, S, 0.1);
};
