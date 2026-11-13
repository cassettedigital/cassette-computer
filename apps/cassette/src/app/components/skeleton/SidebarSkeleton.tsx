/**
 * SidebarSkeleton — Suspense fallback for <SidebarData>.
 * Matches the index-rail envelope (flat bg, hairline, row padding from space tokens)
 * so the swap to live content doesn't jump.
 */

import { SkeletonBlock } from "./SkeletonBlock";

function Row({
  labelWidth,
  lead = true,
  delay,
}: {
  labelWidth: number;
  lead?: boolean;
  delay: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--cs-space-3)",
        padding: "var(--cs-space-2) var(--cs-space-5) var(--cs-space-2) var(--cs-space-4)",
      }}
    >
      {lead ? <SkeletonBlock width={16} height={16} radius="sm" delay={delay} /> : null}
      <SkeletonBlock width={labelWidth} height={11} radius="sm" delay={delay} />
    </div>
  );
}

export function SidebarSkeleton() {
  return (
    <aside
      aria-busy="true"
      style={{
        gridColumn: 1,
        gridRow: 2,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        padding: "var(--cs-space-4) 0 0",
        borderRight: "1px solid var(--cs-border-subtle)",
        background: "var(--cs-bg)",
      }}
    >
      <nav style={{ display: "flex", flexDirection: "column" }}>
        <Row labelWidth={84} delay={0} />
        <div style={{ height: "var(--cs-space-4)" }} />
        <Row labelWidth={64} lead={false} delay={1} />
        <Row labelWidth={60} delay={2} />
        <Row labelWidth={62} delay={3} />
        <div style={{ height: "var(--cs-space-4)" }} />
        <Row labelWidth={72} lead={false} delay={4} />
        <Row labelWidth={70} delay={5} />
        <Row labelWidth={88} delay={6} />
        <div style={{ height: "var(--cs-space-4)" }} />
        <Row labelWidth={68} lead={false} delay={7} />
        <Row labelWidth={76} delay={8} />
        <Row labelWidth={90} delay={9} />
      </nav>
      <div style={{ flex: 1, minHeight: "var(--cs-space-4)" }} />
      <div
        style={{
          borderTop: "1px solid var(--cs-border-subtle)",
          background: "var(--cs-bg2)",
          padding: "var(--cs-space-2) var(--cs-space-5) var(--cs-space-2) var(--cs-space-4)",
          display: "flex",
          alignItems: "center",
          gap: "var(--cs-space-3)",
        }}
      >
        <SkeletonBlock width={30} height={30} radius="full" delay={10} />
        <SkeletonBlock width={96} height={11} radius="sm" delay={10} />
      </div>
    </aside>
  );
}
