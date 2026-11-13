/**
 * DeviceCardSkeleton — placeholder for the home "Your devices" teaser rows.
 *
 * Principle (founder ruling 2026-07-27): skeletons import the REAL surface's
 * stylesheets and compose the real grid/row classes, with SkeletonBlocks only
 * in the text/meter slots. Geometry then tracks every future redesign for
 * free instead of drifting out of shape.
 */

import shelf from "@/app/dashboard/devices/devices-shelf.module.css";
import teaser from "@/app/dashboard/devices/_parts/DevicesTeaser.module.css";
import { SkeletonBlock } from "./SkeletonBlock";
import styles from "./skeleton.module.css";

export type DeviceCardSkeletonProps = {
  /** How many device rows to render. Default 2 (a typical account). */
  count?: number;
};

function DeviceRowSkeleton({ delay }: { delay: number }) {
  return (
    <div aria-hidden="true" className={`${shelf.dcard} ${styles.cardSheen}`}>
      <div className={shelf.dcardHead}>
        <SkeletonBlock width={7} height={7} radius="sm" delay={delay} style={{ borderRadius: "50%" }} />
        <div className={shelf.dcardId} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <SkeletonBlock width="40%" height={18} radius="sm" delay={delay} />
          <SkeletonBlock width="26%" height={11} radius="sm" delay={delay + 1} />
        </div>
      </div>
      <div className={shelf.dcardMeter} style={{ display: "flex", alignItems: "center", gap: "var(--cs-space-4)" }}>
        <div style={{ display: "flex", gap: 2, flex: 1, height: 12 }}>
          {Array.from({ length: 18 }).map((_, i) => (
            <SkeletonBlock
              key={i}
              height={12}
              radius="sm"
              delay={i}
              style={{ flex: "1 1 0", minWidth: 0 }}
            />
          ))}
        </div>
        <SkeletonBlock width={92} height={13} radius="sm" delay={delay} />
      </div>
    </div>
  );
}

export function DeviceCardSkeleton({ count = 2 }: DeviceCardSkeletonProps) {
  return (
    <div className={teaser.wrap}>
      {Array.from({ length: count }).map((_, i) => (
        <DeviceRowSkeleton key={i} delay={i} />
      ))}
    </div>
  );
}
