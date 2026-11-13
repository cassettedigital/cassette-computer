"use client";

/**
 * Diagnostics opt-out (Feature A). When ON (the default), this device sends
 * anonymous automatic crash/hang/error reports to the team so we can find and fix
 * problems you never had to describe. Turning it OFF stops the AUTOMATIC reports
 * across all your devices — it rides the same cross-device rails as your theme.
 *
 * It does NOT silence "Report a problem": feedback you send yourself is always
 * delivered, opt-out or not.
 *
 * Optimistic-with-revert against PATCH /api/account/diagnostics (mirrors
 * BetaToggle). The DB is the cross-device source of truth (native clients read it
 * via /api/sync/account); the web reads a device-fast localStorage key that the
 * root layout script consumes before first paint. So each toggle writes BOTH: the
 * localStorage key + live window.__cassetteDiag (immediate, no reload) and the DB.
 * On mount we re-seed the key from the DB `initial` so a fresh device converges.
 */

import { useEffect, useState, useTransition } from "react";
import { Note, Toggle } from "@discovery/cassette-kit";
import { Setting } from "@/app/settings/_parts/parts";

const CONSENT_KEY = "cs-diagnostics-consent";

/** Write the device-fast key + the live global together so the reporter and the
 *  next page-load's SSR script agree. "off" disables AUTO reports; "on" (or an
 *  absent key) is always-on. */
function applyConsent(next: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CONSENT_KEY, next ? "on" : "off");
  } catch {
    // storage blocked — the live global below still governs this session
  }
  window.__cassetteDiag = { ...window.__cassetteDiag, consent: next };
}

export function DiagnosticsToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");

  // Converge this device onto the DB value (the cross-device source). On a fresh
  // device the localStorage key is absent (defaulted true); seeding it here is the
  // reconciliation touchpoint that lets an opt-out set elsewhere take hold.
  useEffect(() => {
    applyConsent(initial);
  }, [initial]);

  function toggle(next: boolean) {
    setOn(next);
    setError("");
    applyConsent(next);
    startTransition(async () => {
      try {
        const res = await fetch("/api/account/diagnostics", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ diagnostics_consent: next }),
        });
        if (!res.ok) throw new Error("save failed");
      } catch {
        // Revert optimistic toggle + the device-fast key/global on failure.
        setOn(!next);
        applyConsent(!next);
        setError("Couldn't update your diagnostics preference.");
      }
    });
  }

  return (
    <Setting
      name="Send diagnostics"
      about={
        <>
          Automatically send anonymous crash and error reports so we can fix problems you never had to describe.
          No personal data, and this follows you across your devices. Turning it off never affects a note you
          send yourself. Those always reach us.
        </>
      }
      end={<Toggle on={on} onChange={toggle} label="Send diagnostics" disabled={pending} />}
    >
      {error ? <Note tone="danger">{error}</Note> : null}
    </Setting>
  );
}
