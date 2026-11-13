import { C, mix, TAU, WHITE } from "../color";
import type { FamilyDraw } from "../kit";
import { disc, glint } from "../kit";
import { F } from "../fonts";

export const draw: FamilyDraw = (ctx, S, p, name, r, ph, o, kit) => {
  const w = TAU * ph, vol = 1 + Math.floor(r() * 12);
  const sky = ctx.createLinearGradient(0, 0, 0, S);
  sky.addColorStop(0, C([0.16, 0.06, p.c2[2]])); sky.addColorStop(0.55, C([0.32, 0.13, p.c2[2] + 25])); sky.addColorStop(1, C(mix([0.55, 0.16, p.c1[2]], p.c2, 0.3)));
  ctx.fillStyle = sky; ctx.fillRect(0, 0, S, S);
  const hx = S * (0.5 + 0.3 * Math.sin(w)), haze = ctx.createRadialGradient(hx, S * 0.78, 0, hx, S * 0.78, S * 0.6);
  haze.addColorStop(0, C(p.c1, 0.35)); haze.addColorStop(1, C(p.c1, 0));
  ctx.fillStyle = haze; ctx.fillRect(0, 0, S, S);
  kit.grain(ctx, S, 0.25);
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = C(p.c3, 0.7);
  for (let i = 0; i < 36; i++) disc(ctx, r() * S, r() * S, S * 0.002 * (1 + r() * 1.5));
  for (let i = 0; i < 6; i++) { const x = r() * S, y = r() * S, len = S * (0.015 + r() * 0.03), q = r() * TAU; glint(ctx, x, y, len * (0.5 + 0.5 * Math.sin(w * 2 + q)), WHITE, 0.9); }
  ctx.globalCompositeOperation = "source-over";
  // the name in a brush script: one line, or stacked and staggered when that sets it a good deal bigger and easier to read
  const text = name ? name[0].toUpperCase() + name.slice(1) : "?";
  const words = text.split(/\s+/).filter(Boolean), STAG = S * 0.06, ADV = 0.66;
  const opts: string[][] = [[text]];
  for (let k = 1; k < words.length; k++) opts.push([words.slice(0, k).join(" "), words.slice(k).join(" ")]);
  for (let a = 1; a < words.length - 1; a++) for (let b = a + 1; b < words.length; b++) opts.push([words.slice(0, a).join(" "), words.slice(a, b).join(" "), words.slice(b).join(" ")]);
  ctx.font = `400 100px ${F.brush}`;
  let best: { size: number; lines: string[] } | null = null;
  for (const lines of opts) {
    const room = S * 0.8 - (lines.length - 1) * STAG;
    const size = Math.min(room * 100 / Math.max(...lines.map(l => ctx.measureText(l).width)), S * 0.56 / (0.62 + (lines.length - 1) * ADV), S * 0.34);
    if (!best || size > best.size * 1.05) best = { size, lines };
  }
  if (!best) return;
  const { size, lines } = best, L = lines.length, glow = 0.6 + 0.4 * Math.sin(w);
  const lx = (i: number) => (i - (L - 1) / 2) * STAG, ly = (i: number) => (i - (L - 1) / 2) * size * ADV + size * 0.2;
  ctx.save(); ctx.translate(S / 2, S * 0.54); ctx.rotate(-0.12);
  ctx.font = `400 ${size}px ${F.brush}`; ctx.textAlign = "center";
  ctx.shadowColor = C(p.c1, 0.8 * glow); ctx.shadowBlur = S * 0.04; ctx.fillStyle = C(mix(p.c1, p.c3, 0.35));
  lines.forEach((l, i) => ctx.fillText(l, lx(i), ly(i)));
  // a tapered swash under the last line
  const tw = Math.min(S * 0.8, ctx.measureText(lines[L - 1]).width), sx = lx(L - 1), sy = ly(L - 1);
  ctx.beginPath(); ctx.moveTo(sx - tw * 0.45, sy + size * 0.14); ctx.quadraticCurveTo(sx, sy + size * 0.02, sx + tw * 0.55, sy - size * 0.01); ctx.quadraticCurveTo(sx, sy + size * 0.08, sx - tw * 0.45, sy + size * 0.14); ctx.fill();
  ctx.restore();
};
