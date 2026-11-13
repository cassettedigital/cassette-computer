"use client";

/**
 * Display-name editor. Saves via PATCH /api/account/display-name (dual-auth, so it works over both the web
 * session and the desktop device token) and says how it went beside the key. The avatar (photo or sticker)
 * lives in ProfileAvatarPicker above it.
 */

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Field, Input, Key, Note } from "@discovery/cassette-kit";
import { SettingForm } from "@/app/settings/_parts/parts";

export function DisplayNameForm({ currentName }: { currentName: string }) {
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState(currentName);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("idle");
    setError("");
    startTransition(async () => {
      // Dual-auth API (works over both the web session and the desktop device
      // token) instead of the server action, which the desktop can't proxy.
      try {
        const res = await fetch("/api/account/display-name", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.ok) {
          setStatus("saved");
          router.refresh();
        } else {
          setStatus("error");
          setError(data?.message ?? "Couldn't save.");
        }
      } catch {
        setStatus("error");
        setError("Couldn't save.");
      }
    });
  }

  return (
    <SettingForm
      onSubmit={submit}
      keys={
        <>
          <Key type="submit" tone="fill" disabled={pending || name.trim() === currentName.trim()}>
            {pending ? "Saving…" : "Save name"}
          </Key>
          {status === "saved" && <Note tone="success" as="span">Saved.</Note>}
          {status === "error" && <Note tone="danger" as="span">{error}</Note>}
        </>
      }
    >
      <Field label="Display name" htmlFor={id}>
        <Input id={id} type="text" value={name} maxLength={64} autoComplete="name" onChange={(e) => setName(e.currentTarget.value)} />
      </Field>
    </SettingForm>
  );
}
