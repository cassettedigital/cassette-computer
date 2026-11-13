import { C, mix, TAU, WHITE } from "../color";
import type { Col } from "../color";
import type { FamilyDraw } from "../kit";
import { fill, nameLines } from "../kit";
import { F } from "../fonts";

export const draw: FamilyDraw = (ctx, S, p, name, r, ph, o, kit) => {
  fill(ctx, S, p.bg);
  const w = TAU * ph, rings = r() < 0.55, gap = S * (0.024 + r() * 0.012), a0 = r() * Math.PI;
  const d = rings ? S * (0.05 + r() * 0.06) : 0, c0 = rings ? [S * (0.35 + r() * 0.3), S * (0.35 + r() * 0.3)] : [S / 2, S / 2];
  ctx.lineWidth = gap * 0.42; ctx.globalCompositeOperation = "screen";
  if (rings) {
    ([[p.c1, 1], [p.c2, -1]] as [Col, number][]).forEach(([col, s]) => {
      const x = c0[0] + s * d * Math.cos(w + a0), y = c0[1] + s * d * Math.sin(w + a0);
      ctx.strokeStyle = C(col, 0.9);
      for (let rr = gap; rr < S * 1.5; rr += gap) { ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke(); }
    });
  } else {
    ([[p.c1, 0], [p.c2, (4 + 3 * Math.sin(w)) * Math.PI / 180]] as [Col, number][]).forEach(([col, da]) => {
      ctx.save(); ctx.translate(S / 2, S / 2); ctx.rotate(a0 + da); ctx.strokeStyle = C(col, 0.9); ctx.beginPath();
      for (let y = -S; y < S; y += gap) { ctx.moveTo(-S, y); ctx.lineTo(S, y); }
      ctx.stroke(); ctx.restore();
    });
  }
  ctx.globalCompositeOperation = "source-over";
  if (o.titles) {
    // the name hides in the screen: inside the letters the first screen shifts half a step and changes ink, so it reads by interference
    const buf = kit.buffer(S);
    const b = kit.ctxOf(buf); b.setTransform(1, 0, 0, 1, 0, 0); b.globalCompositeOperation = "source-over"; b.clearRect(0, 0, S, S);
    b.lineWidth = gap * 0.6; b.strokeStyle = C(mix(p.c3, WHITE, 0.35));
    if (rings) { const x = c0[0] + d * Math.cos(w + a0), y = c0[1] + d * Math.sin(w + a0); for (let rr = gap * 1.5; rr < S * 1.5; rr += gap) { b.beginPath(); b.arc(x, y, rr, 0, TAU); b.stroke(); } }
    else { b.save(); b.translate(S / 2, S / 2); b.rotate(a0); b.beginPath(); for (let y = -S + gap / 2; y < S; y += gap) { b.moveTo(-S, y); b.lineTo(S, y); } b.stroke(); b.restore(); }
    const L = nameLines(b, name.toUpperCase(), S * 0.88, S * 0.66, F.heavy, 400), at = (i: number) => S / 2 + (i - (L.lines.length - 1) / 2) * L.size * 0.86;
    b.globalCompositeOperation = "destination-in"; b.font = `400 ${L.size}px ${F.heavy}`; b.textAlign = "center"; b.textBaseline = "middle"; b.fillStyle = "#fff";
    L.lines.forEach((l, i) => b.fillText(l, S / 2, at(i)));
    ctx.font = `400 ${L.size}px ${F.heavy}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = C(p.bg);
    L.lines.forEach((l, i) => ctx.fillText(l, S / 2, at(i)));
    ctx.drawImage(buf, 0, 0); ctx.textBaseline = "alphabetic";
  }
  kit.grain(ctx, S, 0.08);
};
