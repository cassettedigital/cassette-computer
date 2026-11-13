"use client";

/**
 * Two-phase email-change form mirroring the API at /api/auth/change-email.
 *
 *   Phase A: enter new email → POST { newEmail }
 *   Phase B: enter 6-digit code → POST { newEmail, code }
 *
 * On confirm success we router.refresh(). The route moved sessionVersion on,
 * which signs out every other browser within a minute (BUG-950), and wrote
 * this browser a session at the new version with the new email, so this one
 * stays signed in.
 */

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Field, Input, Key, Note } from "@discovery/cassette-kit";
import { SettingForm } from "@/app/settings/_parts/parts";

export function ChangeEmailForm({ currentEmail }: { currentEmail: string }) {
  const router = useRouter();
  const id = useId();
  const [phase, setPhase] = useState<"idle" | "code">("idle");
  const [newEmail, setNewEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    const res = await fetch("/api/auth/change-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newEmail }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Couldn't send code.");
      return;
    }
    setPhase("code");
    setInfo(`We sent a code to ${newEmail}. Enter it below to switch your account email.`);
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setInfo("");
    setLoading(true);
    const res = await fetch("/api/auth/change-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newEmail, code }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      setError(data.error ?? "Couldn't confirm code.");
      return;
    }
    setPhase("idle");
    setCode("");
    setNewEmail("");
    setInfo(`Email updated to ${data.email}.`);
    router.refresh();
  }

  return (
    <SettingForm
      onSubmit={phase === "idle" ? start : confirm}
      keys={
        <>
          <Key type="submit" tone="fill" disabled={loading}>
            {loading ? "Working…" : phase === "idle" ? "Send confirmation code" : "Confirm email change"}
          </Key>
          {phase === "code" && (
            <Key
              tone="plain"
              onClick={() => {
                setPhase("idle");
                setCode("");
                setError("");
                setInfo("");
              }}
            >
              Use a different email
            </Key>
          )}
        </>
      }
    >
      {error && <Note tone="danger">{error}</Note>}
      {info && <Note tone="success">{info}</Note>}

      <Field label="Current email" htmlFor={`${id}-now`}>
        <Input id={`${id}-now`} type="email" value={currentEmail} readOnly disabled />
      </Field>

      <Field label="New email" htmlFor={`${id}-new`}>
        <Input
          id={`${id}-new`}
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.currentTarget.value)}
          placeholder="you@example.com"
          required
          disabled={phase === "code"}
          autoComplete="email"
        />
      </Field>

      {phase === "code" && (
        <Field label="6-digit code" htmlFor={`${id}-code`}>
          <Input
            id={`${id}-code`}
            value={code}
            onChange={(e) => setCode(e.currentTarget.value)}
            placeholder="000000"
            required
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoComplete="one-time-code"
          />
        </Field>
      )}
    </SettingForm>
  );
}
