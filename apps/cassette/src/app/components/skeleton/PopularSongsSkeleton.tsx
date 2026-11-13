/**
 * PopularSongsSkeleton — reserves the collapsed artist-rail Popular block
 * so albums below don't jump when ranked songs arrive.
 *
 * Height lock: rows wear TrackRow.module.css (same padding, title line box,
 * acts column with a 15px Plus, 38px duration) — the real DraggableSourceRow
 * geometry. Show-more uses a hidden "Show 15 more" string so the line box
 * matches the live button. Sheen is the soft cardSheen variant (~half ink).
 */

import { Plus } from "lucide-react";
import { POPULAR_SONGS_COLLAPSED_LIMIT } from "@discovery/cassette-contract";
import { SkeletonBlock } from "./SkeletonBlock";
import trackStyles from "../TrackRow.module.css";
import styles from "./skeleton.module.css";

/** Title-bar widths that read as a list, not a solid wall. */
const TITLE_WIDTHS = ["72%", "58%", "80%", "64%", "70%"] as const;

/** Visible on --cs-bg2 rails (default SkeletonBlock fill matches the rail). */
const BLOCK_ON_RAIL = { background: "var(--cs-bg3)" } as const;

/**
 * Twin of RightRail showMoreBtn — keep in lockstep. Hidden label text below
 * owns the line box; do not set lineHeight here (browser default must match
 * the real button).
 */
const SHOW_MORE_SLOT = {
  display: "block" as const,
  width: "calc(100% - 24px)",
  margin: "4px 12px 2px",
  padding: "8px 0",
  fontFamily: "var(--cs-font-mono)",
  fontSize: 11,
  letterSpacing: "0.06em",
  textTransform: "uppercase" as const,
  borderTop: "1px solid var(--cs-border-subtle)",
  textAlign: "center" as const,
  position: "relative" as const,
};

export type PopularSongsSkeletonProps = {
  /** Defaults to the shared collapsed Popular limit (5). */
  rows?: number;
  /**
   * Reserve the collapsed "Show more" row. Default true — first paint usually
   * includes it; artists with ≤5 songs lose one button-height once.
   */
  reserveShowMore?: boolean;
};

function SkeletonTrackRow({
  delay,
  titleWidth,
}: {
  delay: number;
  titleWidth: string;
}) {
  return (
    <div className={`${trackStyles.row} ${trackStyles.static}`}>
      <span className={trackStyles.num}>
        <SkeletonBlock
          width={10}
          height={11}
          radius="sm"
          delay={delay}
          style={{ ...BLOCK_ON_RAIL, margin: "0 auto" }}
        />
      </span>
      <div className={trackStyles.body}>
        <div className={trackStyles.title}>
          {/* Invisible display text owns the real title line box; bar overlays. */}
          <span
            className={trackStyles.titleText}
            style={{
              position: "relative",
              display: "inline-block",
              width: titleWidth,
              maxWidth: "100%",
            }}
          >
            <span style={{ visibility: "hidden" }}>Song title</span>
            <span
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: "50%",
                transform: "translateY(-50%)",
              }}
            >
              <SkeletonBlock
                width="100%"
                height={11}
                radius="sm"
                delay={delay}
                style={BLOCK_ON_RAIL}
              />
            </span>
          </span>
        </div>
      </div>
      {/* Real rows pass onAdd — acts stays in layout (CSS opacity 0). */}
      <span className={trackStyles.acts} aria-hidden>
        <Plus size={15} />
      </span>
      <span className={trackStyles.dur}>
        <SkeletonBlock
          width={28}
          height={11}
          radius="sm"
          delay={delay}
          style={{ ...BLOCK_ON_RAIL, marginLeft: "auto" }}
        />
      </span>
    </div>
  );
}

export function PopularSongsSkeleton({
  rows = POPULAR_SONGS_COLLAPSED_LIMIT,
  reserveShowMore = true,
}: PopularSongsSkeletonProps) {
  return (
    <div
      aria-hidden="true"
      aria-busy="true"
      className={styles.cardSheenSoft}
      style={{ borderRadius: "var(--cs-radius-sm)" }}
    >
      <div
        style={{
          fontFamily: "var(--cs-font-mono)",
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--cs-ink3)",
          padding: "6px 12px 4px",
        }}
      >
        Songs
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonTrackRow
          key={i}
          delay={i}
          titleWidth={TITLE_WIDTHS[i % TITLE_WIDTHS.length]}
        />
      ))}
      {reserveShowMore && (
        <div style={SHOW_MORE_SLOT}>
          {/* Invisible label = exact Show-more line box (typical "Show 15 more"). */}
          <span style={{ visibility: "hidden" }}>Show 15 more</span>
          <span
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <SkeletonBlock
              width={110}
              height={11}
              radius="sm"
              delay={rows}
              style={BLOCK_ON_RAIL}
            />
          </span>
        </div>
      )}
    </div>
  );
}
