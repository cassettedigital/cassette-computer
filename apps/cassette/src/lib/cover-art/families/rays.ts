import { C, mix, TAU, WHITE, CREAM, rainbow } from "../color";
import type { FamilyDraw } from "../kit";
import { fitSize, twoLines, sparkle, glint, spacedText } from "../kit";
import { F } from "../fonts";

export const draw: FamilyDraw = (ctx, S, p, name, r, ph, o, kit) => {
  const w = TAU * ph, kind = Math.floor(r() * 3), T = o.titles;
  if (kind === 0) {
    // flat white rays from a point past the edge, over a grainy gradient that shifts with the angle; the fan sweeps slowly up and back
    const fx = S * 1.02, fy = S * (0.42 + r() * 0.22);
    const g = ctx.createConicGradient(Math.PI * 0.5 + 0.35 * Math.sin(w), fx, fy);
    const ring = [p.c1, mix(p.c1, p.ink, 0.6), p.c2, mix(p.c2, p.c3, 0.35), p.c1, mix(p.c1, p.c3, 0.35)];
    ring.forEach((c, i) => g.addColorStop(i / (ring.length - 1) * 0.5, C(c)));
    g.addColorStop(1, C(ring[0]));
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    kit.grain(ctx, S, 0.38);
    const N = 13 + Math.floor(r() * 7), sweep = 0.09 * Math.sin(w);
    const angs = Array.from({ length: N }, (_, i) => Math.PI * 0.5 + (i + 0.2 + r() * 0.6) / N * Math.PI);
    ctx.strokeStyle = C(WHITE); ctx.lineWidth = S * 0.02; ctx.lineCap = "butt"; ctx.beginPath();
    for (const a of angs) { ctx.moveTo(fx, fy); ctx.lineTo(fx + Math.cos(a + sweep) * S * 2, fy + Math.sin(a + sweep) * S * 2); }
    ctx.stroke();
    // stars sit right on their rays, one arm running along the ray, and ride with it
    ctx.fillStyle = C(WHITE);
    const n = 2 + Math.floor(r() * 2), placed: number[][] = [];
    for (let tries = 0; tries < 40 && placed.length < n; tries++) {
      const k = Math.floor(r() * N), d = S * (0.35 + r() * 0.65), rad = S * (0.05 + r() * 0.07), q = r() * TAU;
      const a0 = angs[k], x0 = fx + Math.cos(a0) * d, y0 = fy + Math.sin(a0) * d;
      if (x0 < S * 0.1 || x0 > S * 0.88 || y0 < S * 0.1 || y0 > S * 0.9 || placed.some(([px, py]) => Math.hypot(px - x0, py - y0) < S * 0.22)) continue;
      placed.push([x0, y0]);
      const a = a0 + sweep;
      sparkle(ctx, fx + Math.cos(a) * d, fy + Math.sin(a) * d, rad * (0.8 + 0.2 * Math.sin(w * 2 + q)), a);
    }
    if (T) {
      // the name runs out along the widest gap between two rays, reading toward the light
      let best = null;
      for (let i = 0; i < N - 1; i++) {
        const a = (angs[i] + angs[i + 1]) / 2, gw = angs[i + 1] - angs[i];
        if (a < Math.PI * 0.66 || a > Math.PI * 1.34) continue;
        const score = gw * (1 - 0.6 * Math.abs(a - Math.PI) / Math.PI);
        if (!best || score > best.score) best = { score, a, gw };
      }
      if (best) {
        const a = best.a + sweep, d = S * 0.6, text = name.toUpperCase();
        const size = Math.min(fitSize(ctx, text, F.anton, 400, S * 0.72, S * 0.22), best.gw * d * 0.72 / 0.73);
        ctx.save(); ctx.translate(fx + Math.cos(a) * d, fy + Math.sin(a) * d); ctx.rotate(a + Math.PI);
        ctx.font = `400 ${size}px ${F.anton}`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = C(WHITE);
        ctx.fillText(text, 0, size * 0.04); ctx.restore();
      }
    }
  } else if (kind === 1) {
    // a laser show: rainbow beams sweeping across each other out of a white flare, on rosy grain
    const fx = S * (0.38 + r() * 0.24), fy = S * (0.58 + r() * 0.14);
    const bg = ctx.createRadialGradient(fx, fy, 0, fx, fy, S * 0.95);
    bg.addColorStop(0, C(mix(p.c1, p.c3, 0.55))); bg.addColorStop(0.5, C(mix(p.c1, p.c3, 0.15))); bg.addColorStop(1, C(mix(p.c1, p.ink, 0.45)));
    ctx.fillStyle = bg; ctx.fillRect(0, 0, S, S);
    kit.grain(ctx, S, 0.32);
    ctx.globalCompositeOperation = "screen";
    const N = 7 + Math.floor(r() * 3), a0 = -Math.PI * (0.64 + r() * 0.08), spread = Math.PI * (0.36 + r() * 0.12);
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1), k = 1 + (i % 2), a = a0 + t * spread + 0.16 * Math.sin(w * k + i * 1.7), col = rainbow(p, t), half = 0.022 + 0.008 * Math.sin(w * 2 + i);
      const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, S * 1.3);
      g.addColorStop(0, C(WHITE, 0.9)); g.addColorStop(0.15, C(col, 0.8)); g.addColorStop(1, C(col, 0.2));
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(fx, fy);
      ctx.lineTo(fx + Math.cos(a - half) * S * 1.5, fy + Math.sin(a - half) * S * 1.5); ctx.lineTo(fx + Math.cos(a + half) * S * 1.5, fy + Math.sin(a + half) * S * 1.5);
      ctx.closePath(); ctx.fill();
    }
    const fl = 1 + 0.2 * Math.sin(w * 2);
    const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, S * 0.2 * fl);
    fg.addColorStop(0, C(WHITE, 1)); fg.addColorStop(0.25, C(WHITE, 0.5)); fg.addColorStop(1, C(WHITE, 0));
    ctx.fillStyle = fg; ctx.fillRect(0, 0, S, S);
    glint(ctx, fx, fy, S * 0.38 * fl, WHITE, 0.7);
    for (let i = 0; i < 5; i++) { const q = r() * TAU, x = S * (0.1 + r() * 0.8), y = S * (0.08 + r() * 0.6), len = S * (0.025 + r() * 0.035); glint(ctx, x, y, len * (0.3 + 0.7 * Math.max(0, Math.sin(w * 2 + q))), WHITE, 0.9); }
    ctx.globalCompositeOperation = "source-over";
    if (T) {
      // the name at the heart of the show, the beams bursting out from behind it
      const lines = twoLines(name.toUpperCase(), 11);
      const size = Math.min(...lines.map(l => fitSize(ctx, l, F.vhs, "italic 900", S * 0.82, S * 0.17)));
      ctx.font = `italic 900 ${size}px ${F.vhs}`; ctx.textAlign = "center";
      const top = fy - (lines.length * size * 0.9) / 2 + size * 0.72;
      ctx.save(); ctx.shadowColor = C(p.c1, 0.95); ctx.shadowBlur = S * 0.05; ctx.fillStyle = C(WHITE);
      lines.forEach((l, i) => ctx.fillText(l, S / 2, top + i * size * 0.9)); ctx.restore();
    }
  } else {
    // soft rays fanning down from above the frame over airbrushed bands that drift, with a dark hill rising and settling into them
    const bands = [mix(p.c1, p.c2, 0.5), p.c2, mix(p.c2, p.c3, 0.4), p.c1, mix(p.c1, p.c3, 0.5), p.c2, mix(p.c1, p.c2, 0.5)];
    const drift = S * 0.22 * Math.sin(w), g = ctx.createLinearGradient(0, -S * 0.3 + drift, 0, S * 1.3 + drift);
    bands.forEach((c, i) => g.addColorStop(i / (bands.length - 1), C(c)));
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    const vx = S / 2, vy = -S * 0.04, N = 9 + 2 * Math.floor(r() * 3), spread = (1.1 + r() * 0.4) * (1 + 0.12 * Math.sin(w + 1));
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1) - 0.5, a = Math.PI / 2 + t * spread, glow = 0.55 + 0.45 * Math.sin(w * 2 - Math.abs(t) * 6);
      const g2 = ctx.createLinearGradient(vx, vy, vx + Math.cos(a) * S * 1.2, vy + Math.sin(a) * S * 1.2);
      g2.addColorStop(0, C(p.c1, 0.9 * glow)); g2.addColorStop(1, C(p.c1, 0.25 * glow));
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.moveTo(vx, vy); ctx.lineTo(vx + Math.cos(a - 0.006) * S * 1.3, vy + Math.sin(a - 0.006) * S * 1.3); ctx.lineTo(vx + Math.cos(a + 0.006) * S * 1.3, vy + Math.sin(a + 0.006) * S * 1.3); ctx.closePath(); ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    const Hh = S * (0.48 + 0.1 * Math.sin(w)), W = S * (0.26 + r() * 0.06);
    const hill = kit.path(); hill.moveTo(-S * 0.1, S * 1.1);
    for (let x = -S * 0.1; x <= S * 1.1; x += S / 60) hill.lineTo(x, S * 1.04 - Hh * Math.exp(-(((x - S / 2) / W) ** 2)));
    hill.lineTo(S * 1.1, S * 1.1); hill.closePath();
    ctx.save(); ctx.shadowColor = C(p.c3, 0.8); ctx.shadowBlur = S * 0.08; ctx.fillStyle = C(p.ink); ctx.fill(hill); ctx.restore();
    ctx.save(); ctx.shadowColor = C(p.ink); ctx.shadowBlur = S * 0.05; ctx.fillStyle = C(p.ink); ctx.fill(hill); ctx.restore();
    kit.grain(ctx, S, 0.3);
    if (T) {
      // small and quiet on the dark hill, like a poster's title
      const t = name.toUpperCase(); let fs = S * 0.05;
      ctx.font = `500 ${fs}px ${F.grotesk}`;
      const wd = ctx.measureText(t).width + fs * 0.3 * (t.length - 1); if (wd > S * 0.62) { fs *= S * 0.62 / wd; ctx.font = `500 ${fs}px ${F.grotesk}`; }
      ctx.fillStyle = C(CREAM, 0.92); spacedText(ctx, t, S / 2, S * 0.88, fs * 0.3, "center");
    }
  }
};
