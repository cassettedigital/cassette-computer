"use client";

/**
 * Early features opt-in (self-serve; `users.is_beta_tester`, the "beta stream").
 * When ON, this account sees early features as they land. It's a COHORT, not a
 * privilege: it grants no elevated access, and you can leave anytime. Named
 * "Early features" on screen so it never reads as the Cassette beta itself
 * (the seat everyone signs up for at /waitlist).
 *
 * Authoritative write path for a user enrolling THEMSELVES; admins can also
 * enroll/remove from the Users pane. Mirrors ServerModeToggle's optimistic-with-
 * revert pattern against PATCH /api/account/beta.
 */

import { useState, useTransition } from "react";
import { Note, Toggle } from "@discovery/cassette-kit";
import { Setting } from "@/app/settings/_parts/parts";

export function BetaToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  function toggle(next: boolean) {
    setOn(next);
    setError("");
    startTransition(async () => {
      try {
        const res = await fetch("/api/account/beta", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ beta: next }),
        });
        if (!res.ok) throw new Error("save failed");
      } catch {
        // Revert optimistic toggle on failure.
        setOn(!next);
        setError("Couldn't update early features.");
      }
    });
  }

  return (
    <Setting
      name="Early features"
      about="Try new features before they reach everyone. They may be rough around the edges. Turn it off any time: it only changes which features you see."
      end={<Toggle on={on} onChange={toggle} label="Early features" disabled={pending} />}
    >
      {error ? <Note tone="danger">{error}</Note> : null}
    </Setting>
  );
}
