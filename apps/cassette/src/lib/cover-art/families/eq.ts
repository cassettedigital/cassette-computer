import { C, mix, clamp, TAU, WHITE, rainbow } from "../color";
import type { FamilyDraw } from "../kit";
import { fill, disc, DESIGN_SIZE } from "../kit";

export const draw: FamilyDraw = (ctx, S, p, name, r, ph, o, kit) => {
  const T = o.titles;
  const n = [7, 9, 10, 12][Math.floor(r() * 4)], segs = 14, mirror = r() < 0.3, dots = r() < 0.3, style = Math.floor(r() * 3);
  // a hi-fi faceplate in smoked glass
  fill(ctx, S, style === 1 ? mix([0.14, 0.02, 200], p.c2, 0.15) : [0.13, 0.015, p.ink[2]]);
  const pad = S * 0.1, top = T ? S * 0.34 : S * 0.11, bottom = S * 0.89, bw = (S - 2 * pad) / n, sh = (bottom - top) / segs;
  const params = Array.from({ length: n }, () => ({ p1: r() * TAU, p2: r() * TAU, k1: 1 + Math.floor(r() * 3), k2: 2 + Math.floor(r() * 3) }));
  const lvl = (i: number, t: number) => { const q = params[i], wt = TAU * t, shape = 1 - Math.abs(i / Math.max(1, n - 1) - 0.35) * 0.9; return clamp(shape * 0.55 + 0.25 * Math.sin(wt * q.k1 + q.p1) + 0.15 * Math.sin(wt * q.k2 * 2 + q.p2) + 0.1, 0.06, 1); };
  // three looks: a rainbow across the bands, a vacuum-fluorescent display with a hot top, or the classic heat by height
  const vfd = mix(p.c2, WHITE, 0.25);
  const segCol = (i: number, f: number) => style === 0 ? rainbow(p, i / (n - 1)) : style === 1 ? (f > 0.8 ? p.c1 : vfd) : (f >= 0.82 ? p.c1 : f >= 0.6 ? p.c3 : p.c2);
  const count = mirror ? segs / 2 : segs;
  for (let i = 0; i < n; i++) {
    const lit = Math.round(lvl(i, ph) * count);
    // peak hold: the highest point of the last moment or so, falling back slowly
    let peak = 0; for (let k = 0; k < 9; k++) peak = Math.max(peak, lvl(i, ph - k * 0.006) - k * 0.011);
    const peakSeg = Math.min(count - 1, Math.round(peak * count));
    const x = pad + i * bw;
    for (let s = 0; s < count; s++) {
      const on = s < lit, f = s / count, col = segCol(i, f), isPeak = !on && s === peakSeg;
      const ys = mirror ? [(top + bottom) / 2 - (s + 1) * sh, (top + bottom) / 2 + s * sh] : [bottom - (s + 1) * sh];
      for (const y of ys) {
        if (on || isPeak) {
          // a soft bloom behind each lit segment, then the segment itself
          ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = C(col, isPeak ? 0.12 : 0.2);
          ctx.fillRect(x + bw * 0.02, y - sh * 0.15, bw * 0.96, sh * 1.3);
          ctx.globalCompositeOperation = "source-over"; ctx.fillStyle = C(isPeak ? mix(col, WHITE, 0.6) : mix(col, WHITE, 0.12));
        } else ctx.fillStyle = C(col, style === 1 ? 0.1 : 0.06);
        if (dots) disc(ctx, x + bw / 2, y + sh / 2, Math.min(bw, sh) * 0.36);
        else ctx.fillRect(x + bw * 0.12, y + sh * 0.18, bw * 0.76, sh * 0.64);
      }
    }
  }
  ctx.globalCompositeOperation = "source-over";
  if (T) {
    // the name scrolls across a dot-matrix readout above the bands, lit in the meter's own colours
    const bmp = kit.ledText(name.toUpperCase()), cols = 30, cw = (S - 2 * pad) / cols, my = S * 0.08, span = bmp.w + 10, shift = Math.floor(ph * span);
    for (let cx = 0; cx < cols; cx++) for (let cy = 0; cy < 8; cy++) {
      const sx = (cx + shift) % span, on = sx < bmp.w && bmp.on(sx, cy);
      const col = style === 0 ? rainbow(p, cx / (cols - 1)) : style === 1 ? vfd : p.c1;
      const x = pad + (cx + 0.5) * cw, y = my + (cy + 0.5) * cw;
      if (on) { ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = C(col, 0.2); disc(ctx, x, y, cw * 0.62); ctx.globalCompositeOperation = "source-over"; ctx.fillStyle = C(mix(col, WHITE, 0.15)); }
      else ctx.fillStyle = C(col, 0.07);
      disc(ctx, x, y, cw * 0.36);
    }
  }
  // the fine mesh in front of a fluorescent display
  if (style === 1) { ctx.fillStyle = "rgba(0, 0, 0, 0.28)"; for (let y = 0; y < S; y += Math.max(2, S / 156)) ctx.fillRect(0, y, S, Math.max(1, S / DESIGN_SIZE)); }
  const gl = ctx.createLinearGradient(0, 0, S, S); gl.addColorStop(0, "rgba(255, 255, 255, 0.08)"); gl.addColorStop(0.45, "rgba(255, 255, 255, 0)"); gl.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = gl; ctx.fillRect(0, 0, S, S);
  kit.grain(ctx, S, 0.1);
};
