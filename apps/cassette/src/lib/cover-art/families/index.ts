import { draw as echo } from "./echo";
import { draw as discs } from "./discs";
import { draw as rays } from "./rays";
import { draw as spectrum } from "./spectrum";
import { draw as rings } from "./rings";
import { draw as arena } from "./arena";
import { draw as extrude } from "./extrude";
import { draw as script } from "./script";
import { draw as marble } from "./marble";
import { draw as eq } from "./eq";
import { draw as ribbon } from "./ribbon";
import { draw as sunflower } from "./sunflower";
import { draw as bauhaus } from "./bauhaus";
import { draw as riso } from "./riso";
import { draw as ridge } from "./ridge";
import { draw as bloom } from "./bloom";
import { draw as topo } from "./topo";
import { draw as dither } from "./dither";
import { draw as scope } from "./scope";
import { draw as origami } from "./origami";
import { draw as lens } from "./lens";
import { draw as moire } from "./moire";
import { draw as signal } from "./signal";
import { draw as seigaiha } from "./seigaiha";
import { draw as jcard } from "./jcard";
import { draw as poster } from "./poster";
import type { FamilyDraw } from "../kit";
import type { FamilyId } from "../spec";

export const DRAW: Record<FamilyId, FamilyDraw> = {
  echo, discs, rays, spectrum, rings, arena, extrude, script, marble, eq, ribbon, sunflower, bauhaus, riso, ridge, bloom, topo, dither, scope, origami, lens, moire, signal, seigaiha, jcard, poster,
};
