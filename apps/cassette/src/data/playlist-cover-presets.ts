/**
 * Curated preset playlist covers — abstract/textural only (gradients, grain,
 * geometric), no photography. Static SVGs in public/playlist-covers/, built
 * from the app's own warm gray + orange accent scale (never a second, cool
 * hue — see globals.css's --cs-accent-* comment).
 *
 * Static set for now per founder decision: a live Unsplash (or similar) API
 * source was considered and deliberately deferred — introducing a new
 * external dependency (rate limits, key management, attribution, cost at
 * scale) needs an explicit go-ahead, not a default. `PlaylistCoverPreset` is
 * shaped so a future live source can slot in as an additional group without
 * reworking the picker: swap/extend this array, the grid and selection flow
 * don't change.
 */

export type PlaylistCoverPreset = {
  id: string;
  url: string;
  label: string;
};

/**
 * True when a cover URL is one of our built-in preset SVGs (orange-on-warm-dark
 * abstracts), as opposed to a user upload or real album art. ONLY preset covers
 * may take the `.cs-cover-skin` hue-shift class — recolouring a photo or a
 * user's own upload would be wrong. Matches the preset FILES themselves
 * (/playlist-covers/preset-NN.svg or .png, the pattern the phones use), never the
 * folder: a person's uploads live under playlist-covers/<user>/<playlist>/ in R2, and
 * matching the folder hue-shifted their photo on any skin but Classic (BUG-503,
 * BUG-552). Read decoded too, so it holds whether the URL is bare or wrapped by the
 * image optimizer (/_next/image?url=%2Fplaylist-covers%2F...).
 */
const PRESET_FILE = /\/playlist-covers\/preset-\d+\.(?:svg|png)(?=$|[?#&])/;

export function isPresetCover(url: string | null | undefined): boolean {
  if (typeof url !== "string" || !url) return false;
  if (PRESET_FILE.test(url)) return true;
  try {
    return PRESET_FILE.test(decodeURIComponent(url));
  } catch {
    return false;
  }
}

export const PLAYLIST_COVER_PRESETS: PlaylistCoverPreset[] = [
  { id: "preset-01", url: "/playlist-covers/preset-01.svg", label: "Amber diagonal" },
  { id: "preset-02", url: "/playlist-covers/preset-02.svg", label: "Warm bloom" },
  { id: "preset-03", url: "/playlist-covers/preset-03.svg", label: "Split angle" },
  { id: "preset-04", url: "/playlist-covers/preset-04.svg", label: "Fine grain" },
  { id: "preset-05", url: "/playlist-covers/preset-05.svg", label: "Vinyl groove" },
  { id: "preset-06", url: "/playlist-covers/preset-06.svg", label: "Tape reel bars" },
  { id: "preset-07", url: "/playlist-covers/preset-07.svg", label: "Diamond cut" },
  { id: "preset-08", url: "/playlist-covers/preset-08.svg", label: "Soft glow" },
  { id: "preset-09", url: "/playlist-covers/preset-09.svg", label: "Textured wash" },
  { id: "preset-10", url: "/playlist-covers/preset-10.svg", label: "Dot grid" },
  { id: "preset-11", url: "/playlist-covers/preset-11.svg", label: "Amber streaks" },
  { id: "preset-12", url: "/playlist-covers/preset-12.svg", label: "Dual bloom" },
  { id: "preset-13", url: "/playlist-covers/preset-13.svg", label: "Cross-hatch" },
  { id: "preset-14", url: "/playlist-covers/preset-14.svg", label: "Tri-band" },
  { id: "preset-15", url: "/playlist-covers/preset-15.svg", label: "Corner glow" },
  { id: "preset-16", url: "/playlist-covers/preset-16.svg", label: "Halftone fade" },
];
