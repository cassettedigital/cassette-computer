"use client";

/**
 * UnhideButton: brings one hidden album back. POSTs the album's group key to /api/sync/library/unhide (which
 * clears removed_at and drops the `hidden` tombstones), then refreshes so the album drops off the Hidden list.
 * The player kit's key.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { Key } from "@discovery/cassette-kit";

export function UnhideButton({ groupKey }: { groupKey: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function unhide() {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/sync/library/unhide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "album", group_key: groupKey }),
      });
      if (!res.ok) throw new Error("unhide failed");
      router.refresh();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <Key tone={failed ? "danger" : "line"} onClick={unhide} disabled={busy}>
      <RotateCcw size={14} strokeWidth={2.25} aria-hidden="true" />
      {busy ? "Unhiding…" : failed ? "Try again" : "Unhide"}
    </Key>
  );
}
