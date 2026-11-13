import { C, type Col } from "../color";
import type { Ctx } from "../kit";
import { rng, hash } from "../rng";
import { loopNoise, type MixDraw } from "./util";

/*
 * Home Sweet Home: a cross-stitch sampler filling the cover, the cloth itself and nothing
 * round it. One grid, one rhythm: a street of houses along the top, the words in a bold
 * slab-serif stitch alphabet, a row of pines along the bottom, every motif on the same
 * eleven-stitch spacing, four threads on oatmeal aida. A December night, so the houses'
 * windows light up and go dark one by one through the loop, people coming home, and the
 * mustard sparkles between the pines twinkle. Our own take on the genre, not a copy of any one
 * sampler. References: docs/mix-cover-refs/README.md.
 */

/** Stitches across (and down) the cover. */
const N = 64;

const CLOTH: Col = [0.93, 0.022, 84];
const PINE: Col = [0.42, 0.075, 158];
const CRANBERRY: Col = [0.5, 0.15, 18];
const MUSTARD: Col = [0.82, 0.14, 82];
const INK: Col = [0.28, 0.03, 50];
const THREADS = [PINE, CRANBERRY, MUSTARD, INK];
const [pine, cran, , ink] = [0, 1, 2, 3];

/** The alphabet: nine rows, two-stitch stems, slab serifs. */
const GLYPHS: Record<string, string[]> = {
  H: ["###..###", ".##..##.", ".##..##.", ".##..##.", ".######.", ".##..##.", ".##..##.", ".##..##.", "###..###"],
  O: ["..####..", ".##..##.", "##....##", "##....##", "##....##", "##....##", "##....##", ".##..##.", "..####.."],
  M: ["###....###", ".###..###.", ".##.##.##.", ".##.##.##.", ".##....##.", ".##....##.", ".##....##.", ".##....##.", "###....###"],
  E: ["#######", ".##...#", ".##....", ".##..#.", ".#####.", ".##..#.", ".##....", ".##...#", "#######"],
  S: [".#####.", "##...##", "##.....", "##.....", ".#####.", ".....##", ".....##", "##...##", ".#####."],
  W: ["###....###", ".##....##.", ".##....##.", ".##....##.", ".##.##.##.", ".##.##.##.", ".###..###.", ".##....##.", ".#......#."],
  T: ["########", "#..##..#", "...##...", "...##...", "...##...", "...##...", "...##...", "...##...", "..####.."],
};
const HEART = [".#.#.", "#####", "#####", ".###.", "..#.."];
const SPARKLE = [".#.", "#.#", ".#."];
/** A house, nine wide: R roof, W wall, a/b its two windows, D door. */
const HOUSE = ["....R....", "...RRR...", "..RRRRR..", ".RRRRRRR.", "RRRRRRRRR", ".WWWWWWW.", ".WaaWbbW.", ".WaaWbbW.", ".WWWDWWW.", ".WWWDWWW."];
const PINE_TREE = ["...#...", "..###..", ".#####.", "..###..", ".#####.", "#######", "...T...", "...T..."];

/** A chart cell: a thread, a window (lit by the loop), a sparkle (twinkling), or bare cloth. */
type Cell = { t: number } | { window: number } | { sparkle: number } | null;

function makeChart(titles: boolean) {
  const g: Cell[][] = Array.from({ length: N }, () => Array.from({ length: N }, () => null));
  const put = (rows: string[], top: number, left: number, cell: (ch: string) => Cell) =>
    rows.forEach((line, y) => [...line].forEach((ch, x) => { if (ch !== ".") g[top + y][left + x] = cell(ch); }));
  const word = (text: string, top: number, t: number) => {
    const width = [...text].reduce((w, ch) => w + GLYPHS[ch][0].length, 0) + text.length - 1;
    let x = Math.floor((N - width) / 2);
    for (const ch of text) { put(GLYPHS[ch], top, x, () => ({ t })); x += GLYPHS[ch][0].length + 1; }
  };
  // a single pine line round the edge
  for (let i = 1; i < N - 1; i++) { g[1][i] = { t: pine }; g[N - 2][i] = { t: pine }; g[i][1] = { t: pine }; g[i][N - 2] = { t: pine }; }
  // the street: five houses on the eleven-stitch spacing, each with two windows of its own
  let windows = 0;
  for (let i = 0; i < 5; i++) {
    const left = 5 + i * 11, a = windows++, b = windows++;
    put(HOUSE, 5, left, (ch) =>
      ch === "R" ? { t: cran } : ch === "W" ? { t: pine } : ch === "D" ? { t: ink } : { window: ch === "a" ? a : b });
  }
  if (titles) {
    word("HOME", 18, pine);
    word("SWEET", 29, cran);
    word("HOME", 40, pine);
  } else {
    for (let i = 0; i < 5; i++) for (const top of [20, 31, 42]) put(HEART, top, 7 + i * 11, () => ({ t: cran }));
  }
  // hearts either side of the middle line
  put(HEART, 31, 3, () => ({ t: cran }));
  put(HEART, 31, N - 8, () => ({ t: cran }));
  // the pines, on the same spacing as the houses, sparkles in the gaps between them
  for (let i = 0; i < 5; i++) put(PINE_TREE, 51, 6 + i * 11, (ch) => ({ t: ch === "T" ? ink : pine }));
  for (let i = 0; i < 6; i++) put(SPARKLE, 53, 2 + i * 11, () => ({ sparkle: i }));
  return { g, windows };
}

let charts: Record<"named" | "plain", ReturnType<typeof makeChart>> | null = null;
let jitter: Float32Array | null = null;
function chart(titles: boolean) {
  if (!charts) {
    charts = { named: makeChart(true), plain: makeChart(false) };
    const r = rng(hash("mix|home-sweet-home|stitch"));
    jitter = Float32Array.from({ length: N * N * 3 }, () => (r() - 0.5) * 2);
  }
  return { ...charts[titles ? "named" : "plain"], jitter: jitter! };
}

/** Whether window `k` is lit at `ph`: each is on for most of the loop, switching on its own beat. */
function lit(k: number, ph: number) {
  const on = (k * 0.381 + 0.07) % 1, len = 0.6 + ((k * 0.17) % 0.2);
  return (((ph - on) % 1) + 1) % 1 < len;
}

/** One cross stitch, filling its square: the under leg, then the over leg with a sheen along it. */
function cross(ctx: Ctx, x: number, y: number, s: number, col: Col, j: Float32Array, o: number) {
  const k = s * 0.1, dl = j[o] * 0.02;
  const shade = (dL: number, a = 1) => C([Math.max(0, Math.min(1, col[0] + dl + dL)), col[1], col[2]], a);
  const ox = j[o + 1] * s * 0.03, oy = j[o + 2] * s * 0.03;
  ctx.lineWidth = s * 0.5;
  ctx.strokeStyle = shade(-0.08);
  ctx.beginPath(); ctx.moveTo(x + k + ox, y + s - k + oy); ctx.lineTo(x + s - k + ox, y + k + oy); ctx.stroke();
  ctx.strokeStyle = shade(0);
  ctx.beginPath(); ctx.moveTo(x + k + ox, y + k + oy); ctx.lineTo(x + s - k + ox, y + s - k + oy); ctx.stroke();
  ctx.lineWidth = s * 0.12;
  ctx.strokeStyle = shade(0.08, 0.55);
  ctx.beginPath(); ctx.moveTo(x + s * 0.22 + ox, y + s * 0.18 + oy); ctx.lineTo(x + s * 0.56 + ox, y + s * 0.52 + oy); ctx.stroke();
}

export const sampler: MixDraw = (ctx, S, ph, o, kit) => {
  const s = S / N;
  // the cloth: oatmeal aida, a faint weave and its holes at every stitch corner
  ctx.fillStyle = C(CLOTH);
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = C([0.86, 0.025, 80], 0.6);
  const line = Math.max(0.5, s * 0.08);
  for (let i = 0; i <= N; i++) { ctx.fillRect(i * s - line / 2, 0, line, S); ctx.fillRect(0, i * s - line / 2, S, line); }
  ctx.fillStyle = C([0.72, 0.03, 75], 0.6);
  const hole = Math.max(0.6, s * 0.14);
  for (let i = 0; i <= N; i++) for (let k = 0; k <= N; k++) ctx.fillRect(i * s - hole / 2, k * s - hole / 2, hole, hole);

  const { g, jitter: j } = chart(o.titles);
  ctx.lineCap = "round";
  const glows: [number, number][] = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const c = g[y][x];
    if (!c) continue;
    const sx = x * s, sy = y * s, oj = (y * N + x) * 3;
    if ("window" in c) {
      const on = lit(c.window, ph);
      cross(ctx, sx, sy, s, on ? MUSTARD : INK, j, oj);
      if (on) glows.push([sx + s / 2, sy + s / 2]);
    } else if ("sparkle" in c) {
      const tw = 0.5 + 0.5 * loopNoise(ph, c.sparkle * 2.3, [2, 3, 5]);
      cross(ctx, sx, sy, s, [MUSTARD[0] + 0.1 * tw, MUSTARD[1], MUSTARD[2]], j, oj);
    } else cross(ctx, sx, sy, s, THREADS[c.t], j, oj);
  }
  // lit windows throw a little warm light onto the cloth round them
  ctx.globalCompositeOperation = "lighter";
  for (const [gx, gy] of glows) {
    const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, s * 2.4);
    glow.addColorStop(0, C(MUSTARD, 0.09));
    glow.addColorStop(1, C(MUSTARD, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(gx - s * 2.4, gy - s * 2.4, s * 4.8, s * 4.8);
  }
  ctx.globalCompositeOperation = "source-over";

  // soft light across the cloth, falling off toward the corners
  const fall = ctx.createRadialGradient(S * 0.42, S * 0.38, S * 0.15, S * 0.5, S * 0.5, S * 0.78);
  fall.addColorStop(0, C([1, 0, 90], 0.05));
  fall.addColorStop(0.6, C([0, 0, 0], 0));
  fall.addColorStop(1, C([0.25, 0.03, 60], 0.22));
  ctx.fillStyle = fall;
  ctx.fillRect(0, 0, S, S);
  kit.grain(ctx, S, 0.07);
};
