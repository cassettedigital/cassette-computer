import { C, TAU } from "../color";
import type { Col } from "../color";
import type { FamilyDraw } from "../kit";
import { fill } from "../kit";
import { HAND, DISPLAY, MONO } from "../fonts";

export const draw: FamilyDraw = (ctx, S, p, name, r, ph, o, kit) => {
  fill(ctx, S, p.bg);
  const w = TAU * ph, pad = S * 0.08, layout = Math.floor(r() * 3), [hand, hk] = HAND[Math.floor(r() * HAND.length)];
  const bands: [Col, number][] = [[p.c1, 0.075], [p.c2, 0.04], [p.c3, 0.018]];
  if (r() < 0.5) bands.reverse();
  let textW = S - pad * 2;
  if (layout === 0) {
    const tilt = r() < 0.35 ? -0.12 : 0, by = S * (0.66 + r() * 0.05);
    ctx.save(); ctx.translate(S / 2, by); ctx.rotate(tilt);
    let y = 0; bands.forEach(([c, h], i) => { const hh = S * h * (1 + 0.18 * Math.sin(w + i * 2.1)); ctx.fillStyle = C(c); ctx.fillRect(-S, y, S * 2, hh); y += hh + S * 0.012; });
    ctx.restore();
  } else if (layout === 1) {
    ctx.save(); ctx.beginPath(); ctx.rect(0, S * 0.62, S, S); ctx.clip();
    const base = Math.PI * 1.08 + 0.05 * Math.sin(w);
    bands.forEach(([c], i) => { ctx.fillStyle = C(c); ctx.beginPath(); ctx.moveTo(S, S); ctx.arc(S, S, S * 2, base + i * 0.13, base + i * 0.13 + 0.09); ctx.closePath(); ctx.fill(); });
    ctx.restore();
  } else {
    textW = S * 0.6;
    let x = S * 0.74; bands.forEach(([c, h], i) => { const ww = S * h * 0.9 * (1 + 0.2 * Math.sin(w + i * 2.1)); ctx.fillStyle = C(c); ctx.fillRect(x, 0, ww, S); x += ww + S * 0.012; });
  }
  ctx.font = `500 ${S * 0.048}px ${MONO}`; ctx.fillStyle = C(p.c3, 0.6);
  ctx.fillText(["C60", "C90", "C46"][Math.floor(r() * 3)] + "  ·  TYPE II", pad, S * 0.13);
  const ax = layout === 2 ? pad + S * 0.05 : S - pad - S * 0.05, ay = layout === 2 ? S * 0.86 : S * 0.115;
  ctx.beginPath(); ctx.arc(ax, ay, S * 0.05, 0, TAU); ctx.strokeStyle = C(p.c3, 0.6); ctx.lineWidth = S * 0.006; ctx.stroke();
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `700 ${S * 0.06}px ${DISPLAY}`; ctx.fillText("A", ax, ay + S * 0.003);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  // the title written by hand over as many lines as it wants, each with a rule under it, as if written on a ruled card wherever the pen landed
  const areaTop = S * 0.2, areaBot = layout === 2 ? S * 0.76 : S * 0.58, ADV = 1.08;
  const words = name.split(/\s+/).filter(Boolean);
  ctx.font = `400 100px ${hand}`;
  let best: { size: number; lines: string[] } | null = null;
  const n = words.length, tries = n && n <= 6 ? 1 << (n - 1) : 1;
  for (let mask = 0; mask < tries; mask++) {
    const lines: string[] = []; let cur = [words[0] || "?"];
    for (let k = 1; k < n; k++) { if (n > 6 || mask & (1 << (k - 1))) { lines.push(cur.join(" ")); cur = [words[k]]; } else cur.push(words[k]); }
    lines.push(cur.join(" "));
    const size = Math.min(textW * 100 / Math.max(...lines.map(l => ctx.measureText(l).width)), (areaBot - areaTop) * hk / (lines.length * ADV), S * 0.17 * hk);
    if (!best || size > best.size * 1.06) best = { size, lines };
  }
  if (!best) return;
  const { size, lines } = best, adv = size * ADV / hk;
  const blockTop = areaTop + Math.max(0, (areaBot - areaTop - adv * lines.length) * 0.35);
  ctx.font = `400 ${size}px ${hand}`;
  lines.forEach((l, i) => {
    const base = blockTop + adv * (i + 0.78), jx = (r() - 0.3) * S * 0.025;
    ctx.strokeStyle = C(p.c3, 0.18); ctx.lineWidth = Math.max(1, S * 0.004);
    ctx.beginPath(); ctx.moveTo(pad - S * 0.01, base + adv * 0.14); ctx.lineTo(pad + textW, base + adv * 0.14); ctx.stroke();
    ctx.save(); ctx.translate(pad + jx, base); ctx.rotate(-0.035 + (r() - 0.5) * 0.02); ctx.fillStyle = C(p.c3); ctx.fillText(l, 0, 0); ctx.restore();
  });
  kit.grain(ctx, S, 0.1);
};
