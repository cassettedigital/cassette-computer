/**
 * Pure string normalization for library → catalog matching.
 * Display strings stay untouched; these helpers build comparison keys only.
 */

const EDITION_QUALIFIER =
  /\s*[\[(][^\])]*(?:deluxe edition|deluxe|remastered|remaster|anniversary|expanded|bonus|mono|stereo)[^\])]*[\])]\s*$/i;

const FEAT_SPLIT =
  /\s+(?:feat\.|featuring|ft\.|with)\s+.*/i;

/** Strip diacritics via NFD decomposition. */
function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
}

/**
 * Fold every Unicode dash/hyphen variant to ASCII "-" so titles differing only
 * by hyphen style match — e.g. the U+2010 hyphen in the catalog's "K‐Pop…" vs a
 * user's plain "K-Pop…". Covers hyphen, non-breaking hyphen, figure dash,
 * en/em dash, horizontal bar, minus sign, and fullwidth hyphen.
 */
function foldDashes(s: string): string {
  return s.replace(/[‐-―−﹘﹣－]/g, "-");
}

/** Remove punctuation while preserving word boundaries. */
function stripPunctuation(s: string): string {
  return s.replace(/[^\p{L}\p{N}\s]/gu, " ");
}

/**
 * Lowercase, trim, collapse whitespace, strip diacritics and punctuation,
 * strip a leading "the ", and strip trailing edition qualifiers in () or [].
 */
export function normalizeTitle(s: string): string {
  let out = foldDashes(stripDiacritics(s)).toLowerCase().trim();
  out = out.replace(EDITION_QUALIFIER, "").trim();
  out = stripPunctuation(out);
  out = out.replace(/\s+/g, " ").trim();
  if (out.startsWith("the ")) out = out.slice(4).trim();
  return out;
}

/**
 * Remove featured-artist suffixes (" feat. ", " featuring ", " ft. ", " with ").
 * Leaves "&" and " x " intact so real duos are not merged incorrectly.
 */
export function stripFeatured(s: string): string {
  const idx = s.search(FEAT_SPLIT);
  if (idx === -1) return s.trim();
  return s.slice(0, idx).trim();
}

/** Artist comparison key: normalizeTitle(stripFeatured(s)). */
export function normalizeArtist(s: string): string {
  return normalizeTitle(stripFeatured(s));
}
