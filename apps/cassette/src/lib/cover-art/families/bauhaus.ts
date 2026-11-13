import { C, TAU } from "../color";
import type { FamilyDraw } from "../kit";
import { disc, fitSize } from "../kit";
import { F } from "../fonts";

type Tile = { x: number; y: number; b: number; f: number; s: number; corner: number; cx: number; cy: number; anchor: [number, number]; spikes: number; tilt: number; pops: boolean; slot: number };

export const draw: FamilyDraw = (ctx, S, p, name, r, ph, o, kit) => {
  // half the covers become a festival poster: the name chopped into chunky rows on its own panel, foil and red dots scattered over the top
  r(); // keeps the draws after it where the lab had them
  const fest = o.titles, tall = r() < 0.5;
  const n = fest ? 3 : r() < 0.5 ? 2 : 3, cs = S / n, cols = [p.bg, p.c1, p.c2, p.c3];
  const pick = () => { const v = r(); return v < 0.45 ? 0 : v < 0.7 ? 1 : v < 0.9 ? 2 : 3; };
  const typeCell = (i: number, j: number) => fest && (tall ? i === 0 : i < 2 && j < 2);
  const order = Array.from({ length: n * n }, (_, i) => i).sort(() => r() - 0.5);
  const tiles: Tile[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const b = pick(); let f = pick(); if (f === b) f = (b + 1 + Math.floor(r() * 3)) % 4;
    const s = Math.floor(r() * 8), corner = Math.floor(r() * 4), spikes = 8 + Math.floor(r() * 6), tilt = (r() - 0.5) * 1.2, pops = r() < 0.4;
    const cx = (corner % 2) * cs, cy = corner > 1 ? cs : 0;
    // where the shape grows from, and where the new color floods out from
    const anchor: [number, number] = s === 0 ? [cx, cy] : s === 1 ? [cs / 2, cy] : s === 3 ? [cs / 3, corner % 2 ? cs / 3 : cs / 2] : [cs / 2, cs / 2];
    if (!typeCell(i, j)) tiles.push({ x: i * cs, y: j * cs, b, f, s, corner, cx, cy, anchor, spikes, tilt, pops, slot: order.indexOf(i * n + j) / (n * n) / 2 });
  }
  const tile = (t: Tile, bg: number, fg: number, sc: number) => {
    ctx.fillStyle = C(cols[bg]); ctx.fillRect(0, 0, cs + 0.5, cs + 0.5);
    ctx.save(); ctx.translate(...t.anchor); ctx.scale(sc, sc); ctx.translate(-t.anchor[0], -t.anchor[1]);
    ctx.fillStyle = C(cols[fg]); ctx.beginPath();
    const m = cs / 2;
    if (t.s === 0) disc(ctx, t.cx, t.cy, cs);
    else if (t.s === 1) disc(ctx, m, t.cy, m);
    else if (t.s === 2) disc(ctx, m, m, cs * 0.36);
    else if (t.s === 3) { ctx.moveTo(0, 0); ctx.lineTo(cs, t.corner % 2 ? 0 : cs); ctx.lineTo(0, cs); ctx.fill(); }
    else if (t.s === 4) for (let k = 0; k < 3; k++) ctx.fillRect(cs * 0.12, cs * (0.18 + k * 0.25), cs * 0.76, cs * 0.12);
    else if (t.s === 5) { for (let k = 0; k < t.spikes * 2; k++) { const a = k * Math.PI / t.spikes + t.tilt, rr = k % 2 ? cs * 0.24 : cs * 0.45; ctx.lineTo(m + Math.cos(a) * rr, m + Math.sin(a) * rr); } ctx.closePath(); ctx.fill(); }
    else if (t.s === 6) { for (let k = 0; k < 8; k++) { const a = (k + 0.5) * Math.PI / 4; ctx.lineTo(m + Math.cos(a) * cs * 0.4, m + Math.sin(a) * cs * 0.4); } ctx.closePath(); ctx.fill(); }
    else { ctx.translate(m, m); ctx.rotate(t.tilt); ctx.fillRect(-cs * 0.44, -cs * 0.16, cs * 0.88, cs * 0.32); }
    ctx.restore();
  };
  // per event: the shape gives a quick springy bounce, and partway through it the swapped colors flood out from the shape
  const BOUNCE = 0.04, FLOOD_AT = 0.014, FLOOD = 0.055;
  for (const t of tiles) {
    ctx.save(); ctx.translate(t.x, t.y); ctx.beginPath(); ctx.rect(0, 0, cs + 0.5, cs + 0.5); ctx.clip();
    const u = (((ph - t.slot) % 1) + 1) % 1;
    let done = false;
    if (t.pops) for (const e of [0, 0.5]) {
      const d = ((u - e) % 1 + 1) % 1;
      if (d >= FLOOD_AT + FLOOD) continue;
      const k = d / BOUNCE, sc = d < BOUNCE ? 1 + 0.2 * Math.sin(k * Math.PI * 2.5) * (1 - k) ** 2 : 1;
      const [oB, oF] = e !== 0 ? [t.f, t.b] : [t.b, t.f];
      tile(t, oB, oF, sc);
      if (d > FLOOD_AT) {
        const q = 1 - (1 - (d - FLOOD_AT) / FLOOD) ** 3;
        ctx.beginPath(); ctx.arc(t.anchor[0], t.anchor[1], q * cs * 1.45, 0, TAU); ctx.clip();
        tile(t, oF, oB, sc);
      }
      done = true; break;
    }
    if (!done) { const inv = t.pops && u < 0.5; tile(t, inv ? t.f : t.b, inv ? t.b : t.f, 1); }
    ctx.restore();
  }
  if (fest) {
    const bw = tall ? cs : 2 * cs, bh = tall ? S : 2 * cs;
    ctx.fillStyle = C([p.c2, p.c3, p.c1][Math.floor(r() * 3)]); ctx.fillRect(0, 0, bw + 0.5, bh + 0.5);
    // each word cut into chunks of a few letters, every chunk set as wide as the panel
    const maxC = tall ? 3 : 4, chunks = [];
    for (const wd of name.toUpperCase().split(/\s+/)) {
      const L = (wd.match(/[A-Z0-9&!?']/g) || []).join(""); if (!L) continue;
      const parts = Math.ceil(L.length / maxC); let at = 0;
      for (let k = 0; k < parts; k++) { const len = Math.round((L.length - at) / (parts - k)); chunks.push(L.slice(at, at + len)); at += len; }
    }
    if (!chunks.length) chunks.push("?");
    const pad = bw * 0.07, sizes = chunks.map(c => fitSize(ctx, c, F.fest, 800, bw - pad * 2, bh));
    const gap = bh * 0.025, capH = sizes.reduce((s, v) => s + v * 0.74, 0), k = Math.min(1, (bh - pad * 2 - gap * (chunks.length - 1)) / capH);
    ctx.fillStyle = C(p.ink); ctx.textAlign = "left";
    let y = pad;
    chunks.forEach((c, i) => { const s = sizes[i] * k; ctx.font = `800 ${s}px ${F.fest}`; y += s * 0.74; ctx.fillText(c, pad - s * 0.03, y); y += gap; });
    const foil = (x: number, y2: number, rad: number) => { const g = ctx.createRadialGradient(x - rad * 0.35, y2 - rad * 0.35, 0, x, y2, rad); g.addColorStop(0, "#fbfbfb"); g.addColorStop(0.55, "#cfd0d4"); g.addColorStop(1, "#8d8e95"); return g; };
    for (let i = 0; i < 6; i++) { const x = r() * S, y2 = r() * S, rad = S * (0.009 + r() * 0.01); ctx.fillStyle = foil(x, y2, rad); disc(ctx, x, y2, rad); }
    ctx.fillStyle = C([p.c1[0] * 0.85, Math.min(0.24, p.c1[1] * 1.2), p.c1[2]]);
    for (let i = 0; i < 4; i++) disc(ctx, r() * S, r() * S, S * 0.0085);
    const bx = r() * S, by = r() * S, br = S * 0.035;
    ctx.fillStyle = foil(bx, by, br); ctx.beginPath();
    for (let q = 0; q < 16; q++) { const a = q * Math.PI / 8 + ph * TAU / 8, rr = q % 2 ? br * 0.55 : br; ctx.lineTo(bx + Math.cos(a) * rr, by + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
  }
  kit.grain(ctx, S, 0.1);
};
