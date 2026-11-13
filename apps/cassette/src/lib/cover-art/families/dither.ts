import { C, mix, TAU } from "../color";
import type { FamilyDraw } from "../kit";
import { fill, BAYER } from "../kit";
import { MONO } from "../fonts";

export const draw: FamilyDraw = (ctx, S, p, name, r, ph, o, kit) => {
  const w = TAU * ph, G = [48, 64, 80][Math.floor(r() * 3)], px = S / G, roll = r(), kind = roll < 0.5 ? 0 : roll < 0.85 ? 1 : 2;
  const [off, on] = [[p.ink, p.c1], [p.ink, p.c2], [mix(p.c2, p.bg, 0.55), p.c3], [p.ink, p.c3]][Math.floor(r() * 4)];
  const place = Math.floor(r() * 3), midRow = 0.16 + r() * 0.5;
  const sd = (u: number, x: number) => (((u - x + 0.5) % 1) + 1) % 1 - 0.5; // signed distance around a loop one screen wide
  let f: (u: number, v: number, gx: number, gy: number) => number;
  if (kind === 0) {
    // a range in parallax: mountains far back, hills, then plains; each layer slides 1, 2 and 3 screens per loop
    const night = r() < 0.35;
    const peaks = Array.from({ length: 3 + Math.floor(r() * 3) }, () => ({ x: r(), top: 0.3 + r() * 0.16, sl: 1.1 + r() * 1.3, sr: 1.1 + r() * 1.3 }));
    const hills = Array.from({ length: 3 }, () => ({ x: r(), a: 0.035 + r() * 0.05, wd: 0.16 + r() * 0.16 }));
    const pp = r() * TAU, sx = 0.25 + r() * 0.5, sy = 0.28 + r() * 0.12;
    const stars = night ? Array.from({ length: 22 }, () => [Math.floor(r() * G), Math.floor(r() * G * 0.5)]) : [];
    const starSet = new Set(stars.map(([a, b]) => b * G + a));
    const mountain = (u: number) => Math.min(0.62, ...peaks.map(q => { const d = sd(u, q.x); return q.top + Math.abs(d) * (d < 0 ? q.sl : q.sr); }));
    const hill = (u: number) => 0.74 - hills.reduce((s, q) => s + q.a * (0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, Math.abs(sd(u, q.x)) / q.wd))), 0);
    const plain = (u: number) => 0.86 - 0.008 * Math.sin(TAU * u + pp);
    f = (u, v, gx, gy) => {
      if (v > plain(u + ph * 3)) return 0.08 + 0.1 * (v - 0.86) * 6;
      if (v > hill(u + ph * 2)) return 0.22;
      const m = mountain(u + ph);
      if (v > m) return 0.5 - (v - m) * 0.9;
      if (night) {
        if (starSet.has(gy * G + gx)) return 1;
        const dm = Math.hypot(u - sx, v - sy), dc = Math.hypot(u - sx - 0.035, v - sy + 0.02);
        if (dm < 0.08 && dc > 0.075) return 1;
        return 0.02 + 0.12 * (v / 0.62) ** 2;
      }
      if (Math.hypot(u - sx, v - sy) < 0.11) return 1;
      return 0.06 + 0.55 * (v / 0.62) ** 1.6;
    };
  } else if (kind === 1) {
    // a sunset over water; the sun bobs at the horizon and the reflection ripples
    const hz = 0.62, sx = 0.3 + r() * 0.4;
    f = (u, v) => {
      const sy = hz - 0.04 + 0.08 * Math.sin(w);
      if (v < hz) return Math.hypot(u - sx, v - sy) < 0.15 ? 1 : 0.15 + 0.6 * (v / hz) ** 2;
      const d = (v - hz) / (1 - hz);
      return (0.55 - 0.45 * d) * (0.5 + 0.5 * Math.sin(v * 90 - 2 * w)) * (1 - Math.min(1, Math.abs(u - sx) * 2.2)) + 0.05;
    };
  } else {
    const bl = Array.from({ length: 3 }, () => ({ x: 0.2 + r() * 0.6, y: 0.2 + r() * 0.6, s: 0.06 + r() * 0.08, o: 0.12 + r() * 0.1, ph: r() * TAU, d: r() < 0.5 ? 1 : -1 }));
    f = (u, v) => bl.reduce((s, b) => s + Math.exp(-((u - b.x - b.o * Math.cos(w * b.d + b.ph)) ** 2 + (v - b.y - b.o * Math.sin(w * b.d + b.ph)) ** 2) / b.s), 0) * 0.75;
  }
  fill(ctx, S, off);
  ctx.fillStyle = C(on); ctx.beginPath();
  for (let y = 0; y < G; y++) for (let x = 0; x < G; x++)
    if (f((x + 0.5) / G, (y + 0.5) / G, x, y) > (BAYER[y % 8][x % 8] + 0.5) / 64) ctx.rect(x * px, y * px, px + 0.3, px + 0.3);
  ctx.fill();
  // every cover is titled: an old window title bar, docked top or bottom, or floating across the picture
  const bh = Math.round(G * 0.09) * px;
  const y0 = place === 0 ? 0 : place === 1 ? S - bh : Math.round(midRow * G) * px;
  ctx.fillStyle = C(off); ctx.fillRect(0, y0, S, bh);
  ctx.fillStyle = C(on);
  for (let y = px * 2; y < bh - px; y += px * 2) ctx.fillRect(px * 2, y0 + y, S - px * 4, px * 0.9);
  if (place !== 0) ctx.fillRect(0, y0 - px, S, px);
  if (place !== 1) ctx.fillRect(0, y0 + bh, S, px);
  let fs = bh * 0.5; ctx.font = `500 ${fs}px ${MONO}`;
  const room = S - px * 26, raw = ctx.measureText(name).width; if (raw > room) { fs *= room / raw; ctx.font = `500 ${fs}px ${MONO}`; }
  const tw = Math.min(room, raw) + px * 6;
  ctx.fillStyle = C(off); ctx.fillRect((S - tw) / 2, y0, tw, bh); ctx.fillRect(px * 6, y0 + px, bh - px * 2, bh - px * 2);
  ctx.strokeStyle = C(on); ctx.lineWidth = px; ctx.strokeRect(px * 7, y0 + px * 2, bh - px * 4, bh - px * 4);
  ctx.fillStyle = C(on); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(name, S / 2, y0 + bh / 2 + px * 0.3);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
};
