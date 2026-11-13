/**
 * DashboardShellSkeleton — the full-viewport first-entry skeleton.
 *
 * This is what dashboard/loading.tsx renders. It is a static replica of the
 * workbench grid in DashboardShell.tsx so that, the instant a user clicks
 * "Dashboard", something dashboard-shaped appears (TopBar + Sidebar + content)
 * instead of the marketing homepage. Dimensions are copied from DashboardShell
 * (grid 56px / 1fr / 0; columns 236px / 1fr / 0) and TopBar (56px, brand lockup +
 * centered search well) so the swap to the real shell has no layout shift.
 */

import { SkeletonBlock } from "./SkeletonBlock";
import { SidebarSkeleton } from "./SidebarSkeleton";
import { DashboardHomeSkeleton } from "./DashboardHomeSkeleton";
import styles from "./skeleton.module.css";

function TopBarSkeleton() {
  return (
    <header
      style={{
        gridColumn: "1 / 4",
        display: "flex",
        alignItems: "center",
        padding: "0 18px",
        borderBottom: "1px solid var(--cs-border)",
        background: "var(--cs-bg)",
      }}
    >
      {/* brand lockup: 24px mark + 80px wordmark */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <SkeletonBlock width={24} height={24} radius="md" />
        <SkeletonBlock width={80} height={16} radius="sm" />
      </div>
      {/* search well (centered, max 540) */}
      <div style={{ flex: 1, maxWidth: 540, margin: "0 auto" }}>
        <SkeletonBlock height={36} radius="lg" />
      </div>
      <div style={{ width: 200 }} />
    </header>
  );
}

export function DashboardShellSkeleton() {
  return (
    <div
      aria-busy="true"
      style={{
        display: "grid",
        gridTemplateRows: "56px 1fr 0px",
        gridTemplateColumns: "236px 1fr 0px",
        height: "100vh",
        background: "var(--cs-bg)",
        color: "var(--cs-ink)",
      }}
    >
      <TopBarSkeleton />
      <SidebarSkeleton />
      <main
        style={{
          gridColumn: 2,
          overflowY: "auto",
          padding:
            "var(--cs-space-6) var(--cs-space-7) calc(var(--cs-space-7) + var(--cs-space-6))",
        }}
      >
        <DashboardHomeSkeleton />
      </main>
      <span className={styles.srOnly}>Loading your collection…</span>
    </div>
  );
}
