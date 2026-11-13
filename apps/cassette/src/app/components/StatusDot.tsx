/**
 * StatusDot — the canonical status lamp (graduated from the kit). A seated
 * domed LED beside an optional mono label, in the Cassette lamp vocabulary.
 * Replaces the bordered StatusPill. Tones:
 *   reachable (green) · syncing (amber) · busy (orange) · error (red) · offline (grey)
 *
 * Device connectivity maps: live → reachable, idle → syncing, offline → offline.
 * Pass showLabel={false} for dense rows (device cards / rail) where the colour is
 * enough — the label stays as the accessible name + tooltip.
 * `size="sm"` is the 7px rail leading-slot lamp; default stays 9px.
 */

import styles from "./StatusDot.module.css";

export type StatusTone = "reachable" | "syncing" | "busy" | "error" | "offline";

export function StatusDot({
  tone,
  label,
  showLabel = true,
  size = "md",
  className,
}: {
  tone: StatusTone;
  label: string;
  showLabel?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const lampClass = [
    styles.lamp,
    size === "sm" ? styles.sm : "",
    className && !showLabel ? className : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (!showLabel) {
    return (
      <span
        className={lampClass}
        data-tone={tone}
        role="img"
        aria-label={label}
        title={label}
      />
    );
  }
  return (
    <span className={[styles.status, className].filter(Boolean).join(" ")}>
      <span className={[styles.lamp, size === "sm" ? styles.sm : ""].filter(Boolean).join(" ")} data-tone={tone} />
      {label}
    </span>
  );
}
