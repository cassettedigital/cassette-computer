import { C, mix, TAU, WHITE } from "../color";
import type { FamilyDraw } from "../kit";
import { fill, disc, fitSize, twoLines, glint } from "../kit";
import { F } from "../fonts";

export const draw: FamilyDraw = (ctx, S, p, name, r, ph, o, kit) => {
  const w = TAU * ph;
  // two inks only: the night is made from the cool one, everything that glows from the warm one, plus white
  const night = [0.15, Math.min(0.09, p.c2[1] * 0.6), p.c2[2]], glow = p.c1;
  fill(ctx, S, night);
  const haze = ctx.createRadialGradient(S / 2, S * 0.72, 0, S / 2, S * 0.72, S * 0.85);
  haze.addColorStop(0, C([0.4, Math.min(0.16, p.c2[1]), p.c2[2]], 0.9)); haze.addColorStop(1, C(night, 0));
  ctx.fillStyle = haze; ctx.fillRect(0, 0, S, S);
  kit.grain(ctx, S, 0.25);
  ctx.fillStyle = C(WHITE, 0.7);
  for (let i = 0; i < 45; i++) disc(ctx, r() * S, r() * S * 0.8, S * 0.0018 * (1 + r()));
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 5; i++) {
    const x = r() * S, y = S * (0.04 + r() * 0.6), len = S * (0.025 + r() * 0.03), q = r() * TAU, tw = 0.5 + 0.5 * Math.sin(w * 2 + q);
    const halo = ctx.createRadialGradient(x, y, 0, x, y, len * 0.7);
    halo.addColorStop(0, C(glow, 0.5 * tw)); halo.addColorStop(1, C(glow, 0));
    ctx.fillStyle = halo; ctx.fillRect(x - len, y - len, len * 2, len * 2);
    glint(ctx, x, y, len * (0.5 + 0.5 * tw), WHITE, 0.95);
  }
  // a wireframe globe rising out of the bottom edge, seen from a little above, turning one meridian per loop
  const R = S * 0.62, cx = S / 2, cy = S * 1.17, tilt = 0.55, M = 18, spin = ph * TAU / M;
  const proj = (lat: number, lon: number): number[] => { const x = R * Math.cos(lat) * Math.sin(lon), y = R * Math.sin(lat), z = R * Math.cos(lat) * Math.cos(lon); return [cx + x, cy - (y * Math.cos(tilt) - z * Math.sin(tilt)), y * Math.sin(tilt) + z * Math.cos(tilt)]; };
  const path = kit.path();
  const seg = (pts: number[][]) => { let on = false; for (const [x, y, z] of pts) { if (z > 0) { on ? path.lineTo(x, y) : path.moveTo(x, y); on = true; } else on = false; } };
  for (let la = -75; la <= 75; la += 15) seg(Array.from({ length: 97 }, (_, k) => proj(la * Math.PI / 180, k / 96 * TAU)));
  for (let m = 0; m < M; m++) seg(Array.from({ length: 49 }, (_, k) => proj(-Math.PI / 2 + k / 48 * Math.PI, m / M * TAU + spin)));
  const pole = proj(Math.PI / 2, 0);
  const halo = ctx.createRadialGradient(pole[0], pole[1], 0, pole[0], pole[1], S * 0.5);
  halo.addColorStop(0, C(glow, 0.7)); halo.addColorStop(0.35, C(glow, 0.22)); halo.addColorStop(1, C(glow, 0));
  ctx.fillStyle = halo; ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = C(glow, 0.22); ctx.lineWidth = S * 0.012; ctx.stroke(path);
  ctx.strokeStyle = C(mix(glow, WHITE, 0.3), 0.9); ctx.lineWidth = Math.max(1, S * 0.0028); ctx.stroke(path);
  const fl = ctx.createRadialGradient(pole[0], pole[1], 0, pole[0], pole[1], S * 0.07);
  fl.addColorStop(0, "rgba(255, 255, 255, 1)"); fl.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = fl; ctx.fillRect(0, 0, S, S);
  const gl = 1 + 0.12 * Math.sin(w);
  glint(ctx, pole[0], pole[1], S * 0.22 * gl, WHITE, 0.9);
  ctx.save(); ctx.translate(pole[0], pole[1]); ctx.rotate(Math.PI / 4); glint(ctx, 0, 0, S * 0.08 * gl, WHITE, 0.6); ctx.restore();
  ctx.globalCompositeOperation = "source-over";
  // the title, big and central, white with the warm ink as its drop shadow
  const lines = twoLines(name.toUpperCase(), 10);
  const size = Math.min(...lines.map(l => fitSize(ctx, l, F.arena, 400, S * 0.86, S * 0.2)));
  ctx.font = `400 ${size}px ${F.arena}`; ctx.textAlign = "center";
  const lead = size * 1.06, top = S * 0.37 - (size * 0.74 + (lines.length - 1) * lead) / 2;
  const ty = (i: number) => top + size * 0.74 + i * lead, off = Math.max(1.5, size * 0.08);
  ctx.fillStyle = C(night); lines.forEach((l, i) => ctx.fillText(l, S / 2 + off * 1.5, ty(i) + off * 1.5));
  ctx.fillStyle = C(glow); lines.forEach((l, i) => ctx.fillText(l, S / 2 + off, ty(i) + off));
  ctx.fillStyle = C(WHITE); lines.forEach((l, i) => ctx.fillText(l, S / 2, ty(i)));
};
