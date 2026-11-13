/**
 * Device status — the single source of truth for "is this device active?".
 *
 * Reachability copy used to be confusing: the same condition rendered with
 * divergent vocab ("reachable" for phones, "connected" for the Mac, bare
 * durations like "7m"), and the online window was redeclared in four files —
 * each pinned to a family's check-in cadence, so an actively-running device
 * flipped to "offline" on any jitter. This module decouples the window from
 * the cadence and gives every surface one vocabulary.
 *
 * The status is PURELY cosmetic — nothing gates sync on it. Intents queue
 * server-side and apply when the device next polls. So an "idle" device must
 * never read as "can't sync"; it just hasn't checked in lately.
 */

export type DeviceFamily = "player" | "phone";

export type DeviceStatusTone = "online" | "idle" | "never";

/**
 * The device-page status light has three connectivity states (green / amber /
 * dark socket). `deviceStatus().tone` collapses "seen 7m ago" and "seen 3d ago"
 * both to `idle`; the light wants to separate "reachable recently" (amber) from
 * "gone" (dark). This is a finer cosmetic bucket over the same lastSeenAt —
 * still purely cosmetic, nothing gates sync on it.
 */
export type DeviceLight = "live" | "idle" | "offline";

// Amber holds for a day past the online window; after that the socket goes dark.
const IDLE_WINDOW_MS = 24 * 60 * 60 * 1000;

export type DeviceStatus = {
  online: boolean;
  tone: DeviceStatusTone;
  /** Full label for cards / detail headers, e.g. "Active" or "Last seen 7m ago". */
  label: string;
  /** Compact label for the sidebar, e.g. "Active", "7m", or "—". */
  shortLabel: string;
};

// Online windows, decoupled from each family's check-in cadence so an
// actively-running device doesn't flicker offline on jitter:
//   - player: heartbeats every 5 min → tolerate 2 misses (15 min).
//   - phone:  polls ~every 30s in the foreground → 5 min is generous.
const WINDOW_MS: Record<DeviceFamily, number> = {
  player: 15 * 60 * 1000,
  phone: 5 * 60 * 1000,
};

/** Coarse age string: "7m" (<60m), else "3h" (<24h), else "2d". */
function agoLabel(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

/**
 * Resolve a device's last-seen timestamp into a consistent status.
 *
 * @param lastSeenAt the last heartbeat/poll instant (Date, ISO string, or null)
 * @param family     "player" (the Mac/Cassette Player) or "phone"
 * @param now        injectable clock for tests; defaults to Date.now()
 */
export function deviceStatus(
  lastSeenAt: Date | string | null | undefined,
  family: DeviceFamily,
  now: number = Date.now()
): DeviceStatus {
  if (lastSeenAt == null) {
    return {
      online: false,
      tone: "never",
      label: "Never connected",
      shortLabel: "—",
    };
  }

  const seen = lastSeenAt instanceof Date ? lastSeenAt : new Date(lastSeenAt);
  const ms = now - seen.getTime();

  if (ms <= WINDOW_MS[family]) {
    return { online: true, tone: "online", label: "Active", shortLabel: "Active" };
  }

  const ago = agoLabel(ms);
  return {
    online: false,
    tone: "idle",
    label: `Last seen ${ago} ago`,
    shortLabel: ago,
  };
}

/**
 * Resolve a device's last-seen timestamp into the 3-state status light.
 * live  = within the online window (green + glow)
 * idle  = reachable recently, within a day (amber)
 * offline = gone for over a day, or never connected (dark socket)
 */
export function deviceLight(
  lastSeenAt: Date | string | null | undefined,
  family: DeviceFamily,
  now: number = Date.now()
): DeviceLight {
  if (lastSeenAt == null) return "offline";
  const seen = lastSeenAt instanceof Date ? lastSeenAt : new Date(lastSeenAt);
  const ms = now - seen.getTime();
  if (ms <= WINDOW_MS[family]) return "live";
  if (ms <= IDLE_WINDOW_MS) return "idle";
  return "offline";
}

/**
 * The one light→lamp mapping. Every surface that renders a device's
 * connectivity (rail, devices shelf, teaser, detail header) feeds the kit
 * StatusDot through this — there is no second lamp.
 */
export function toneForLight(
  light: DeviceLight
): "reachable" | "syncing" | "offline" {
  if (light === "live") return "reachable";
  if (light === "idle") return "syncing";
  return "offline";
}
