/**
 * A head in profile, facing right, as cubic curves in a unit box: the crown at y = 0, the chin
 * at y = 1, the back of the skull at x = 0, the nose tip near x = 0.95. The neck slants back as
 * it runs on down to y = 1.5, below any frame it is drawn in. Proportions follow the classic
 * thirds: brow at 0.4, eyes at 0.5, the base of the nose at 0.66, the mouth at 0.77.
 */
export const PROFILE: { start: [number, number]; curves: [number, number, number, number, number, number][] } = {
  start: [0.44, 0.0],
  curves: [
    // crown over to the hairline, then the forehead down to the brow
    [0.64, 0.0, 0.775, 0.075, 0.82, 0.19],
    [0.848, 0.26, 0.868, 0.335, 0.866, 0.392],
    // the brow tucks into the bridge of the nose, which runs down and out to the tip
    [0.864, 0.418, 0.848, 0.43, 0.846, 0.446],
    [0.852, 0.51, 0.915, 0.575, 0.95, 0.618],
    // round the tip and back under the nose
    [0.966, 0.64, 0.944, 0.668, 0.896, 0.668],
    [0.878, 0.668, 0.872, 0.682, 0.876, 0.698],
    // the upper lip, out and down to the mouth
    [0.882, 0.72, 0.9, 0.74, 0.897, 0.755],
    [0.894, 0.768, 0.872, 0.772, 0.869, 0.779],
    // the lower lip, then in to the dip above the chin
    [0.878, 0.792, 0.892, 0.81, 0.885, 0.827],
    [0.878, 0.845, 0.852, 0.852, 0.852, 0.872],
    // the chin, round underneath
    [0.853, 0.905, 0.878, 0.935, 0.871, 0.962],
    [0.864, 0.995, 0.82, 1.008, 0.765, 1.008],
    // under the jaw, back to the throat, and down the front of the neck
    [0.705, 1.008, 0.655, 1.022, 0.632, 1.065],
    [0.612, 1.13, 0.6, 1.3, 0.57, 1.5],
    // across the bottom, up the back of the neck into the nape
    [0.42, 1.5, 0.28, 1.5, 0.15, 1.5],
    [0.17, 1.3, 0.19, 1.12, 0.205, 1.0],
    // the hollow of the nape, then the back of the skull, round and full, up over to the crown
    [0.222, 0.86, 0.03, 0.76, 0.018, 0.5],
    [0.008, 0.22, 0.2, 0.0, 0.44, 0.0],
  ],
};
