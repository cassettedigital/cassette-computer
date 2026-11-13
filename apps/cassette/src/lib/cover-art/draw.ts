import { palette } from "./color";
import { DRAW } from "./families";
import type { Ctx, Kit } from "./kit";
import { hash, rng } from "./rng";
import type { CoverSpec } from "./spec";

/** Draw one frame of a cover. `ph` is the position in the family's motion loop (0 to 1); stills use 0. */
export function drawCover(ctx: Ctx, S: number, spec: CoverSpec, ph: number, kit: Kit) {
  const r = rng(hash(`${spec.family}|${spec.seed}`));
  const p = palette(spec.hue, spec.mode, r);
  ctx.save();
  DRAW[spec.family](ctx, S, p, spec.title, r, ph, { titles: spec.titles }, kit);
  ctx.restore();
}
