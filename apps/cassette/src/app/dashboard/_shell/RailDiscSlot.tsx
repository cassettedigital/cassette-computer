"use client";

/**
 * RailDiscSlot — the disc, in the rail. Rendered under the hub row while the
 * Devices fold is open, ONLY then (mount-gated by the caller so the sidecar
 * poll doesn't run on every dashboard page for people who never open the fold).
 *
 * One quiet row, three states:
 *   disc seated & identified → name + an orange "Rip" (explicit click; a rip
 *                              is never started on the user's behalf)
 *   ripping                  → spinning disc + live "done/total" counter
 *   needs attention          → link to the Devices page, where the full
 *                              confirm/naming flow lives
 * Hub offline or drive empty → renders nothing.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { Disc3 } from "lucide-react";
import { postSidecar, ripDoneCount, useRipStatus } from "@/lib/rip-status";
import styles from "./Sidebar.module.css";

/** Rail context re-polls gently; the Devices page keeps the fast cadence. */
const RAIL_POLL_MS = 4000;

export function RailDiscSlot() {
  const { status, reachability } = useRipStatus(RAIL_POLL_MS);
  const [busy, setBusy] = useState(false);

  const rip = useCallback(async () => {
    setBusy(true);
    await postSidecar("/api/rip/start");
    // Errors (409 already-ripping, unreachable) surface on the next poll /
    // on the Devices page — the rail stays quiet.
    setBusy(false);
  }, []);

  if (reachability !== "online" || !status) return null;

  const s = status.state;
  const name = status.album ?? "Audio CD";

  if (s === "ripping" || s === "registering") {
    const total = status.trackCount ?? status.tracks?.length ?? 0;
    const done = ripDoneCount(status);
    return (
      <Link href="/dashboard/devices" className={styles.discRow} title={`Ripping ${name}`}>
        <span className={`${styles.discIcon} ${styles.discSpin}`} aria-hidden="true">
          <Disc3 size={12} strokeWidth={1.75} />
        </span>
        <span className={styles.discName}>{name}</span>
        <span className={styles.discCount}>
          {done}/{total || "—"}
        </span>
      </Link>
    );
  }

  if (s === "confirm" || s === "detecting" || s === "error" || s === "incomplete") {
    return (
      <Link href="/dashboard/devices" className={styles.discRow}>
        <span className={styles.discIcon} aria-hidden="true">
          <Disc3 size={12} strokeWidth={1.75} />
        </span>
        <span className={styles.discName}>{name}</span>
        <span className={styles.discLook}>needs a look</span>
      </Link>
    );
  }

  if (status.discPresent || s === "matched" || s === "done") {
    return (
      <div className={styles.discRow}>
        <span className={styles.discIcon} aria-hidden="true">
          <Disc3 size={12} strokeWidth={1.75} />
        </span>
        <Link href="/dashboard/devices" className={styles.discName}>
          {name}
        </Link>
        <button
          type="button"
          className={styles.discRip}
          disabled={busy}
          onClick={() => void rip()}
        >
          Rip
        </button>
      </div>
    );
  }

  return null;
}
