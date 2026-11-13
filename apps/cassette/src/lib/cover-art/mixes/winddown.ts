import { C, TAU } from "../color";
import type { Ctx } from "../kit";
import { rng, hash } from "../rng";
import type { MixDraw } from "./util";

/**
 * Wind Down: a city at night seen through a rain-fogged window. Out there, towers, neon
 * and traffic melt into light; on the glass the name is written in the condensation with a
 * fingertip, and drops gather, stall and run down either side of it, clearing trails that
 * slowly mist over again.
 */
const HAND = '"Nothing You Could Do", cursive';

type Light = { x: number; y: number; r: number; col: number[]; a: number; hot?: boolean };

/** The city in unit coordinates, drawn into a small canvas so that scaling it up blurs it. */
function city(c: Ctx, w: number, ph: number, seed: number): Light[] {
  const r = rng(seed), lights: Light[] = [];
  c.setTransform(w, 0, 0, w, 0, 0);
  const sky = c.createLinearGradient(0, 0, 0, 1);
  sky.addColorStop(0, C([0.15, 0.05, 280])); sky.addColorStop(0.45, C([0.28, 0.11, 318])); sky.addColorStop(0.7, C([0.4, 0.15, 345])); sky.addColorStop(1, C([0.12, 0.04, 285]));
  c.fillStyle = sky; c.fillRect(0, 0, 1, 1);
  // two rows of towers, the far one hazier
  for (const [row, top0, top1, col, lit] of [[0, 0.3, 0.5, [0.2, 0.07, 295], 0.2], [1, 0.14, 0.46, [0.1, 0.045, 285], 0.4]] as [number, number, number, number[], number][]) {
    let x = -0.05;
    while (x < 1.05) {
      const bw = 0.07 + r() * (row ? 0.12 : 0.09), top = top0 + r() * (top1 - top0);
      c.fillStyle = C(col); c.fillRect(x, top, bw, 0.84 - top);
      if (r() < 0.3) c.fillRect(x + bw * 0.45, top - 0.05, bw * 0.06, 0.05);
      for (let wy = top + 0.03; wy < 0.8; wy += 0.035) for (let wx = x + 0.012; wx < x + bw - 0.012; wx += 0.022) {
        if (r() > lit) continue;
        const tone = r() < 0.7 ? [0.82, 0.12, 75] : r() < 0.6 ? [0.84, 0.07, 215] : [0.75, 0.16, 350];
        c.fillStyle = C(tone, row ? 0.95 : 0.6); c.fillRect(wx, wy, 0.009, 0.014);
        if (row && r() < 0.025) lights.push({ x: wx, y: wy, r: 0.028, col: tone, a: 0.35 });
      }
      x += bw + 0.005;
    }
  }
  // neon: a tall pink blade, a cyan bar, an orange one
  for (const [x, y, w2, h2, col] of [[0.07, 0.4, 0.022, 0.22, [0.7, 0.25, 352]], [0.56, 0.68, 0.16, 0.022, [0.82, 0.14, 200]], [0.86, 0.26, 0.02, 0.14, [0.75, 0.18, 50]]] as [number, number, number, number, number[]][]) {
    c.fillStyle = C(col); c.fillRect(x, y, w2, h2);
    lights.push({ x: x + w2 / 2, y: y + h2 / 2, r: 0.06 + Math.max(w2, h2) * 0.25, col, a: 0.55, hot: true });
  }
  // the street: wet, with the lights smeared down into it
  c.fillStyle = C([0.1, 0.035, 285]); c.fillRect(0, 0.84, 1, 0.16);
  for (const l of lights.slice(-3)) {
    const g = c.createLinearGradient(0, 0.84, 0, 1);
    g.addColorStop(0, C(l.col, 0.55)); g.addColorStop(1, C(l.col, 0));
    c.fillStyle = g; c.fillRect(l.x - 0.02, 0.84, 0.04, 0.16);
  }
  // street lamps, warm
  for (const x of [0.08, 0.42, 0.74]) lights.push({ x, y: 0.8, r: 0.04, col: [0.86, 0.13, 72], a: 0.55 });
  // traffic: tail lights drifting left, headlights right, each a whole lap a loop
  for (let i = 0; i < 4; i++) {
    const dir = i % 2 ? 1 : -1, lane = 0.88 + (i % 2) * 0.05, x0 = r();
    const x = ((((x0 + dir * ph) % 1) + 1) % 1) * 1.2 - 0.1;
    const col = dir < 0 ? [0.62, 0.22, 25] : [0.96, 0.03, 90];
    lights.push({ x, y: lane, r: 0.03, col, a: 0.7 }, { x: x + 0.035, y: lane, r: 0.03, col, a: 0.7 });
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  return lights;
}

/** The name as it was written on the glass with a fingertip, in black, onto `c`. */
function writing(c: Ctx, S: number, dy = 0) {
  const size = S * 0.22;
  c.save(); c.translate(S * 0.47, S * 0.45 + dy); c.rotate(-0.07);
  c.font = `400 ${size}px ${HAND}`; c.textAlign = "center"; c.textBaseline = "middle";
  c.lineJoin = "round"; c.lineCap = "round"; c.lineWidth = size * 0.07;
  c.shadowColor = "rgba(0, 0, 0, 1)"; c.shadowBlur = S * 0.012;
  ["wind", "down"].forEach((l, i) => {
    const y = (i - 0.5) * size * 0.82, x = i ? size * 0.32 : -size * 0.22;
    c.strokeStyle = "rgba(0, 0, 0, 0.97)"; c.strokeText(l, x, y); c.fillStyle = "rgba(0, 0, 0, 0.97)"; c.fillText(l, x, y);
  });
  c.restore();
}

export const fogged: MixDraw = (ctx, S, ph, o, kit) => {
  const r = rng(hash("mix|wind-down"));
  // the city, out of focus: drawn tiny, then scaled up twice
  const lo = Math.max(6, Math.round(S / 9)), mid = Math.max(12, Math.round(S / 3.4));
  const cl = kit.scratch("city-lo", lo), cm = kit.scratch("city-mid", mid);
  const lights = city(kit.ctxOf(cl), lo, ph, hash("mix|wind-down|city"));
  const mc = kit.ctxOf(cm);
  mc.setTransform(1, 0, 0, 1, 0, 0); mc.imageSmoothingEnabled = true; mc.drawImage(cl, 0, 0, mid, mid);
  ctx.imageSmoothingEnabled = true; ctx.drawImage(cm, 0, 0, S, S);
  // the brightest lights as soft discs, the way a lens draws what it isn't focused on
  ctx.globalCompositeOperation = "screen";
  for (const l of lights) {
    const x = l.x * S, y = l.y * S, rad = l.r * S;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, C(l.col, l.a * 0.8)); g.addColorStop(0.85, C(l.col, l.a * 0.6)); g.addColorStop(1, C(l.col, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";

  // rain falling outside, faint
  ctx.strokeStyle = C([0.8, 0.04, 300], 0.14); ctx.lineWidth = Math.max(1, S * 0.003); ctx.beginPath();
  for (let i = 0; i < 46; i++) {
    const x = r() * S * 1.2 - S * 0.1, y0 = r(), len = S * (0.05 + r() * 0.06), sp = 2 + Math.floor(r() * 3);
    const y = (((y0 + ph * sp) % 1) * 1.3 - 0.15) * S;
    ctx.moveTo(x, y); ctx.lineTo(x - len * 0.18, y + len);
  }
  ctx.stroke();

  // the fog on the glass, lit by the neon, with the writing and the drop trails wiped out of it
  const fog = kit.scratch("fog", S), f = kit.ctxOf(fog);
  f.setTransform(1, 0, 0, 1, 0, 0); f.globalCompositeOperation = "source-over"; f.clearRect(0, 0, S, S);
  const fa = 0.03 * Math.sin(TAU * ph), mist = f.createLinearGradient(0, 0, 0, S);
  mist.addColorStop(0, C([0.6, 0.05, 300], 0.62 + fa)); mist.addColorStop(0.55, C([0.58, 0.06, 310], 0.72 + fa)); mist.addColorStop(1, C([0.55, 0.07, 320], 0.8 + fa));
  f.fillStyle = mist; f.fillRect(0, 0, S, S);
  for (const l of lights.filter((l) => l.a >= 0.55)) {
    const g = f.createRadialGradient(l.x * S, l.y * S, 0, l.x * S, l.y * S, S * 0.32);
    g.addColorStop(0, C(l.col, 0.3)); g.addColorStop(1, C(l.col, 0));
    f.fillStyle = g; f.fillRect(0, 0, S, S);
  }
  f.globalCompositeOperation = "destination-out";
  if (o.titles) writing(f, S);
  // drops that run: each stalls and slides down its own line once a loop, either side of the name
  const cols = o.titles ? [0.07, 0.15, 0.87, 0.95] : [0.14, 0.38, 0.62, 0.86];
  const runs = cols.map((c) => ({ x: S * (c + (r() - 0.5) * 0.04), off: r(), rad: S * (0.016 + r() * 0.008), stops: 2 + Math.floor(r() * 2) }));
  const placed = runs.map((d) => {
    const u = (ph + d.off) % 1, L = S * 1.75, top = -S * 0.12;
    const prog = (v: number) => v - Math.sin(TAU * v * d.stops) / (TAU * d.stops);
    const y = top + L * prog(u), wob = Math.sin(y * 0.05 + d.off * 9) * S * 0.006;
    return { ...d, y, x: d.x + wob, top, len: S * 0.42 };
  });
  for (const d of placed) {
    const y1 = Math.max(d.top, d.y - d.len);
    const tg = f.createLinearGradient(0, y1, 0, d.y);
    tg.addColorStop(0, "rgba(0, 0, 0, 0)"); tg.addColorStop(1, "rgba(0, 0, 0, 0.85)");
    f.strokeStyle = tg; f.lineWidth = d.rad * 1.5; f.lineCap = "round";
    f.beginPath(); f.moveTo(d.x - Math.sin(y1 * 0.05 + d.off * 9) * S * 0.004, y1); f.lineTo(d.x, d.y); f.stroke();
  }
  f.globalCompositeOperation = "source-over";
  ctx.drawImage(fog, 0, 0);
  if (o.titles) {
    // through the wiped glass the street is sharper and deeper than through the mist
    const clear = kit.scratch("clear", S), c = kit.ctxOf(clear);
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalCompositeOperation = "source-over"; c.clearRect(0, 0, S, S);
    c.imageSmoothingEnabled = true; c.drawImage(cm, 0, 0, S, S);
    c.fillStyle = C([0.12, 0.06, 290], 0.35); c.fillRect(0, 0, S, S);
    c.globalCompositeOperation = "destination-in"; writing(c, S); c.globalCompositeOperation = "source-over";
    ctx.drawImage(clear, 0, 0);
  }
  // the three signs burn through the mist: hot cores, wide halos
  ctx.globalCompositeOperation = "screen";
  for (const l of lights.filter((l) => l.hot)) {
    const x = l.x * S, y = l.y * S, rad = S * 0.17;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, C([0.97, 0.04, l.col[2]], 0.95)); g.addColorStop(0.12, C(l.col, 0.85)); g.addColorStop(0.45, C(l.col, 0.3)); g.addColorStop(1, C(l.col, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill();
  }
  ctx.globalCompositeOperation = "source-over";
  if (o.titles) {
    // the ridge of water along the bottom of each stroke catches the light
    const rim = kit.scratch("rim", S), m = kit.ctxOf(rim);
    m.setTransform(1, 0, 0, 1, 0, 0); m.globalCompositeOperation = "source-over"; m.clearRect(0, 0, S, S);
    writing(m, S);
    m.globalCompositeOperation = "destination-out"; writing(m, S, -S * 0.007);
    m.globalCompositeOperation = "source-in"; m.fillStyle = C([0.95, 0.04, 320]); m.fillRect(0, 0, S, S);
    m.globalCompositeOperation = "source-over";
    ctx.save(); ctx.globalAlpha = 0.7; ctx.drawImage(rim, 0, 0); ctx.restore();
  }

  // beads of condensation catching the city's colour, and the running drops themselves
  const bead = (x: number, y: number, rad: number) => {
    ctx.fillStyle = C([0.12, 0.05, 290], 0.35); ctx.beginPath(); ctx.ellipse(x, y + rad * 0.25, rad, rad * 0.95, 0, 0, TAU); ctx.fill();
    const bg = ctx.createRadialGradient(x, y + rad * 0.3, 0, x, y, rad);
    bg.addColorStop(0, C([0.62, 0.12, 340], 0.55)); bg.addColorStop(1, C([0.72, 0.06, 300], 0.7));
    ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(x, y, rad * 0.88, 0, TAU); ctx.fill();
    ctx.fillStyle = C([0.98, 0.02, 300], 0.85); ctx.beginPath(); ctx.arc(x - rad * 0.32, y - rad * 0.34, rad * 0.22, 0, TAU); ctx.fill();
  };
  for (let i = 0; i < 70; i++) { const x = r() * S, y = r() * S, rad = S * (0.003 + r() * r() * 0.012); bead(x, y, rad); }
  for (const d of placed) if (d.y > -d.rad && d.y < S + d.rad) bead(d.x, d.y, d.rad);
  kit.grain(ctx, S, 0.12);
};
