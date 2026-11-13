/**
 * How many of n items fill whole rows at `cols` per row: the founder's rule that a grid never ends on a
 * short row (2026-10-21). Fewer items than one row's worth all show (one short row, not nothing). Pure.
 */
export function fullRows(n: number, cols: number): number {
  const c = Math.max(1, Math.floor(cols));
  if (n <= c) return Math.max(0, n);
  return Math.floor(n / c) * c;
}
