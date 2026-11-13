"use client";

/**
 * Change or add a password (POST /api/auth/set-password), on the player kit's fields and keys. Someone who
 * signs in with Google adds one here and can then sign in either way. (The old copy in
 * dashboard/components/PasswordForm.tsx is no longer drawn anywhere.)
 */

import { useId, useState } from "react";
import { Field, Input, Key, Note } from "@discovery/cassette-kit";
import { SettingForm } from "@/app/settings/_parts/parts";

export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const id = useId();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess(false);
    setLoading(true);
    const body: Record<string, string> = { newPassword };
    if (hasPassword) body.currentPassword = currentPassword;
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Couldn't save. Try again.");
      } else {
        setSuccess(true);
        setCurrentPassword("");
        setNewPassword("");
      }
    } catch {
      setError("Couldn't save. Try again.");
    }
    setLoading(false);
  }

  return (
    <SettingForm
      onSubmit={handleSubmit}
      keys={
        <Key type="submit" tone="fill" disabled={loading}>
          {loading ? "Saving…" : hasPassword ? "Change password" : "Add password"}
        </Key>
      }
    >
      {error && <Note tone="danger">{error}</Note>}
      {success && <Note tone="success">{hasPassword ? "Password updated." : "Password added. You can now sign in either way."}</Note>}
      {hasPassword && (
        <Field label="Current password" htmlFor={`${id}-now`}>
          <Input
            id={`${id}-now`}
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.currentTarget.value)}
            required
            autoComplete="current-password"
          />
        </Field>
      )}
      <Field label={hasPassword ? "New password" : "Password"} htmlFor={`${id}-new`}>
        <Input
          id={`${id}-new`}
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.currentTarget.value)}
          required
          autoComplete="new-password"
          aria-describedby={`${id}-rule`}
        />
      </Field>
      <Note tone="quiet">
        <span id={`${id}-rule`}>At least 10 characters, with upper and lower case and a number.</span>
      </Note>
    </SettingForm>
  );
}
