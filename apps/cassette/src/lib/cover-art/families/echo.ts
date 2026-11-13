import { C, mix } from "../color";
import type { FamilyDraw } from "../kit";
import { fill } from "../kit";
import { F } from "../fonts";

export const draw: FamilyDraw = (ctx, S, p, name, r, ph, o, kit) => {
  fill(ctx, S, [0.15, 0.012, p.ink[2]]);
  const vol = 1 + Math.floor(r() * 12);
  const words = name.toUpperCase().split(/\s+/).filter(Boolean); if (!words.length) words.push("?");
  // every line is set to the same width so the stack reads as one block; the break that keeps the smallest line biggest wins,
  // nudged toward a single word on the last line, since that is the one that repeats
  const K = 4, CAP = 0.74, STEP = 0.7, W = S * 0.84, MAXH = S * 0.66, GAP = S * 0.02;
  ctx.font = `600 100px ${F.wide}`;
  const wid = (t: string) => ctx.measureText(t).width;
  let best: { score: number; sizes: number[]; lines: string[]; f: number } | null = null;
  const n = words.length, tries = n <= 6 ? 1 << (n - 1) : 1;
  for (let mask = 0; mask < tries; mask++) {
    const lines: string[] = []; let cur = [words[0]];
    for (let k = 1; k < n; k++) { if (n > 6 || mask & (1 << (k - 1))) { lines.push(cur.join(" ")); cur = [words[k]]; } else cur.push(words[k]); }
    lines.push(cur.join(" "));
    let sizes = lines.map(l => W * 100 / wid(l));
    const tall = sizes.reduce((s, v) => s + v * CAP, 0) + sizes[sizes.length - 1] * CAP * STEP * (K + 0.5);
    const f = Math.min(1, (MAXH - GAP * (lines.length - 1)) / tall, S * 0.3 / Math.max(...sizes));
    sizes = sizes.map(v => v * f);
    const score = Math.min(...sizes) * (lines[lines.length - 1].includes(" ") ? 0.85 : 1);
    if (!best || score > best.score) best = { score, sizes, lines, f };
  }
  if (!best) return;
  const { sizes, lines } = best, L = lines.length, blockW = W * best.f;
  const lastSize = sizes[L - 1], step = lastSize * CAP * STEP;
  const blockH = sizes.reduce((s, v) => s + v * CAP, 0) + GAP * (L - 1) + step * (K + 0.5);
  const top = S * 0.155 + (MAXH - blockH) / 2, bases: number[] = [];
  let y = top; sizes.forEach(v => { y += v * CAP; bases.push(y); y += GAP; });
  const lastBase = bases[L - 1], last = lines[L - 1];
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  // copies of the last line slide down one slot per loop; each shows only what hangs below the copy above it, softer and cooler the further it falls
  const OFF = S * 4;
  ctx.font = `600 ${lastSize}px ${F.wide}`;
  for (let k = K; k >= 0; k--) {
    const d = (k + ph) * step, t = d / ((K + 1) * step);
    if (d < 0.5) continue;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, lastBase + Math.max(0, d - step), S, Math.min(d, step) + lastSize * 0.02); ctx.clip();
    ctx.globalAlpha = 1 - t * 0.4;
    ctx.shadowColor = C(mix(p.c1, p.c2, Math.min(1, t * 1.15))); ctx.shadowBlur = S * 0.003 + t * t * S * 0.04; ctx.shadowOffsetX = OFF;
    ctx.fillStyle = "#000"; ctx.fillText(last, S / 2 - OFF, lastBase + d);
    ctx.restore();
  }
  ctx.fillStyle = C(p.c1);
  lines.forEach((l, i) => { ctx.font = `600 ${sizes[i]}px ${F.wide}`; ctx.fillText(l, S / 2, bases[i]); });
  // the sleeve's small print, lined up with the block's edges
  const lab = (t: string, x: number, yy: number, align: CanvasTextAlign = "left", a = 0.8) => { ctx.font = `400 ${S * 0.026}px ${F.tiny}`; ctx.textAlign = align; ctx.fillStyle = C(p.c3, a); ctx.fillText(t, x, yy); };
  const m = S * 0.06, ly = top - S * 0.03, wide = blockW > S * 0.6;
  const lx = wide ? (S - blockW) / 2 : m, rx = wide ? (S + blockW) / 2 : S - m;
  lab("[SIDE A]", m, m + S * 0.02);
  lab("MIXTAPE", lx, ly); lab(`[VOL. ${String(vol).padStart(2, "0")}]`, S / 2, ly, "center"); lab("HIGH BIAS", rx, ly, "right");
  let bx = S * 0.7; const bw = S * 0.0045;
  ctx.fillStyle = C(p.c3, 0.85);
  while (bx < S - m) { const wdt = bw * (1 + Math.floor(r() * 3)); ctx.fillRect(bx, m - S * 0.012, wdt * 0.8, S * 0.045); bx += wdt + bw * (r() < 0.3 ? 1.5 : 0.6); }
  const by = S - m - S * 0.04;
  ctx.strokeStyle = C(p.c3, 0.8); ctx.lineWidth = Math.max(1, S * 0.003); ctx.strokeRect(m, by, S * 0.075, S * 0.045);
  ctx.font = `700 ${S * 0.026}px ${F.tiny}`; ctx.textAlign = "center"; ctx.fillStyle = C(p.c3, 0.85); ctx.fillText("C90", m + S * 0.0375, by + S * 0.031);
  lab("TYPE II", m + S * 0.09, by + S * 0.017); lab("[LABEL 01-FRONT]", m + S * 0.09, by + S * 0.043);
  for (let i = 0; i < 9; i++) { ctx.fillStyle = C(mix(p.c1, p.c2, i / 8), 1 - i * 0.07); ctx.fillRect(S * 0.37 + i * S * 0.029, S - m - S * 0.018, S * 0.029, S * 0.013); }
  kit.grain(ctx, S, 0.2);
};
