/**
 * The letters a pictureless name shows when its tile is too small to read the name (BUG-637): the first
 * letter of each of the first two words, or the first two letters of a single word. Upper case, as the
 * name itself is set. Counts whole characters, so an accent or an emoji is never split.
 */
export function wordInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const letters = (w: string) => Array.from(w).filter((c) => /[\p{L}\p{N}]/u.test(c));
  const usable = words.map(letters).filter((l) => l.length > 0);
  if (usable.length === 0) return Array.from(words[0])[0]?.toUpperCase() ?? "";
  if (usable.length === 1) return usable[0].slice(0, 2).join("").toUpperCase();
  return (usable[0][0] + usable[1][0]).toUpperCase();
}
