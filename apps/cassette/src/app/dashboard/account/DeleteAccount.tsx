"use client";

/**
 * Delete your account (BUG-884, Apple 5.1.1(v)): the quiet way to leave at the foot of Settings > Account. It
 * opens into one plain warning, a box to type DELETE in, and the key that does it (DELETE /api/user, steps in
 * lib/account-delete.ts). Then this browser signs out and lands on /goodbye.
 *
 * Inside the iPhone app's web view (Settings > Account > Delete Account opens this page with a session made from
 * the phone's sign-in) it is the same, and the phone's next call is refused, so it says it was signed out. An
 * address ending #delete opens it already open, for a way in that means to delete.
 *
 * In the desktop app the key opens the website instead (`onWebsite`): the app's own server has no session to
 * delete with, the same as the email and password keys above it.
 */

import { useEffect, useId, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { signOut as signOutOfSite } from "next-auth/react";
import { Field, Input, Key, Note } from "@discovery/cassette-kit";
import { openOutside } from "@/lib/open-outside";
import { CONFIRM_WORD, typedConfirms } from "@/lib/account-delete";
import { QuietKey, Setting, SettingForm } from "@/app/settings/_parts/parts";

export function DeleteAccount({ onWebsite }: { onWebsite?: string }) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const landing = useRef(false);

  useEffect(() => {
    if (onWebsite || window.location.hash !== "#delete") return;
    landing.current = true;
    setOpen(true);
  }, [onWebsite]);

  // Opened, it comes into view. Landed on with #delete, it stays in view while the page above it settles (the
  // sign-ins list loads after the page and pushes it down), until the person scrolls, touches or types.
  useEffect(() => {
    const el = box.current;
    if (!open || !el) return;
    if (!landing.current) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }
    landing.current = false;
    const settle = () => el.scrollIntoView({ block: "center" });
    settle();
    const watch = new ResizeObserver(settle);
    if (el.parentElement) watch.observe(el.parentElement);
    const events = ["wheel", "touchstart", "keydown"] as const;
    const stop = () => {
      watch.disconnect();
      window.clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, stop);
    };
    for (const e of events) window.addEventListener(e, stop, { passive: true });
    const timer = window.setTimeout(stop, 4000);
    return stop;
  }, [open]);

  if (onWebsite) {
    return (
      <QuietKey onClick={() => openOutside(`${onWebsite}#delete`)}>
        Delete your account
        <ArrowUpRight size={13} strokeWidth={2.25} aria-hidden="true" />
      </QuietKey>
    );
  }
  if (!open) return <QuietKey onClick={() => setOpen(true)}>Delete your account</QuietKey>;

  const ready = typedConfirms(typed) && !pending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setPending(true);
    setError("");
    try {
      const res = await fetch("/api/user", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: CONFIRM_WORD }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setPending(false);
      setError("Couldn't delete your account. Try again in a moment.");
      return;
    }
    // The account is gone: this browser's session goes too, then the page says so.
    await signOutOfSite({ redirect: false }).catch(() => undefined);
    window.location.replace("/goodbye");
  }

  function cancel() {
    setOpen(false);
    setTyped("");
    setError("");
  }

  return (
    <div ref={box}>
      <Setting
        as="div"
        name="Delete your account"
        about="This can't be undone. Your name, email and photo are erased, every computer and phone signed in to your account is signed out, and your playlists, favorites and history go with it. The music on your computer stays where it is."
      >
        <SettingForm
          onSubmit={submit}
          keys={
            <>
              <Key type="submit" tone="danger" disabled={!ready}>
                {pending ? "Deleting…" : "Delete my account"}
              </Key>
              <Key tone="plain" onClick={cancel} disabled={pending}>
                Cancel
              </Key>
              {error && (
                <Note tone="danger" as="span">
                  {error}
                </Note>
              )}
            </>
          }
        >
          <Field label={`Type ${CONFIRM_WORD} to confirm`} htmlFor={id}>
            <Input
              id={id}
              type="text"
              value={typed}
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              onChange={(e) => setTyped(e.currentTarget.value)}
            />
          </Field>
        </SettingForm>
      </Setting>
    </div>
  );
}
