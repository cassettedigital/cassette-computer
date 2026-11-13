import { C, TAU, type Col } from "../color";
import type { Ctx } from "../kit";
import { rng, hash } from "../rng";
import { loopNoise, type MixDraw } from "./util";

/*
 * Sweater Weather: a knitted swatch photographed close, in autumn wool. Stacked bands the way
 * a Fair Isle yoke stacks them (peerie dots, pines against a mustard sky, checks, diamonds,
 * maple leaves), and the name knitted into its own band in a blocky stitch font, as on a
 * jacquard book cover. Every stitch is a V of two yarn legs with a soft
 * mohair halo. The tree line drifts left and the leaves drift right, as if knitted in the round.
 * References: docs/mix-cover-refs/README.md.
 */

const COLS = 44;
/** A stitch is wider than it is tall. */
const ASPECT = 0.82;

const CREAM: Col = [0.92, 0.035, 85];
const MUSTARD: Col = [0.76, 0.13, 78];
const RUST: Col = [0.56, 0.15, 42];
const FOREST: Col = [0.38, 0.065, 155];
const PINE: Col = [0.3, 0.05, 160];
const BROWN: Col = [0.28, 0.04, 50];
const APRICOT: Col = [0.69, 0.13, 55];
const WOOL = [CREAM, MUSTARD, RUST, FOREST, BROWN, APRICOT, PINE];
const [cr, mu, ru, fo, bw, ap, pi] = [0, 1, 2, 3, 4, 5, 6];

/** The stitch font: seven rows, one stitch strokes. */
const GLYPHS: Record<string, string[]> = {
  S: [".###", "#...", "#...", ".##.", "...#", "...#", "###."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  E: ["####", "#...", "#...", "###.", "#...", "#...", "####"],
  A: [".##.", "#..#", "#..#", "####", "#..#", "#..#", "#..#"],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  H: ["#..#", "#..#", "#..#", "####", "#..#", "#..#", "#..#"],
  R: ["###.", "#..#", "#..#", "###.", "#.#.", "#..#", "#..#"],
};

/** Pines as row widths, top to bottom, standing on the band's last row. */
const BIG_TREE = [1, 3, 1, 3, 5, 3, 5, 1, 1];
const SMALL_TREE = [1, 3, 1, 3, 1, 1];
const LEAF = ["...#...", ".#.#.#.", ".#####.", "#######", ".#####.", "..###..", "...#..."];

/** Rows that drift, and by how many stitches a loop (whole motif periods, so the loop closes). */
type Band = { from: number; to: number; shift: number };
const TREES: Band = { from: 3, to: 12, shift: -11 };
const LEAVES: Band = { from: 46, to: 53, shift: 22 };
const NAME_ROWS = { from: 17, to: 35 };

/** The chart: a wool index per stitch, rows top to bottom. */
function makeChart(titles: boolean): number[][] {
  const rows: number[][] = [];
  const row = (f: (c: number) => number) => rows.push(Array.from({ length: COLS }, (_, c) => f(c)));
  // peerie dots
  row((c) => (c % 4 === 1 ? mu : bw));
  row((c) => (c % 4 === 3 ? mu : bw));
  row(() => cr);
  // the pine line against a mustard sky
  const sky = [mu, mu, mu, mu, mu, mu, mu, mu, mu, ap];
  const treeAt = (c: number, r: number) => {
    const k = c % 11;
    const hit = (shape: number[], centre: number) => {
      const i = r - (10 - shape.length);
      return i >= 0 && Math.abs(k - centre) * 2 + 1 <= shape[i];
    };
    return hit(BIG_TREE, 2) || hit(SMALL_TREE, 8);
  };
  for (let r = 0; r < 10; r++) row((c) => (treeAt(c, r) ? pi : sky[r]));
  // checks
  row(() => bw);
  row((c) => (c % 2 ? cr : bw));
  row((c) => (c % 2 ? bw : cr));
  row(() => bw);
  // the name band
  const nameRows = Array.from({ length: 19 }, () => Array.from({ length: COLS }, () => ru));
  if (titles) {
    const word = (text: string, top: number) => {
      let x = 4;
      for (const ch of text) {
        const g = GLYPHS[ch];
        g.forEach((line, gy) => [...line].forEach((px, gx) => { if (px === "#") nameRows[top + gy][x + gx] = cr; }));
        x += g[0].length + 1;
      }
    };
    word("SWEATER", 2);
    word("WEATHER", 11);
    // a small mustard diamond either side of each word
    for (const top of [4, 13]) for (const cx of [1, COLS - 2]) {
      nameRows[top][cx] = mu; nameRows[top + 2][cx] = mu;
      nameRows[top + 1][cx - 1] = mu; nameRows[top + 1][cx] = mu; nameRows[top + 1][cx + 1] = mu;
    }
  } else {
    nameRows.forEach((line, r) => line.forEach((_, c) => { if ((r % 4 === 1 && c % 4 === 1) || (r % 4 === 3 && c % 4 === 3)) line[c] = mu; }));
  }
  rows.push(...nameRows);
  // checks
  row(() => bw);
  row((c) => (c % 2 ? cr : bw));
  row((c) => (c % 2 ? bw : cr));
  row(() => bw);
  // diamonds
  for (let r = 0; r < 5; r++) row((c) => {
    const d = Math.abs((c % 11) - 5) + Math.abs(r - 2);
    return d === 0 ? mu : d <= 2 ? ru : cr;
  });
  row(() => bw);
  // maple leaves, mustard and rust in turn
  for (let r = 0; r < 8; r++) row((c) => {
    const k = c % 11, gy = r - 1;
    if (gy < 0 || gy >= 7 || k < 2 || k > 8) return fo;
    return LEAF[gy][k - 2] === "#" ? (Math.floor(c / 11) % 2 ? ru : mu) : fo;
  });
  return rows;
}

/** Per-stitch unevenness, fixed to the stitch: [lightness, dx, dy, size, hair angle, hair length, hair seed]. */
type Jitter = Float32Array;
let made: { chart: Record<"named" | "plain", number[][]>; jitter: Jitter } | null = null;
function knitting() {
  if (made) return made;
  const named = makeChart(true), plain = makeChart(false);
  const r = rng(hash("mix|sweater-weather|knit"));
  const jitter = new Float32Array(named.length * COLS * 7);
  for (let i = 0; i < named.length * COLS; i++) {
    jitter[i * 7] = (r() - 0.5) * 2;
    jitter[i * 7 + 1] = (r() - 0.5) * 2;
    jitter[i * 7 + 2] = (r() - 0.5) * 2;
    jitter[i * 7 + 3] = (r() - 0.5) * 2;
    jitter[i * 7 + 4] = r() * TAU;
    jitter[i * 7 + 5] = r() < 0.45 ? 0.3 + r() * 0.6 : 0;
    jitter[i * 7 + 6] = r() * 100;
  }
  made = { chart: { named, plain }, jitter };
  return made;
}

/** The shades of each wool, in five lightness steps, as strings ready to fill. */
const shadeCache = new Map<string, string>();
function shade(wool: number, step: number, dl: number, a = 1): string {
  const key = `${wool}|${step}|${dl}|${a}`;
  let s = shadeCache.get(key);
  if (!s) {
    const [l, ch, hue] = WOOL[wool];
    s = C([Math.max(0, Math.min(1, l + dl + (step - 2) * 0.012)), ch, hue], a);
    shadeCache.set(key, s);
  }
  return s;
}

/** One stitch: a V of two yarn legs, each a shadow, the wool, and a sheen on its upper half. */
function stitch(ctx: Ctx, x: number, y: number, w: number, h: number, wool: number, j: Jitter, o: number) {
  const step = Math.round(j[o] * 2) + 2;
  const sx = x + j[o + 1] * w * 0.05, sy = y + j[o + 2] * h * 0.05, k = 1 + j[o + 3] * 0.05;
  const rx = w * 0.27 * k, ry = h * 0.64 * k, tilt = 0.45;
  for (const side of [-1, 1]) {
    const cx = sx + w * (0.5 + side * 0.215), cy = sy + h * 0.5;
    ctx.fillStyle = shade(wool, step, -0.13);
    ctx.beginPath(); ctx.ellipse(cx, cy + h * 0.07, rx, ry, side * tilt, 0, TAU); ctx.fill();
    ctx.fillStyle = shade(wool, step, 0);
    ctx.beginPath(); ctx.ellipse(cx, cy, rx * 0.88, ry * 0.9, side * tilt, 0, TAU); ctx.fill();
    ctx.fillStyle = shade(wool, step, 0.07, 0.55);
    ctx.beginPath(); ctx.ellipse(cx - side * w * 0.03, cy - h * 0.16, rx * 0.4, ry * 0.45, side * tilt, 0, TAU); ctx.fill();
  }
}

/** A mohair hair off the stitch, catching the light now and then. */
function hair(ctx: Ctx, x: number, y: number, w: number, h: number, wool: number, j: Jitter, o: number, ph: number) {
  const len = j[o + 5] * w;
  if (!len) return;
  const a = 0.22 + 0.16 * loopNoise(ph, j[o + 6], [2, 5]);
  const ang = j[o + 4], cx = x + w * 0.5, cy = y + h * 0.4;
  ctx.strokeStyle = shade(wool, 4, 0.12, Math.max(0, a));
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.quadraticCurveTo(cx + Math.cos(ang + 0.6) * len * 0.6, cy + Math.sin(ang + 0.6) * len * 0.6, cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
  ctx.stroke();
}

export const knit: MixDraw = (ctx, S, ph, o, kit) => {
  const { chart: charts, jitter } = knitting();
  const chart = charts[o.titles ? "named" : "plain"];
  const w = S / COLS, h = w * ASPECT;
  ctx.fillStyle = C([0.18, 0.03, 50]);
  ctx.fillRect(0, 0, S, S);
  ctx.lineWidth = Math.max(0.5, S * 0.0012);
  ctx.lineCap = "round";
  const span = COLS * w;
  for (const pass of ["stitch", "hair"] as const) {
    for (let r = 0; r < chart.length; r++) {
      const y = (r - 0.5) * h;
      if (y > S + h) break;
      const band = r >= TREES.from && r <= TREES.to ? TREES : r >= LEAVES.from && r <= LEAVES.to ? LEAVES : null;
      const off = band ? band.shift * w * ph : 0;
      for (let c = 0; c < COLS; c++) {
        const x = (((c * w + off) % span) + span) % span - w * 0.5;
        const oj = (r * COLS + c) * 7;
        // a stitch drifting off the right edge comes back in on the left
        for (const xx of x > S - w ? [x, x - span] : [x]) {
          if (pass === "stitch") stitch(ctx, xx, y, w, h, chart[r][c], jitter, oj);
          else hair(ctx, xx, y, w, h, chart[r][c], jitter, oj, ph);
        }
      }
    }
  }
  // light from the upper left, falling off at the edges like a photographed swatch
  const g = ctx.createRadialGradient(S * 0.35, S * 0.3, S * 0.1, S * 0.5, S * 0.5, S * 0.8);
  g.addColorStop(0, C([1, 0, 90], 0.06));
  g.addColorStop(0.6, C([0, 0, 0], 0));
  g.addColorStop(1, C([0.1, 0.02, 50], 0.35));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  kit.grain(ctx, S, 0.1);
};
