import { C, mix, TAU, WHITE } from "../color";
import type { FamilyDraw } from "../kit";
import { fill, nameLines } from "../kit";
import { F } from "../fonts";

export const draw: FamilyDraw = (ctx, S, p, name, r, ph, o, kit) => {
  const w = TAU * ph, paper = mix(p.bg, p.c2, 0.12);
  fill(ctx, S, paper);
  // fewer, bigger drops on two or three spots, so each ring of ink is wide enough to work as a lens
  const D = 8 + Math.floor(r() * 4), N = 200, polys = [];
  const spots = Array.from({ length: 2 + Math.floor(r() * 2) }, () => [S * (0.2 + r() * 0.6), S * (0.2 + r() * 0.6)]);
  const inks = [[p.c1, p.c3], [p.c2, p.c1], [p.c3, p.c2], [p.c1, p.c2]];
  for (let d = 0; d < D; d++) {
    const sp = spots[Math.floor(r() * spots.length)];
    const cx = sp[0] + S * (r() - 0.5) * 0.06, cy = sp[1] + S * (r() - 0.5) * 0.06, R = S * (0.06 + r() * 0.08);
    // a new drop pushes every earlier ink line outward, keeping area: P' = C + (P - C) * sqrt(1 + R^2 / |P - C|^2)
    for (const q of polys) for (const pt of q.pts) {
      const dx = pt[0] - cx, dy = pt[1] - cy, m2 = dx * dx + dy * dy || 1e-6, f = Math.sqrt(1 + R * R / m2);
      pt[0] = cx + dx * f; pt[1] = cy + dy * f;
    }
    polys.push({ inks: inks[d % inks.length], ang: r() * TAU, pts: Array.from({ length: N }, (_, k) => [cx + R * Math.cos(k / N * TAU), cy + R * Math.sin(k / N * TAU)]) });
  }
  // the name, big and heavy, under the water
  const lines = nameLines(ctx, name.toUpperCase(), S * 0.86, S * 0.7, F.heavy, 400); lines.size = Math.min(lines.size, S * 0.34);
  const light = kit.textLayer(S, lines, C(p.c3, 0.9)), cool = kit.textLayer(S, lines, C(mix(p.c2, WHITE, 0.3))), warm = kit.textLayer(S, lines, C(mix(p.c1, WHITE, 0.3))), mask = kit.textLayer(S, lines, "#fff");
  const tintBuf = kit.scratch("tint", S), tint = kit.ctxOf(tintBuf);
  ctx.drawImage(light, 0, 0);
  const cur = Array.from({ length: 3 }, (_, i) => ({ A: S * (0.035 + r() * 0.035), k: TAU * (1 + r() * 1.5) / S, phi: r() * TAU, m: [1, -1, 2][i] }));
  polys.forEach((q, qi) => {
    const path = kit.path(); let sx = 0, sy = 0;
    q.pts.forEach(([x, y], i) => {
      x += cur[0].A * Math.sin(cur[0].k * y + cur[0].phi + cur[0].m * w);
      y += cur[1].A * Math.sin(cur[1].k * x + cur[1].phi + cur[1].m * w);
      x += cur[2].A * 0.6 * Math.sin(cur[2].k * (x + y) * 0.7 + cur[2].phi + cur[2].m * w);
      sx += x; sy += y;
      i ? path.lineTo(x, y) : path.moveTo(x, y);
    });
    path.closePath();
    const cx = sx / q.pts.length, cy = sy / q.pts.length, rad = S * 0.2;
    // the ink as a gradient across the ring, like tinted glass
    const g = ctx.createLinearGradient(cx - Math.cos(q.ang) * rad, cy - Math.sin(q.ang) * rad, cx + Math.cos(q.ang) * rad, cy + Math.sin(q.ang) * rad);
    g.addColorStop(0, C(q.inks[0])); g.addColorStop(1, C(q.inks[1]));
    ctx.fillStyle = g; ctx.fill(path);
    // refraction: under each ring the letters are magnified about its middle and split into a cool and a warm fringe, like light through a prism
    ctx.save(); ctx.clip(path);
    const mag = 1.3 + 0.18 * (qi % 3), split = S * (0.01 + 0.006 * (qi % 2));
    const lens = (img: CanvasImageSource, ox: number) => { ctx.save(); ctx.translate(cx + ox, cy); ctx.scale(mag, mag); ctx.translate(-cx, -cy); ctx.drawImage(img, 0, 0); ctx.restore(); };
    ctx.globalCompositeOperation = "screen"; lens(cool, -split); lens(warm, split);
    // the letters seen through the glass take a deeper or brighter shade of the glass itself, never grey
    const g0 = mix(q.inks[0], q.inks[1], 0.5), core = g0[0] > 0.6 ? [g0[0] - 0.24, Math.min(0.3, g0[1] + 0.04), g0[2]] : [g0[0] + 0.24, Math.min(0.3, g0[1] + 0.03), g0[2]];
    tint.globalCompositeOperation = "source-over"; tint.clearRect(0, 0, S, S); tint.drawImage(mask, 0, 0);
    tint.globalCompositeOperation = "source-in"; tint.fillStyle = C(core); tint.fillRect(0, 0, S, S);
    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 0.9; lens(tintBuf, 0); ctx.globalAlpha = 1;
    ctx.restore();
    // the glass edge: a shadow down and to the right, a light rim up and to the left
    ctx.save(); ctx.lineWidth = Math.max(1, S * 0.004);
    ctx.translate(S * 0.003, S * 0.004); ctx.strokeStyle = "rgba(0, 0, 0, 0.35)"; ctx.stroke(path);
    ctx.translate(-S * 0.006, -S * 0.008); ctx.strokeStyle = "rgba(255, 255, 255, 0.35)"; ctx.stroke(path);
    ctx.restore();
  });
  kit.grain(ctx, S, 0.14);
};
