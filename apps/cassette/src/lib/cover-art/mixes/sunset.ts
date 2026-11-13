import { C, mix, type Col } from "../color";
import type { Ctx, Kit } from "../kit";
import { rng, hash } from "../rng";
import { blurred, loopNoise, photoGrain, smearX, type MixDraw } from "./util";

/*
 * Sunset, the streak: a frame of film shot from a moving car into the low sun. Clear blue
 * sky above a curved horizon; below it the light smears sideways, near black at the left
 * burning through red and orange to a white-gold flare at the right, the dark dragged into
 * long fingers. Abstract, but it still reads as a beach, a horizon and the sun. Coarse grain,
 * the name a tight stacked block standing on the horizon. Through the loop the smear slides and
 * breathes, as if the car is still moving. References: docs/mix-cover-refs/README.md.
 */

/** The word's face: chunky, so it can stand on the horizon like a landform. */
const FONT = (px: number) => `400 ${px}px "Rubik Mono One", "Arial Black", sans-serif`;
/** The name, stacked: SUN on SET. */
const ROWS = ["SUN", "SET"];
/** The block's width, as a share of the cover. */
const BLOCK = 0.54;

const SKY_TOP: Col = [0.7, 0.14, 236];
const SKY_LOW: Col = [0.78, 0.085, 246];
const HAZE: Col = [0.9, 0.04, 330];
const FLARE: Col = [0.97, 0.06, 95];
const GOLD: Col = [0.85, 0.17, 78];
const ORANGE: Col = [0.71, 0.2, 50];
const EMBER: Col = [0.48, 0.17, 38];
const SOOT: Col = [0.14, 0.025, 35];
const AIR: Col = [0.985, 0.025, 90];

/** The horizon: a gentle curve, higher at the left, falling away to the right. */
const horizon = (x: number) => 0.37 + 0.05 * x + 0.12 * x * x;
const slope = (x: number) => 0.05 + 0.24 * x;
/** The crest of the sand drifted up over the name's feet: a low mound along the horizon under the block. */
const crest = (x: number, k = 1) => horizon(x) - 0.03 * k * Math.pow(Math.max(0, Math.sin(Math.PI * ((x - 0.14) / 0.74))), 1.4);

/** The smear's fingers: [height below the horizon (0..1 of what's left), thickness, reach, seed]. */
const FINGERS: number[][] = (() => {
  const r = rng(hash("mix|golden-hour|streak"));
  return Array.from({ length: 46 }, (_, i) => {
    const t = (i + r() * 0.8) / 46;
    return [t, 0.012 + r() * 0.03, 0.42 + 0.32 * Math.sin(t * Math.PI * 0.9) + r() * 0.18, r() * 10];
  });
})();

/** Everything below the horizon, sharp: the warm haze, then the dark fingers burning out to gold. */
function burn(c: Ctx, S: number, ph: number) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = "source-over";
  c.clearRect(0, 0, S, S);
  // the ground the light lands on: pale rose under the horizon, white-gold where the sun is
  c.beginPath();
  c.moveTo(0, horizon(0) * S);
  for (let i = 1; i <= 40; i++) c.lineTo((i / 40) * S, horizon(i / 40) * S);
  c.lineTo(S, S); c.lineTo(0, S); c.closePath();
  const ground = c.createLinearGradient(0, 0, S, S * 0.4);
  ground.addColorStop(0, C(GOLD)); ground.addColorStop(0.55, C(FLARE)); ground.addColorStop(1, C(HAZE));
  c.fillStyle = ground; c.fill();
  // the burn along the horizon: a thick hot band, orange at the left, gold, then rose as it runs out
  c.lineWidth = S * 0.06;
  const rim = c.createLinearGradient(0, 0, S, 0);
  rim.addColorStop(0, C(ORANGE)); rim.addColorStop(0.3, C(GOLD)); rim.addColorStop(0.6, C(FLARE, 0.8)); rim.addColorStop(1, C(HAZE, 0));
  c.strokeStyle = rim;
  c.beginPath();
  for (let i = 0; i <= 40; i++) c[i ? "lineTo" : "moveTo"]((i / 40) * S, (horizon(i / 40) + 0.03) * S);
  c.stroke();
  // the drift: sand heaped up over the name's feet, the dune's own colours, its crest blowing off in wisps
  // laid in thin veils, so the crest is feathered and the letters show through it before they're covered
  for (const [k, a] of [[1, 0.3], [0.75, 0.35], [0.5, 0.5], [0.25, 0.8]]) {
    c.beginPath();
    for (let i = 0; i <= 60; i++) { const x = 0.1 + (i / 60) * 0.8; c[i ? "lineTo" : "moveTo"](x * S, crest(x, k) * S); }
    for (let i = 60; i >= 0; i--) { const x = 0.1 + (i / 60) * 0.8; c.lineTo(x * S, (horizon(x) + 0.03) * S); }
    c.closePath();
    const heap = c.createLinearGradient(0, 0, S, 0);
    heap.addColorStop(0, C(ORANGE, a)); heap.addColorStop(0.3, C(GOLD, a)); heap.addColorStop(0.6, C(FLARE, a)); heap.addColorStop(1, C(HAZE, a));
    c.fillStyle = heap; c.fill();
  }
  for (const [t, , , seed] of FINGERS.slice(0, 18)) {
    const u = (((ph * 2 + seed * 0.53) % 1) + 1) % 1, x = 0.14 + u * 0.72, fade = Math.sin(u * Math.PI);
    const y = crest(x) - 0.004 - t * 0.022;
    c.fillStyle = C(groundAt(x), 0.55 * fade * (1 - t));
    c.beginPath();
    c.ellipse(x * S, y * S, 0.05 * S, 0.004 * S, Math.atan(slope(x)), 0, Math.PI * 2);
    c.fill();
  }
  // the fingers: each a streak from the left edge, soot to ember to orange to gold, barely breathing
  // each runs parallel to the horizon, so the dark curves down with it
  for (const [t, th, reach, seed] of FINGERS) {
    const d = 0.075 + t * 0.62, len = reach * (1 + 0.03 * loopNoise(ph, seed, [1, 2]));
    const h = th * (1 + 0.1 * loopNoise(ph, seed + 3, [1, 2]));
    const g = c.createLinearGradient(0, 0, len * S, 0);
    g.addColorStop(0, C(SOOT)); g.addColorStop(0.45, C(SOOT, 0.95)); g.addColorStop(0.63, C(EMBER, 0.9));
    g.addColorStop(0.78, C(ORANGE, 0.85)); g.addColorStop(0.92, C(GOLD, 0.5)); g.addColorStop(1, C(GOLD, 0));
    c.fillStyle = g;
    c.beginPath();
    const n = 24;
    for (let i = 0; i <= n; i++) { const x = (i / n) * len, w = h * Math.sqrt(1 - (i / n) ** 2); c[i ? "lineTo" : "moveTo"](x * S, (horizon(x) + d - w) * S); }
    for (let i = n; i >= 0; i--) { const x = (i / n) * len, w = h * Math.sqrt(1 - (i / n) ** 2); c.lineTo(x * S, (horizon(x) + d + w) * S); }
    c.closePath();
    c.fill();
  }
  // brush strokes travelling along the fingers, a shade lighter than where they pass, fading in
  // at the left and out at the tip so the wrap round the loop never shows
  for (const [t, th, reach, seed] of FINGERS) {
    const d = 0.075 + t * 0.62, len = reach * (1 + 0.03 * loopNoise(ph, seed, [1, 2]));
    const u = (((ph + seed * 0.37) % 1) + 1) % 1, x = u * len, fade = Math.sin(u * Math.PI);
    const tone: Col = u < 0.45 ? [0.26, 0.07, 38] : u < 0.63 ? EMBER : u < 0.85 ? ORANGE : GOLD;
    c.fillStyle = C(tone, 0.5 * fade);
    c.beginPath();
    c.ellipse(x * S, (horizon(x) + d) * S, 0.1 * len * S, th * 0.35 * S, Math.atan(slope(x)), 0, Math.PI * 2);
    c.fill();
  }
}

/** The colour of the band along the horizon at `x`, the same stops the burn uses. */
function groundAt(x: number): Col {
  const stops: [number, Col][] = [[0, ORANGE], [0.3, GOLD], [0.6, FLARE], [1, HAZE]];
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i], [t0, c0] = stops[i - 1];
    if (x <= t1) return mix(c0, c1, (x - t0) / (t1 - t0));
  }
  return HAZE;
}

/**
 * The name, set as a tight block: SUN stacked on SET, the letters closed up until they touch
 * and the two rows locked to one width, the block standing on the horizon and tilted with it.
 * Made of the dune's own light: SET's feet take the colour of the sand they stand in, and the
 * block pales to warm white toward the top of SUN.
 */
function word(ctx: Ctx, S: number, ghost = false) {
  ctx.font = FONT(100);
  ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  const ink = (ch: string) => { const m = ctx.measureText(ch); return { l: m.actualBoundingBoxLeft, w: m.actualBoundingBoxLeft + m.actualBoundingBoxRight, up: m.actualBoundingBoxAscent }; };
  const rows = ROWS.map((r) => [...r].map((ch) => ({ ch, ...ink(ch) })));
  // letters kiss: no air between them, the narrower row's gaps opened just enough to square the block
  const kiss = -1.5, natural = rows.map((r) => r.reduce((a, g) => a + g.w, 0) + kiss * (r.length - 1)), widest = Math.max(...natural);
  const size = (S * BLOCK * 100) / widest, k = size / 100, W = widest * k;
  const cap = Math.max(...rows.flat().map((g) => g.up)) * k, lead = cap + size * -0.012;
  ctx.font = FONT(size);
  const cx = 0.5, sink = -0.006, tilt = Math.atan(slope(cx));
  // the block is tilted to the dune at its middle, but the dune keeps curving away under the outer
  // columns, so each column drops by that much and the S and T stand in the sand like the E does
  const drops: number[] = [];
  {
    const last = rows[rows.length - 1], gap = last.length > 1 ? (widest - natural[rows.length - 1]) / (last.length - 1) + kiss : 0;
    let x = -W / 2;
    for (const g of last) {
      const gx = cx + ((x + (g.w * k) / 2) * Math.cos(tilt)) / S;
      drops.push((horizon(gx) - horizon(cx) - slope(cx) * (gx - cx)) * S * Math.cos(tilt));
      x += g.w * k + gap * k;
    }
  }
  ctx.save();
  ctx.translate(cx * S, (horizon(cx) + sink) * S);
  ctx.rotate(tilt);
  rows.forEach((row, ri) => {
    if (ghost && ri < rows.length - 1) return;
    const rowBase = -(rows.length - 1 - ri) * lead, gap = row.length > 1 ? (widest - natural[ri]) / (row.length - 1) + kiss : 0;
    let x = -W / 2;
    row.forEach((g, gi) => {
      const base = rowBase + (drops[gi] ?? 0);
      const mid = cx + (x + (g.w * k) / 2) / S, ground = groundAt(mid), top = base - cap;
      const last = ri === rows.length - 1;
      const body = ctx.createLinearGradient(0, top, 0, last ? base + size * 0.06 : base);
      if (last) {
        body.addColorStop(0, C(mix(AIR, ground, 0.3), 0.93)); body.addColorStop(0.86, C(mix(AIR, ground, 0.75), 0.9)); body.addColorStop(1, C(ground, 0));
      } else {
        body.addColorStop(0, C(AIR, 0.96)); body.addColorStop(1, C(mix(AIR, ground, 0.3), 0.93));
      }
      ctx.fillStyle = ghost ? C(mix(GOLD, AIR, 0.5), 0.5) : body;
      ctx.fillText(g.ch, x + g.l * k, base);
      x += g.w * k + gap * k;
    });
  });
  ctx.restore();
}

export const streak: MixDraw = (ctx, S, ph, o, kit) => {
  const px = (k: number) => Math.max(1, (k * S) / 600);
  // the sky: deep blue up top, paling toward the horizon and toward the sun on the right
  const sky = ctx.createLinearGradient(0, 0, S * 0.5, S * 0.55);
  sky.addColorStop(0, C(SKY_TOP)); sky.addColorStop(1, C(SKY_LOW));
  ctx.fillStyle = sky; ctx.fillRect(0, 0, S, S);

  const sharp = kit.scratch("gh-streak", S), b = kit.ctxOf(sharp);
  burn(b, S, ph);
  if (o.titles) {
    // the word's feet glowing up through the sand: laid into the ground as light before it's smeared, so they drag out with it
    b.save();
    b.beginPath();
    for (let i = 0; i <= 40; i++) b.lineTo((i / 40) * S, crest(i / 40) * S);
    b.lineTo(S, S); b.lineTo(0, S); b.closePath();
    b.clip();
    word(b, S, true);
    b.restore();
  }
  if (o.titles) {
    // the word itself, under the sand: light, a warm glow round it so it reads as light against the sky, then the letters, a touch soft
    const t = kit.scratch("gh-streak-word", S), tc = kit.ctxOf(t);
    tc.setTransform(1, 0, 0, 1, 0, 0); tc.clearRect(0, 0, S, S);
    word(tc, S);
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.55;
    ctx.drawImage(blurred(kit, S, t, px(18), "gh-streak-word-glow"), 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(blurred(kit, S, t, px(1.5), "gh-streak-word-soft"), 0, 0);
  }

  // motion: dragged sideways a long way, softened a little up and down
  const smeared = smearX(kit, S, sharp, px(40), "gh-streak-x");
  const soft = blurred(kit, S, smeared, px(6), "gh-streak-soft");
  ctx.drawImage(soft, 0, 0);

  // the flare on the right, breathing a little: light spilling up over the horizon
  const fx = 0.82 * S, fy = (horizon(0.82) + 0.16) * S, breathe = 1 + 0.08 * loopNoise(ph, 7.1, [1, 2]);
  ctx.globalCompositeOperation = "screen";
  const flare = ctx.createRadialGradient(fx, fy, 0, fx, fy, S * 0.4 * breathe);
  flare.addColorStop(0, C(FLARE, 0.85)); flare.addColorStop(0.35, C(GOLD, 0.35)); flare.addColorStop(1, C(GOLD, 0));
  ctx.fillStyle = flare; ctx.fillRect(0, 0, S, S);
  // a band of rose haze lying along the horizon, as in a real lens
  const hz = ctx.createLinearGradient(0, (horizon(0.5) - 0.06) * S, 0, (horizon(0.5) + 0.03) * S);
  hz.addColorStop(0, C(HAZE, 0)); hz.addColorStop(0.7, C(HAZE, 0.2)); hz.addColorStop(1, C(HAZE, 0));
  ctx.fillStyle = hz; ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = "source-over";

  // coarse film grain, a little softer than the pixel, like the pin
  photoGrain(ctx, S, kit, 0.45, ph, 72);
  // and a faint red-to-blue fringe at the edges where the lens gives up
  const v = ctx.createRadialGradient(S * 0.55, S * 0.5, S * 0.3, S * 0.5, S * 0.5, S * 0.8);
  v.addColorStop(0, C([0, 0, 0], 0)); v.addColorStop(1, C([0.2, 0.05, 280], 0.25));
  ctx.fillStyle = v; ctx.fillRect(0, 0, S, S);
};
