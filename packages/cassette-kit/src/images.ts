/**
 * The image ladder on the web (tokens.json `images`; contract in docs/reference/CASSETTE_IMAGES.md).
 *
 * Every picture Cassette shows comes in five sizes, the rungs, made once by the edge resizer
 * (services/media-edge) and addressed as `IMAGE_HOST/i/<rung>/<bucket>/<key>?v=<version>`. A route
 * hands the client an `ImageRef` whose `src` carries `{rung}`; the client picks the rung for its frame
 * with `pickRung` (or lets the browser pick from `imageSrcSet`). Nothing here builds an address from a
 * stored URL: that is the server's job (`imageRef` in apps/cassette/src/lib/images).
 *
 * The same rule is generated into Swift and Kotlin from tokens.json, and `PICK_EXAMPLES` checks all three.
 */

import { ASSUMED_ASPECT, IMAGE_HOST, IMAGE_RUNGS, PICK_EXAMPLES } from "./images.generated";

export { ASSUMED_ASPECT, IMAGE_EXTERNAL_HOSTS, IMAGE_FORMAT, IMAGE_HOST, IMAGE_PATH, IMAGE_RUNGS, PICK_EXAMPLES } from "./images.generated";

export type ImageRung = (typeof IMAGE_RUNGS)[number];

/** What a picture is, for the shape to assume when its size is not stored. */
export type ImageKind = "cover" | "photo" | "avatar" | "playlist" | "mix" | "station" | "other";

/**
 * A picture as every API sends it for display. `src` is a template: put a rung in place of `{rung}`.
 * `w` and `h` are the natural size when stored (so a frame can take its shape before the picture
 * arrives, and no client asks above it).
 */
export type ImageRef = {
  src: string;
  w?: number;
  h?: number;
  kind: ImageKind;
};

/** The three places a source can live: the media bucket, the uploads bucket, an allow-listed outside address. */
export type ImageBucket = "m" | "u" | "x";

export type Fit = "cover" | "contain";

/**
 * The rung for a frame `w` x `h` (points, or CSS pixels) at `scale`, showing a picture of `aspect`
 * (width over height), cropped to fill (`cover`) or shown whole (`contain`); never above the rung that
 * holds the picture's `natural` longest side when it is known.
 */
export function pickRung(frame: { w: number; h: number; scale: number; aspect?: number; fit?: Fit; natural?: number | null }): ImageRung {
  const a = frame.aspect && frame.aspect > 0 ? frame.aspect : 1;
  const s = (frame.fit ?? "cover") === "cover" ? Math.max(frame.w / a, frame.h) : Math.min(frame.w / a, frame.h);
  const needed = s * Math.max(a, 1) * frame.scale;
  const top = IMAGE_RUNGS[IMAGE_RUNGS.length - 1];
  let rung: ImageRung = IMAGE_RUNGS.find((r) => r >= needed - 1e-6) ?? top;
  if (frame.natural && frame.natural > 0) {
    const holds: ImageRung = IMAGE_RUNGS.find((r) => r >= frame.natural!) ?? top;
    if (holds < rung) rung = holds;
  }
  return rung;
}

/** The shape to assume for a reference with no stored size. */
export function aspectOf(ref: Pick<ImageRef, "w" | "h" | "kind">): number {
  if (ref.w && ref.h) return ref.w / ref.h;
  return ref.kind === "photo" ? ASSUMED_ASPECT.photo : ASSUMED_ASPECT.cover;
}

/** The address of one rung of a reference. */
export function imageUrl(ref: Pick<ImageRef, "src">, rung: ImageRung): string {
  return ref.src.replace("{rung}", String(rung));
}

/** The longest side the picture will actually have at `rung` (a rung is never larger than the picture). */
function longestAt(ref: Pick<ImageRef, "w" | "h">, rung: number): number {
  const natural = ref.w && ref.h ? Math.max(ref.w, ref.h) : undefined;
  return natural ? Math.min(rung, natural) : rung;
}

/**
 * A `srcset` with each rung's TRUE width (a portrait's width is less than its longest side), stopping
 * at the first rung that holds the whole picture, so the browser never fetches two copies of the same
 * pixels. Pair it with `sizes` set to the frame's width.
 */
export function imageSrcSet(ref: ImageRef): string {
  const aspect = aspectOf(ref);
  const natural = ref.w && ref.h ? Math.max(ref.w, ref.h) : undefined;
  const out: string[] = [];
  for (const rung of IMAGE_RUNGS) {
    const longest = longestAt(ref, rung);
    const width = Math.round(aspect >= 1 ? longest : longest * aspect);
    out.push(`${imageUrl(ref, rung)} ${width}w`);
    if (natural && rung >= natural) break;
  }
  return out.join(", ");
}

/** The template address for a source, for the server's `imageRef` (and the edge's own tests). */
export function ladderTemplate(bucket: ImageBucket, key: string, version?: string | null): string {
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `${IMAGE_HOST}/i/{rung}/${bucket}/${path}${version ? `?v=${encodeURIComponent(version)}` : ""}`;
}

/** Whether an address is one of the ladder's (any rung, any bucket). */
export function isLadderUrl(url: string | null | undefined): boolean {
  return !!url && url.startsWith(`${IMAGE_HOST}/i/`);
}

export type { ImageRung as Rung };
export const IMAGE_PICK_EXAMPLES = PICK_EXAMPLES;
