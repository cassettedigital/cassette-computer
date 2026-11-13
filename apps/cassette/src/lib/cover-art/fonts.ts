/**
 * The faces the cover families draw with. Every one is a Google Font (SIL OFL or
 * Apache 2.0, so both may be bundled); the server registers the static files in
 * assets/cover-fonts under exactly these family names, and the browser registers Latin
 * subsets of the same files (public/cover-fonts, see browser.ts) under them too.
 */
export const DISPLAY = '"Barlow Condensed", "Arial Narrow", sans-serif';
export const MONO = '"DM Mono", ui-monospace, Menlo, monospace';

export const F = {
  wide: '"Unbounded", "Arial Black", sans-serif',
  tiny: '"Space Mono", ui-monospace, monospace',
  serif: '"Instrument Serif", Georgia, serif',
  arena: '"Rubik Mono One", "Arial Black", sans-serif',
  vhs: '"Kanit", "Arial Black", sans-serif',
  grotesk: '"Schibsted Grotesk", "Helvetica Neue", sans-serif',
  heavy: '"Archivo Black", "Arial Black", sans-serif',
  brush: '"Mr Dafoe", cursive',
  label: '"Outfit", sans-serif',
  block: '"Bungee", "Arial Black", sans-serif',
  fest: '"Bricolage Grotesque", "Arial Black", sans-serif',
  anton: '"Anton", "Arial Narrow", sans-serif',
  dela: '"Dela Gothic One", "Arial Black", sans-serif',
};

/** Handwriting for tape labels: [face, size multiplier, since some pens write small]. */
export const HAND: [string, number][] = [
  ['"Permanent Marker", cursive', 1], ['"Rock Salt", cursive', 0.72], ['"Reenie Beanie", cursive', 1.45], ['"Homemade Apple", cursive', 0.72],
  ['"Nothing You Could Do", cursive', 0.85], ['"Shadows Into Light", cursive', 1.15], ['"Covered By Your Grace", cursive', 1.2],
  ['"Sue Ellen Francisco", cursive', 1.5], ['"Zeyada", cursive', 1.35], ['"Caveat", cursive', 1.25],
];
