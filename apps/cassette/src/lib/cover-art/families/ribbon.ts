import { C, mix, TAU, WHITE } from "../color";
import type { FamilyDraw } from "../kit";
import { fitSize, twoLines } from "../kit";
import { F } from "../fonts";

export const draw: FamilyDraw = (ctx, S, p, name, r, ph, o, kit) => {
  const w = TAU * ph, layout = r() < 0.5 ? 0 : 1, count = layout + 1, step = S / 160;
  // a VHS sleeve: an airbrushed night stepped into flat bands, ribbons of light, a chrome title, scanlines and badges
  const top = [0.13, 0.05, p.c2[2]], mid = mix(p.c2, p.ink, 0.35), low = mix(p.c1, p.ink, 0.55), bands = 9;
  for (let b = 0; b < bands; b++) { const t = b / (bands - 1); ctx.fillStyle = C(t < 0.6 ? mix(top, mid, t / 0.6) : mix(mid, low, (t - 0.6) / 0.4)); ctx.fillRect(0, b * S / bands, S, S / bands + 1); }
  const hg = ctx.createRadialGradient(S / 2, S * 1.05, 0, S / 2, S * 1.05, S * 0.7);
  hg.addColorStop(0, C(p.c1, 0.45)); hg.addColorStop(1, C(p.c1, 0));
  ctx.fillStyle = hg; ctx.fillRect(0, 0, S, S);
  kit.grain(ctx, S, 0.18);
  const faces = [[p.c1, p.c2], [p.c2, p.c3], [p.c3, p.c1]];
  const ribbonBuf = kit.scratch("ribbon", S), b = kit.ctxOf(ribbonBuf), OFF = S * 4;
  const quad = (x0: number, ya: number, t0: number, x1: number, yb: number, t1: number, W: number) => { b.beginPath(); b.moveTo(x0, ya - W * t0); b.lineTo(x1 + 1.5, yb - W * t1); b.lineTo(x1 + 1.5, yb + W * t1); b.lineTo(x0, ya + W * t0); b.closePath(); b.fill(); };
  const lines = twoLines(name.toUpperCase(), 11);
  for (let q = 0; q < count; q++) {
    const ry = r(), ra = r();
    const y0 = layout === 1 ? S * (0.6 + q * 0.16) : S * (0.64 + ry * 0.08);
    const A = S * (0.08 + ra * 0.06), k = TAU * (0.4 + r() * 0.4) / S, phi = r() * TAU;
    const W = S * [0.12, 0.085][layout] * (0.85 + r() * 0.3), kt = TAU * (0.5 + r() * 0.6) / S, pt = r() * TAU;
    const dir = layout === 1 ? (q ? -1 : 1) : 1;
    const [front, back] = faces[q % 3];
    if (q === count - 1) {
      // the chrome title sits behind the front ribbon
      const size = Math.min(...lines.map(l => fitSize(ctx, l, F.vhs, "italic 900", S * 0.8, S * 0.2)));
      const ty = S * 0.38 + size * 0.32 - (lines.length - 1) * size * 0.5;
      lines.forEach((l, i) => kit.chrome(ctx, S, p, l, S / 2, ty + i * size, size, ph));
    }
    const pts = [];
    for (let x = -step; x <= S + step; x += step) pts.push([x, y0 + A * Math.sin(k * x + phi + w * dir), Math.sin(kt * x + pt + w * dir)]);
    // the ribbon goes into a scratch canvas: shaded by how squarely it faces us, with a bright core where it does
    b.setTransform(1, 0, 0, 1, 0, 0); b.clearRect(0, 0, S, S);
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, ya, t0] = pts[i], [x1, yb, t1] = pts[i + 1], tw = (t0 + t1) / 2, lit = Math.pow(Math.abs(tw), 0.7), face = tw >= 0 ? front : back;
      b.fillStyle = C([face[0] * (0.45 + 0.55 * lit) + 0.04, face[1], face[2]]); quad(x0, ya, t0, x1, yb, t1, W);
      if (lit > 0.35) { b.fillStyle = C(mix(face, WHITE, 0.55), Math.min(1, (lit - 0.35) * 1.3)); quad(x0, ya, t0, x1, yb, t1, W * 0.28); }
    }
    // laid down twice: once as a soft glow of its own colour, once crisp
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.shadowColor = C(front, 0.85); ctx.shadowBlur = S * 0.05; ctx.shadowOffsetX = OFF; ctx.drawImage(ribbonBuf, -OFF, 0); ctx.restore();
    ctx.drawImage(ribbonBuf, 0, 0);
  }
  ctx.fillStyle = "rgba(0, 0, 0, 0.14)";
  const pitch = Math.max(3, Math.round(S / 104));
  for (let y = 0; y < S; y += pitch) ctx.fillRect(0, y, S, Math.max(1, pitch / 3));
};
