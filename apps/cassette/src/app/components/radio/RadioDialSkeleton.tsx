/**
 * The Radio page on its way (desk/radio/loading.tsx; the founder, 2026-11-16: "clicks feeling instant and offering
 * a loading state"): On now's cards, the section rail and the dial's rows as bones, laid out by the dial's own
 * classes (RadioDial.module.css), so the page arrives where its skeleton stood. The window's title is drawn by the
 * window (a page's title is real words while it loads, not a bone). No hooks: a loading.tsx renders it on the
 * server.
 */

import { Skeleton, SkeletonPage } from "@/app/_taste/Skeleton";
import r from "./RadioDial.module.css";

// the names' widths, so the rows read as a list of stations and not a ruled pad
const NAMES = [46, 38, 54, 42, 50, 35, 47, 40];

export function RadioDialSkeleton() {
  return (
    <SkeletonPage label="Loading Radio">
      <Skeleton w="5.5em" h={22} style={{ margin: "6px 0 16px" }} />
      <ol className={r.onAirGrid}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <li key={i} className={r.onAir}>
            <Skeleton shape="cover" style={{ width: 112, height: 112, borderRadius: 0 }} />
            <span style={{ display: "grid", gap: 9 }}>
              <Skeleton w={`${NAMES[i]}%`} h={17} />
              <Skeleton w="82%" h={15} />
              <Skeleton w="34%" h={11} />
            </span>
            <Skeleton shape="circle" w={40} h={40} style={{ marginRight: 14 }} />
          </li>
        ))}
      </ol>
      <div className={r.dialRail}>
        {[7, 5.5, 6, 4, 4.5, 4, 5].map((w, i) => (
          <Skeleton key={i} shape="pill" w={`${w}em`} h={30} style={{ flex: "none" }} />
        ))}
      </div>
      <section className={r.dialSection}>
        <Skeleton w="8em" h={11} style={{ margin: "0 0 14px 16px" }} />
        <ol className={r.dialColumns}>
          {NAMES.map((w, i) => (
            <li key={i} style={{ display: "grid", gridTemplateColumns: "56px minmax(0, 1fr)", alignItems: "center", gap: 14, padding: "10px 16px" }}>
              <Skeleton shape="cover" style={{ width: 56, height: 56, borderRadius: "var(--pk-shape-station)" }} />
              <span style={{ display: "grid", gap: 7 }}>
                <Skeleton w={`${w}%`} h={16} />
                <Skeleton w="30%" h={11} />
                <Skeleton w="78%" h={12} />
              </span>
            </li>
          ))}
        </ol>
      </section>
    </SkeletonPage>
  );
}
