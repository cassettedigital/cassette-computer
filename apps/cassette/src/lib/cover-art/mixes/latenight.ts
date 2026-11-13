import { C, TAU } from "../color";
import { sparkle } from "../kit";
import type { Ctx, Kit } from "../kit";
import { rng, hash } from "../rng";
import { tape, type MixDraw } from "./util";

const SOFT = '"Fraunces", Georgia, serif';
const ITAL = '"Fraunces", Georgia, serif';

/** Who the show is "with", where a talk show names its host: the same line on every cover. */
const LINE = "No Studio Audience";

/** A crescent moon: a disc with a smaller one bitten out of it. */
function moon(ctx: Ctx, kit: Kit, S: number, x: number, y: number, R: number, col: number[]) {
  const buf = kit.scratch("moon", S), b = kit.ctxOf(buf);
  b.setTransform(1, 0, 0, 1, 0, 0); b.clearRect(0, 0, S, S); b.globalCompositeOperation = "source-over";
  b.fillStyle = C(col); b.beginPath(); b.arc(x, y, R, 0, TAU); b.fill();
  b.globalCompositeOperation = "destination-out"; b.beginPath(); b.arc(x - R * 0.42, y - R * 0.22, R * 0.86, 0, TAU); b.fill();
  b.globalCompositeOperation = "source-over";
  ctx.drawImage(buf, 0, 0);
}

/** A city skyline along the bottom, the backdrop behind a talk show desk. */
function backdrop(ctx: Ctx, S: number, seed: string) {
  const r = rng(hash(seed));
  let x = -S * 0.02;
  while (x < S) {
    const w = S * (0.05 + r() * 0.08), top = S * (0.84 + r() * 0.1);
    ctx.fillStyle = C([0.15, 0.04, 285]); ctx.fillRect(x, top, w, S - top);
    for (let wy = top + S * 0.015; wy < S; wy += S * 0.022) for (let wx = x + S * 0.008; wx < x + w - S * 0.008; wx += S * 0.016)
      if (r() < 0.2) { ctx.fillStyle = C([0.75, 0.11, 78], 0.55); ctx.fillRect(wx, wy, S * 0.006, S * 0.008); }
    x += w + S * 0.004;
  }
  const fade = ctx.createLinearGradient(0, S * 0.7, 0, S);
  fade.addColorStop(0, C([0.08, 0.015, 290], 0)); fade.addColorStop(1, C([0.08, 0.015, 290], 0.55));
  ctx.fillStyle = fade; ctx.fillRect(0, S * 0.7, S, S * 0.3);
}

/** Text set on a canvas with the colour fringes of a tape played one too many times. */
function vhsText(ctx: Ctx, text: string, x: number, y: number, col: number[], split: number) {
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = C([0.62, 0.23, 20], 0.45); ctx.fillText(text, x - split, y);
  ctx.fillStyle = C([0.55, 0.19, 255], 0.45); ctx.fillText(text, x + split, y);
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = C(col); ctx.fillText(text, x, y);
}

/**
 * Late Night as a talk show: LATE over NIGHT in a soft, fat serif, rules running off the
 * words, and "with No Studio Audience" underneath. A crescent moon sits centred over it all
 * with a star either side; the stars twinkle and the moon rocks.
 */
export const show: MixDraw = (ctx, S, ph, o, kit) => {
  const sp = ctx.createRadialGradient(S * 0.5, S * 0.4, S * 0.05, S * 0.5, S * 0.45, S * 0.75);
  sp.addColorStop(0, C([0.19, 0.045, 300])); sp.addColorStop(1, C([0.08, 0.015, 290]));
  ctx.fillStyle = sp; ctx.fillRect(0, 0, S, S);
  backdrop(ctx, S, "mix|late-night|city");
  const cream = [0.94, 0.04, 88], yellow = [0.88, 0.15, 92], pink = [0.74, 0.17, 357], blue = [0.62, 0.17, 262];
  const tw = (k: number, q: number) => 0.7 + 0.3 * Math.sin(TAU * k * ph + q);
  if (!o.titles) {
    moon(ctx, kit, S, S * 0.52 + S * 0.01 * Math.sin(TAU * ph), S * 0.4, S * 0.2, cream);
    ctx.fillStyle = C(cream); sparkle(ctx, S * 0.78, S * 0.2, S * 0.05 * tw(2, 0)); sparkle(ctx, S * 0.84, S * 0.36, S * 0.03 * tw(3, 1));
    tape(ctx, S, kit, 0.18);
    return;
  }
  ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";
  // measure first: NIGHT sets the width, LATE sits above it nudged right, the line below
  let big = S * 0.26;
  ctx.font = `900 ${big}px ${SOFT}`;
  let nw = ctx.measureText("NIGHT").width;
  if (nw > S * 0.8) { big *= (S * 0.8) / nw; ctx.font = `900 ${big}px ${SOFT}`; nw = ctx.measureText("NIGHT").width; }
  const small = big * 0.62;
  ctx.font = `900 ${small}px ${SOFT}`;
  const lw = ctx.measureText("LATE").width;
  let gs = S * 0.085;
  ctx.font = `italic 600 ${gs * 0.8}px ${ITAL}`;
  const ww = ctx.measureText("with ").width;
  ctx.font = `900 ${gs}px ${SOFT}`;
  const room = S * 0.86 - ww;
  let gw = ctx.measureText(LINE).width;
  if (gw > room) { gs *= room / gw; gw = room; }
  // then centre the whole stack, moon to the line, in the frame
  const mR = S * 0.065, gap = S * 0.035;
  const lateRel = mR + gap + small * 0.72, nightRel = lateRel + big * 0.78, lineRel = nightRel + big * 0.42;
  const bottomRel = lineRel + gs * 0.24;
  const y0 = S / 2 - (bottomRel - mR) / 2;
  const my = y0, lateY = y0 + lateRel, nightY = y0 + nightRel, gy = y0 + lineRel;
  const left = (S - nw) / 2, split = S * 0.0045;
  const lateX = left + nw - lw - S * 0.03;
  ctx.font = `900 ${big}px ${SOFT}`;
  vhsText(ctx, "NIGHT", left, nightY, pink, split);
  ctx.font = `900 ${small}px ${SOFT}`;
  vhsText(ctx, "LATE", lateX, lateY, yellow, split);
  const rule = (x0: number, x1: number, y: number, col: number[]) => { ctx.fillStyle = C(col); ctx.fillRect(x0, y - S * 0.006, x1 - x0, S * 0.012); };
  rule(left, lateX - S * 0.025, lateY - small * 0.3, yellow);
  const gx = Math.max(S * 0.07, left + nw - gw - ww);
  // the blue rule leads in only when there is room for it to read as a rule
  if (gx - S * 0.04 > left + S * 0.06) rule(left, gx - S * 0.025, gy - gs * 0.3, blue);
  ctx.font = `italic 600 ${gs * 0.8}px ${ITAL}`; ctx.fillStyle = C(cream); ctx.fillText("with", gx, gy);
  ctx.font = `900 ${gs}px ${SOFT}`;
  vhsText(ctx, LINE, gx + ww, gy, cream, split * 0.6);

  // the moon centred over it all, rocking, a star either side twinkling
  const mx = S / 2;
  ctx.save(); ctx.translate(mx, my); ctx.rotate(0.08 * Math.sin(TAU * ph)); ctx.translate(-mx, -my);
  moon(ctx, kit, S, mx, my, mR, cream);
  ctx.restore();
  ctx.fillStyle = C(cream);
  sparkle(ctx, mx - S * 0.12, my - S * 0.02, S * 0.026 * tw(2, 0));
  sparkle(ctx, mx + S * 0.11, my + S * 0.025, S * 0.018 * tw(3, 2));
  tape(ctx, S, kit, 0.18);
};

/**
 * Late Night the broadcast way (after Saturday Night at the Movies): a neon script "Late"
 * over a fat flat-blue NIGHT, "WITH NO STUDIO AUDIENCE" in a blue bar. Flat paint, no chrome,
 * so it never reads as Get Pumped.
 */
export const broadcast: MixDraw = (ctx, S, ph, o, kit) => {
  ctx.fillStyle = C([0.09, 0.015, 280]); ctx.fillRect(0, 0, S, S);
  const neon = [0.7, 0.25, 355], core = [0.97, 0.04, 350];
  const breathe = 0.9 + 0.1 * Math.sin(TAU * ph * 2);
  const flick = ph > 0.62 && ph < 0.645 ? (Math.sin((ph - 0.62) * 800) > 0 ? 0.2 : 1) : 1;
  if (!o.titles) {
    ctx.save(); ctx.lineWidth = S * 0.014; ctx.lineCap = "round";
    ctx.shadowColor = C(neon, 0.95 * breathe); ctx.shadowBlur = S * 0.05; ctx.strokeStyle = C(neon, breathe);
    ctx.beginPath(); ctx.arc(S * 0.5, S * 0.48, S * 0.2, Math.PI * 0.25, Math.PI * 1.75); ctx.arc(S * 0.58, S * 0.44, S * 0.16, Math.PI * 1.62, Math.PI * 0.38, true); ctx.closePath(); ctx.stroke();
    ctx.restore();
    tape(ctx, S, kit, 0.2);
    return;
  }
  // NIGHT, flat: white into sky blue into deep blue, a white keyline round it
  let size = S * 0.4;
  ctx.font = `400 ${size}px "Bebas Neue", "Anton", sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  let w = ctx.measureText("NIGHT").width;
  if (w > S * 0.84) { size *= (S * 0.84) / w; ctx.font = `400 ${size}px "Bebas Neue", "Anton", sans-serif`; w = ctx.measureText("NIGHT").width; }
  // centre the stack, from the top of the tilted "Late" to the foot of the bar
  const gs = S * 0.26, lateRise = gs * 0.72 + S * 0.035, rel = -size * 0.7 + S * 0.02 - lateRise;
  const ny = S / 2 - (rel + S * 0.11) / 2, top = ny - size * 0.7, nl = S / 2 - w / 2;
  const fill = ctx.createLinearGradient(0, top, 0, ny);
  fill.addColorStop(0, C([0.96, 0.03, 230])); fill.addColorStop(0.45, C([0.74, 0.12, 240])); fill.addColorStop(1, C([0.45, 0.19, 262]));
  ctx.lineJoin = "round"; ctx.lineWidth = size * 0.05; ctx.strokeStyle = C([0.97, 0.02, 230]); ctx.strokeText("NIGHT", S / 2, ny);
  ctx.fillStyle = fill; ctx.fillText("NIGHT", S / 2, ny);
  // the bar
  ctx.font = `700 ${S * 0.05}px "Barlow Condensed", sans-serif`;
  const label = `WITH ${LINE.toUpperCase()}`;
  const lw = Math.min(S * 0.84, ctx.measureText(label).width + label.length * S * 0.008 + S * 0.06);
  ctx.fillStyle = C([0.48, 0.18, 262]); ctx.fillRect(S / 2 - lw / 2, ny + S * 0.035, lw, S * 0.075);
  ctx.fillStyle = C([0.98, 0.01, 230]);
  const ls = S * 0.008, chars = [...label], cw = chars.map((ch) => ctx.measureText(ch).width);
  const total = Math.min(lw - S * 0.05, cw.reduce((a, b) => a + b, 0) + ls * (chars.length - 1));
  const squeeze = total / (cw.reduce((a, b) => a + b, 0) + ls * (chars.length - 1));
  ctx.save(); ctx.translate(S / 2 - total / 2, ny + S * 0.092); ctx.scale(squeeze, 1); ctx.textAlign = "left";
  let cx = 0; chars.forEach((ch, i) => { ctx.fillText(ch, cx, 0); cx += cw[i] + ls; });
  ctx.restore();
  // the neon "Late", starting square on NIGHT's left edge and climbing across its top
  const a = breathe * flick;
  ctx.save(); ctx.translate(nl + S * 0.005, top + S * 0.02); ctx.rotate(-0.13);
  ctx.font = `400 ${gs}px "Yellowtail", cursive`; ctx.textAlign = "left";
  ctx.shadowColor = C(neon, 0.95 * a); ctx.shadowBlur = S * 0.05; ctx.fillStyle = C(neon, a); ctx.fillText("Late", 0, 0);
  ctx.shadowBlur = S * 0.015; ctx.fillText("Late", 0, 0);
  ctx.shadowBlur = 0; ctx.lineWidth = gs * 0.012; ctx.strokeStyle = C(core, 0.5 + 0.5 * a); ctx.strokeText("Late", 0, 0);
  ctx.restore();
  tape(ctx, S, kit, 0.2);
};
