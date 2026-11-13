/**
 * The made-for-you mix covers' drawing: each version of each mix (./catalog.ts lists them)
 * mapped to the code that draws it. Loaded by the cover route and the live covers, never by a
 * plain page, since the families are most of the code.
 */
import type { Ctx, Kit } from "../kit";
import { mixVersionOf, type MixCoverSpec, type MixKey } from "./catalog";
import { aerobics, chrome } from "./getpumped";
import { head, script } from "./focus";
import { fogged } from "./winddown";
import { broadcast, show } from "./latenight";
import { memphis, smear } from "./feelgood";
import { cloudPhoto, roadPhoto } from "./roadtrip";
import { knit } from "./sweaterweather";
import { streak } from "./sunset";
import { conditions } from "./slowstart";
import { printad, checker, twotone, toned } from "./tidyup";
import { sampler } from "./homesweethome";
import type { MixDraw } from "./util";

export * from "./catalog";
export { PHOTOS, ROAD_TRIP_PHOTOS } from "./roadtrip";

/** Every version's drawing, by mix and version. */
export const MIX_DRAW: Record<MixKey, Record<string, MixDraw>> = {
  "get-pumped": { chrome, aerobics },
  focus: { head, script },
  "wind-down": { window: fogged },
  "late-night": { show, broadcast },
  "feel-good": { memphis, smear },
  "road-trip": {
    "red-rock": roadPhoto("red-rock-road", [0.5, 0.62]),
    "teal-sky": roadPhoto("teal-sky-road", [0.55, 0.55]),
    cloud: cloudPhoto("single-cloud", ["rgb(38, 100, 172)", "rgb(66, 129, 195)"]),
  },
  "sweater-weather": { knit },
  sunset: { streak },
  "slow-start": { conditions },
  "tidy-up": { printad, checker, twotone, toned },
  "home-sweet-home": { sampler },
};

/** One frame of a mix cover; `ph` defaults to the version's still. */
export function drawMixCover(ctx: Ctx, S: number, spec: MixCoverSpec, kit: Kit, ph = mixVersionOf(spec).still) {
  MIX_DRAW[spec.key][spec.version](ctx, S, ph, { titles: true }, kit);
}
