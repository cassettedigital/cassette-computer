import { C, TAU } from "../color";
import type { FamilyDraw } from "../kit";
import { fill } from "../kit";
import { F, DISPLAY } from "../fonts";

export const draw: FamilyDraw = (ctx, S, p, name, r, ph, o, kit) => {
  const w = TAU * ph, variant = Math.floor(r() * 3), flip = r() < 0.5;
  // each cover gets one of seven display faces: [face, weight, cap height as a share of the size]
  const FACES: [string, number, number][] = [[DISPLAY, 800, 0.7], [F.anton, 400, 0.73], [F.heavy, 400, 0.72], [F.dela, 400, 0.74], [F.fest, 800, 0.7], [F.block, 400, 0.72], [F.arena, 400, 0.72]];
  const [face, fw, cap] = FACES[Math.floor(r() * FACES.length)];
  const words = name.toUpperCase().split(/\s+/).filter(Boolean);
  if (!words.length) words.push("?");
  if (variant === 2) {
    // marquee: the name runs in alternating directions, one row solid
    fill(ctx, S, p.bg);
    const size = S * 0.24, adv = size * 0.86, rows = Math.ceil(S / adv) + 1, hiRow = Math.floor(r() * (rows - 1));
    const text = words.join(" ") + "  ·  ";
    ctx.font = `${fw} ${size}px ${face}`;
    const unit = ctx.measureText(text).width;
    for (let i = 0; i < rows; i++) {
      const y = i * adv + size * 0.62, dir = i % 2 ? 1 : -1;
      const off = ((dir * ph * unit + i * unit * 0.37) % unit + unit) % unit;
      for (let x = off - unit; x < S; x += unit) {
        if (i === hiRow) { ctx.fillStyle = C(p.c2); ctx.fillText(text, x, y); }
        else { ctx.strokeStyle = C(p.c1, 0.75); ctx.lineWidth = Math.max(1, S * 0.006); ctx.strokeText(text, x, y); }
      }
    }
    kit.grain(ctx, S, 0.1);
    return;
  }
  fill(ctx, S, flip ? p.c1 : p.c2);
  const shadow = flip ? p.c2 : p.c1;
  const pad = S * 0.07, box = S - pad * 2, adv = 0.84;
  ctx.font = `${fw} 100px ${face}`;
  const wid = (s: string) => ctx.measureText(s).width;
  // try every way of breaking the name into lines and keep the one that sets biggest
  let best: { size: number; lines: string[] } = { size: 0, lines: [] };
  const n = words.length, tries = n <= 6 ? 1 << (n - 1) : 1;
  for (let mask = 0; mask < tries; mask++) {
    const lines: string[] = []; let cur = [words[0]];
    for (let k = 1; k < n; k++) { if (n > 6 || mask & (1 << (k - 1))) { lines.push(cur.join(" ")); cur = [words[k]]; } else cur.push(words[k]); }
    lines.push(cur.join(" "));
    const size = Math.min(box * 100 / Math.max(...lines.map(wid)), box / ((lines.length - 1) * adv + cap), S * 0.62);
    if (size > best.size) best = { size, lines };
  }
  const { size, lines } = best;
  ctx.font = `${fw} ${size}px ${face}`;
  const blockH = (lines.length - 1) * adv * size + cap * size;
  ctx.save();
  if (variant === 1) { ctx.translate(S / 2, S / 2); ctx.rotate(-Math.PI / 2); ctx.translate(-S / 2, -S / 2); }
  const top = S - pad - blockH, ox = S * 0.018 * Math.cos(w), oy = S * 0.018 * Math.sin(w);
  lines.forEach((ln, i) => {
    const y = top + cap * size + i * adv * size;
    ctx.fillStyle = C(shadow); ctx.fillText(ln, pad + S * 0.012 + ox, y + S * 0.012 + oy);
    ctx.fillStyle = C(p.ink); ctx.fillText(ln, pad, y);
  });
  ctx.restore();
  kit.grain(ctx, S, 0.12);
};
