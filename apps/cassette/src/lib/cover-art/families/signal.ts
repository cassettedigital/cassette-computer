import { C, mix, TAU } from "../color";
import type { FamilyDraw } from "../kit";
import { fill } from "../kit";
import { DISPLAY, MONO } from "../fonts";

export const draw: FamilyDraw = (ctx, S, p, name, r, ph, o, kit) => {
  const w = TAU * ph, pick = Math.floor(r() * 3), kind = o.titles ? pick : 1 + (pick % 2), ch = 2 + Math.floor(r() * 11);
  fill(ctx, S, [0.12, 0.01, p.bg[2]]);
  const m = S * 0.07, sw = S - m * 2;
  ctx.save();
  ctx.beginPath(); ctx.roundRect(m, m, sw, sw, S * 0.09); ctx.clip();
  fill(ctx, S, mix(p.ink, p.c2, 0.12));
  ctx.globalCompositeOperation = "lighter";
  if (kind === 0) {
    // the initials, in phosphor, with a red-blue split
    const words = name.toUpperCase().split(/\s+/).filter(Boolean);
    const txt = words.length > 1 ? words.slice(0, 2).map(x => x[0]).join("") : name.toUpperCase().slice(0, 3);
    ctx.font = `800 100px ${DISPLAY}`; const size = Math.min(S * 0.5, sw * 0.7 * 100 / ctx.measureText(txt).width);
    ctx.font = `800 ${size}px ${DISPLAY}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const jit = S * 0.006 * (1 + Math.sin(w * 3));
    ctx.shadowBlur = S * 0.05; ctx.shadowColor = C(p.c1, 0.8);
    ctx.fillStyle = C(p.c2, 0.6); ctx.fillText(txt, S / 2 - jit, S / 2 + S * 0.02);
    ctx.fillStyle = C(p.c1, 0.95); ctx.fillText(txt, S / 2 + jit, S / 2 + S * 0.02);
    ctx.shadowBlur = 0; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  } else if (kind === 1) {
    // colour bars, the test card everyone recognises
    const bars = [p.c3, p.c1, p.c2, mix(p.c1, p.c2, 0.5), mix(p.c1, p.c3, 0.5), mix(p.c2, p.c3, 0.5), p.c1];
    const bw = sw / bars.length;
    bars.forEach((c, i) => { ctx.fillStyle = C(c, 0.8); ctx.fillRect(m + i * bw, m, bw + 0.5, sw * 0.68); });
    [...bars].reverse().forEach((c, i) => { ctx.fillStyle = C(c, 0.35); ctx.fillRect(m + i * bw, m + sw * 0.68, bw + 0.5, sw * 0.08); });
    ctx.fillStyle = C(p.c3, 0.2); ctx.fillRect(m, m + sw * 0.76, sw, sw * 0.24);
  } else {
    // a trace sweeping across a dark tube
    const k = 2 + Math.floor(r() * 3), a = sw * (0.18 + r() * 0.1);
    ctx.lineWidth = S * 0.012; ctx.shadowBlur = S * 0.04; ctx.shadowColor = C(p.c1);
    ctx.strokeStyle = C(p.c1, 0.9); ctx.beginPath();
    for (let x = m; x <= S - m; x += S / 160) { const t = (x - m) / sw; ctx.lineTo(x, S / 2 + a * Math.sin(k * TAU * t - w) * Math.sin(Math.PI * t)); }
    ctx.stroke(); ctx.shadowBlur = 0;
  }
  ctx.globalCompositeOperation = "source-over";
  // on-screen display
  ctx.font = `500 ${S * 0.05}px ${MONO}`; ctx.fillStyle = C(p.c3, 0.85);
  ctx.fillText(`CH ${String(ch).padStart(2, "0")}`, m + S * 0.06, m + S * 0.1);
  if (o.titles) {
    if (kind === 1) {
      // stand-by bars get a black caption box
      ctx.font = `500 ${S * 0.046}px ${MONO}`;
      const t = name.toUpperCase(), tw = Math.min(sw * 0.8, ctx.measureText(t).width), bx = m + S * 0.05, by = m + sw * 0.78;
      ctx.fillStyle = "#000"; ctx.fillRect(bx, by, tw + S * 0.06, S * 0.085);
      ctx.fillStyle = "#fff"; ctx.fillText(t, bx + S * 0.03, by + S * 0.058, sw * 0.8);
    } else {
      // the deck's on-screen display: PLAY up top, the name along the bottom
      ctx.textAlign = "right"; ctx.fillText("PLAY ▶", S - m - S * 0.06, m + S * 0.1);
      ctx.textAlign = "left"; ctx.fillText(name.toUpperCase().slice(0, 18), m + S * 0.06, S - m - S * 0.07);
    }
  }
  // scanlines, then a brighter bar rolling down once per loop
  ctx.fillStyle = "rgba(0, 0, 0, 0.32)";
  for (let y = m; y < S - m; y += Math.max(2, S / 104)) ctx.fillRect(m, y, sw, Math.max(1, S / 300));
  const by = m + ((ph * 1.25) % 1.25 - 0.15) * sw;
  const rb = ctx.createLinearGradient(0, by - sw * 0.12, 0, by + sw * 0.12);
  rb.addColorStop(0, "rgba(255, 255, 255, 0)"); rb.addColorStop(0.5, "rgba(255, 255, 255, 0.07)"); rb.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = rb; ctx.fillRect(m, m, sw, sw);
  const vg = ctx.createRadialGradient(S / 2, S / 2, sw * 0.3, S / 2, S / 2, sw * 0.75);
  vg.addColorStop(0, "rgba(0, 0, 0, 0)"); vg.addColorStop(1, "rgba(0, 0, 0, 0.6)");
  ctx.fillStyle = vg; ctx.fillRect(m, m, sw, sw);
  ctx.restore();
  kit.grain(ctx, S, 0.1, ph || 0.0001);
};
