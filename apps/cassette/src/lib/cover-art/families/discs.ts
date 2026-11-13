import { C, mix, ease, TAU, WHITE } from "../color";
import type { Col } from "../color";
import type { FamilyDraw } from "../kit";
import { fill, disc } from "../kit";
import { F } from "../fonts";

type Coin = { x: number; y: number; stops: Col[]; th: number; ch: string };

export const draw: FamilyDraw = (ctx, S, p, name, r, ph, o, kit) => {
  fill(ctx, S, [0.17, 0.012, p.ink[2]]);
  const w = TAU * ph, T = o.titles;
  const cols = [p.c1, p.c2, p.c3, mix(p.c1, p.c2, 0.5), mix(p.c2, p.ink, 0.45)];
  // with titles on, each coin carries a letter, one row per word, so the name flips through the grid
  const words = name.toUpperCase().split(/\s+/).filter(Boolean).slice(0, 3), nr = r() < 0.5 ? 3 : 4;
  const grid = T && words.length ? words.map(wd => [...wd]) : Array.from({ length: nr }, () => Array(nr === 3 ? 5 : 6).fill(""));
  const rows = grid.length, maxLen = Math.max(...grid.map(g => g.length));
  const R = Math.min(S * [0.19, 0.15, 0.125, 0.1][Math.min(3, rows - 1)], S * 0.9 / (1.38 * (maxLen - 1) + 2)), dx = R * 1.38;
  const rowH = Math.min(S * 0.88 / rows, R * 2.6), y0 = S / 2 - rowH * (rows - 1) / 2;
  // every coin flips over once on the way out and once on the way back, the flips cascading corner to corner across the grid
  const D = 0.09;
  grid.forEach((row, j) => {
    const per = row.length, dir = j % 2 ? -1 : 1, x0 = (S - dx * (per - 1)) / 2, items: Coin[] = [];
    row.forEach((ch, i) => {
      const k = Math.floor(r() * cols.length), stops = [cols[k], cols[(k + 1 + Math.floor(r() * 2)) % cols.length], cols[(k + 3) % cols.length]];
      const slot = (i + j * 0.7) / (maxLen + rows * 0.7) * 0.42, u = ((ph - slot) % 1 + 1) % 1;
      const turn = u < D ? ease(u / D) : u < 0.5 ? 1 : u < 0.5 + D ? 1 + ease((u - 0.5) / D) : 2;
      const th = (i - (per - 1) / 2) * 0.3 * dir * (T ? 0.5 : 1) + 0.12 * Math.sin(w + j * 1.3 + i * 0.35) + turn * Math.PI;
      items.push({ x: x0 + i * dx, y: y0 + j * rowH, stops, th, ch });
    });
    if (dir < 0) items.reverse();
    for (const it of items) {
      const c = Math.cos(it.th), s = Math.sin(it.th), rx = Math.max(0.6, R * Math.abs(c));
      const [a, b, d] = c >= 0 ? it.stops : [...it.stops].reverse();
      ctx.save(); ctx.translate(it.x, it.y); ctx.scale(Math.max(0.05, rx / R), 1);
      const halo = ctx.createRadialGradient(0, 0, R * 0.8, 0, 0, R * 1.3);
      halo.addColorStop(0, C(b, 0.35)); halo.addColorStop(1, C(b, 0));
      ctx.fillStyle = halo; disc(ctx, 0, 0, R * 1.3); ctx.restore();
      // the rim, peeking out on the side the coin is turning away from
      ctx.fillStyle = C(mix(b, p.c3, 0.55));
      ctx.beginPath(); ctx.ellipse(it.x + s * R * 0.1, it.y, rx, R, 0, 0, TAU); ctx.fill();
      const g = ctx.createLinearGradient(0, it.y - R, 0, it.y + R);
      g.addColorStop(0, C(a)); g.addColorStop(0.5, C(b)); g.addColorStop(1, C(d));
      ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(it.x, it.y, rx, R, 0, 0, TAU); ctx.fill();
      if (it.ch) {
        // the letter is struck on both faces, and turns with the coin
        ctx.save(); ctx.translate(it.x, it.y); ctx.scale(Math.max(0.02, rx / R), 1);
        ctx.font = `400 ${R * 1.05}px ${F.heavy}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = C(b[0] > 0.62 ? p.ink : WHITE, 0.9); ctx.fillText(it.ch, 0, R * 0.05); ctx.restore();
      }
    }
  });
  kit.grain(ctx, S, 0.22);
};
