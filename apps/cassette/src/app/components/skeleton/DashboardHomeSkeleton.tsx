/**
 * Dashboard home skeletons.
 *
 * Two exports:
 *   - DashboardHomeBodySkeleton — the shelves only (devices + albums + artists).
 *     Used as the Suspense fallback for the streamed home BODY, where the real
 *     welcome heading is already on screen (page renders it instantly from the
 *     cached session, then streams the body).
 *   - DashboardHomeSkeleton — welcome heading skeleton + the body. Used by the
 *     route-level loading.tsx, where no real content exists yet.
 *
 * `aria-busy` carries the loading state for assistive tech; there's no visible
 * "loading" copy (the load is fast enough that a banner reads heavier than the
 * wait it covers).
 *
 * Padding intentionally omitted: the shell's <main> cell already supplies it.
 */

import { SkeletonBlock } from "./SkeletonBlock";
import { AlbumGridSkeleton } from "./AlbumGridSkeleton";
import { DeviceCardSkeleton } from "./DeviceCardSkeleton";
import styles from "./skeleton.module.css";

function SectionHeaderSkeleton({ delay }: { delay: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        marginBottom: "var(--cs-space-4)",
      }}
    >
      <SkeletonBlock width={160} height={18} radius="sm" delay={delay} />
      <SkeletonBlock width={64} height={12} radius="sm" delay={delay + 1} />
    </div>
  );
}

/** The shelves only — no welcome heading. */
export function DashboardHomeBodySkeleton() {
  return (
    <div aria-busy="true">
      {/* Your devices */}
      <section style={{ marginBottom: "var(--cs-space-7)" }}>
        <SectionHeaderSkeleton delay={0} />
        <DeviceCardSkeleton count={2} />
      </section>

      {/* Albums shelf */}
      <section style={{ marginBottom: "var(--cs-space-7)" }}>
        <SectionHeaderSkeleton delay={1} />
        <AlbumGridSkeleton count={4} />
      </section>

      {/* Artists shelf */}
      <section style={{ marginBottom: "var(--cs-space-7)" }}>
        <SectionHeaderSkeleton delay={2} />
        <AlbumGridSkeleton count={4} />
      </section>

      <span className={styles.srOnly}>Loading your collection…</span>
    </div>
  );
}

/** Welcome heading skeleton + the body (full main-column first paint). */
export function DashboardHomeSkeleton() {
  return (
    <div style={{ maxWidth: "var(--cs-mw-app)" }} aria-busy="true">
      <header style={{ marginBottom: "var(--cs-space-7)" }}>
        <SkeletonBlock width={320} height={34} radius="sm" />
      </header>
      <DashboardHomeBodySkeleton />
    </div>
  );
}
