/**
 * The made-for-you mix covers drawn live in the browser (src/app/components/LiveCover.tsx): the
 * drawing, the faces each cover sets, and Road Trip's photographs, which the browser takes
 * from public/cover-photos (smaller copies of assets/cover-photos). Loaded on demand, in a
 * chunk of its own, so a page of playlist covers never downloads the mixes.
 */
import { createBrowserKit, loadFontsFor } from "../browser";
import { drawMixCover, PHOTOS, ROAD_TRIP_PHOTOS, type MixCoverSpec } from ".";

export { createBrowserKit, drawMixCover };

/** Bump when public/cover-photos changes: the files are cached for a year. */
const PHOTO_VERSION = 1;

let photos: Promise<void> | null = null;
function loadPhotos(): Promise<void> {
  photos ??= Promise.all(
    ROAD_TRIP_PHOTOS.map(
      (name) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => {
            PHOTOS[name] = img;
            resolve();
          };
          // a photo that fails leaves the cover's quiet card standing in
          img.onerror = () => resolve();
          img.src = `/cover-photos/${name}.jpg?v=${PHOTO_VERSION}`;
        }),
    ),
  ).then(() => undefined);
  return photos;
}

/** Everything a mix cover needs before its first live frame: its photographs, then its faces. */
export async function prepareMix(spec: MixCoverSpec): Promise<void> {
  // photos first: without one, Road Trip draws its stand-in card, which sets no type to find
  if (spec.key === "road-trip") await loadPhotos();
  // the mix covers set only their own words, all Latin, which the faces' sample already covers
  await loadFontsFor((ctx, S, ph, kit) => drawMixCover(ctx, S, spec, kit, ph), "");
}
