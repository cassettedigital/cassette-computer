/**
 * AlbumGridSkeleton — the shared album/artwork grid skeleton.
 *
 * Matches the production `.cs-album-grid` layout: a square cover block + a single
 * caption line per card. This unifies the previously-duplicated inline markup in
 * dashboard/library/loading.tsx (which this now backs) and the home shelves.
 */

import { SkeletonBlock } from "./SkeletonBlock";
import styles from "./skeleton.module.css";

export type AlbumGridSkeletonProps = {
  /** Number of placeholder cards. Default 12 (one full library page). */
  count?: number;
  /** When set, renders a labeled, indeterminate progress line above the grid —
   *  the honest "we're fetching your library" affordance for a slow first load.
   *  Omit on the always-instant home shelves. */
  label?: string;
};

export function AlbumGridSkeleton({ count = 12, label }: AlbumGridSkeletonProps) {
  return (
    <>
      {label && (
        <div className={styles.loadingHeader}>
          <div className={styles.loadingLabel}>{label}</div>
          <div
            className={styles.progressTrack}
            role="progressbar"
            aria-label={label}
            aria-busy="true"
          >
            <div className={styles.progressBar} />
          </div>
        </div>
      )}
      <div className="cs-album-grid">
        {Array.from({ length: count }).map((_, i) => (
        // The sheen sweeps the whole card (cover + caption) as one surface.
        <div key={i} className={styles.cardSheen}>
          <SkeletonBlock
            height="auto"
            radius="md"
            delay={i}
            style={{ aspectRatio: "1" }}
          />
          <SkeletonBlock
            width="68%"
            height={11}
            radius="sm"
            delay={i}
            style={{ marginTop: 9 }}
          />
        </div>
      ))}
      </div>
    </>
  );
}
