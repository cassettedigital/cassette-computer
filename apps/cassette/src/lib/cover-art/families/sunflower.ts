import { C, mix, TAU, WHITE, CREAM } from "../color";
import type { FamilyDraw } from "../kit";
import { fill, disc } from "../kit";
import { F } from "../fonts";

export const draw: FamilyDraw = (ctx, S, p, name, r, ph, o, kit) => {
  const GA = Math.PI * (3 - Math.sqrt(5)), T = o.titles;
  const big = r() < 0.4, cx = big ? S * (0.2 + r() * 0.6) : S / 2, cy = big ? S * (0.75 + r() * 0.2) : S / 2;
  const N = big ? 700 : 420, c = (big ? S * 1.05 : S * 0.47) / Math.sqrt(N);
  const spiral = [13, 21, 34][Math.floor(r() * 3)], petals = r() < 0.4, pick = Math.floor(r() * 3), rot = r() * TAU;
  fill(ctx, S, p.bg);
  // with titles on, the name grows in a ring through the seeds, so a clear path is left for it
  const ringR = big ? S * 0.6 : S * 0.3, label = name.toUpperCase();
  let tsz = big ? S * 0.07 : S * 0.058;
  if (T) { ctx.font = `600 ${tsz}px ${F.label}`; const span = (ctx.measureText(label).width + label.length * tsz * 0.12) / ringR, room = big ? 1.15 : Math.PI * 1.5; if (span > room) tsz *= room / span; }
  // the head holds still; a ripple runs out along the spirals instead, each seed swelling and changing ink as it passes, out and back once per loop
  for (let n = 1; n < N; n++) {
    const a = n * GA + rot, rad = c * Math.sqrt(n), x = cx + rad * Math.cos(a), y = cy + rad * Math.sin(a);
    if (x < -S * 0.05 || y < -S * 0.05 || x > S * 1.05 || y > S * 1.05) continue;
    if (T && Math.abs(rad - ringR) < tsz * 0.85) continue;
    const lane = n % spiral, slot = Math.sqrt(n / N) * 0.3 + (lane / spiral) * 0.12;
    const u = ((ph - slot) % 1 + 1) % 1, flipped = u < 0.5, d = flipped ? u : u - 0.5, pop = d < 0.07 ? Math.sin(Math.PI * d / 0.07) : 0;
    let col = pick === 0 ? (lane % 2 ? p.c1 : p.c2) : pick === 1 ? (lane < spiral / 3 ? p.c2 : p.c1) : mix(p.c1, p.c2, n / N);
    if (flipped) col = pick === 2 ? mix(p.c2, p.c1, n / N) : col === p.c1 ? p.c2 : p.c1;
    ctx.fillStyle = C(mix(col, WHITE, 0.45 * pop), 0.95);
    const s = c * 0.42 * (0.7 + 0.3 * Math.sqrt(n / N)) * (1 + 0.55 * pop);
    if (petals) { ctx.beginPath(); ctx.ellipse(x, y, s * 1.4, s * 0.7, a, 0, TAU); ctx.fill(); }
    else disc(ctx, x, y, s);
  }
  if (T) {
    ctx.font = `600 ${tsz}px ${F.label}`; ctx.fillStyle = C(CREAM); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const widths = [...label].map(ch => ctx.measureText(ch).width + tsz * 0.12), total = widths.reduce((s, v) => s + v, 0);
    let a = Math.atan2(S * 0.12 - cy, S / 2 - cx) - total / ringR / 2;
    [...label].forEach((ch, i) => {
      const aa = a + widths[i] / 2 / ringR;
      ctx.save(); ctx.translate(cx + Math.cos(aa) * ringR, cy + Math.sin(aa) * ringR); ctx.rotate(aa + Math.PI / 2); ctx.fillText(ch, 0, 0); ctx.restore();
      a += widths[i] / ringR;
    });
    ctx.textBaseline = "alphabetic";
  }
  kit.grain(ctx, S, 0.1);
};
