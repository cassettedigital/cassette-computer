"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AuthCard, type AuthLink } from "@/app/_taste/AuthCard";
import { Button, buttonClass } from "@/app/_taste/Button";
import { openOutside } from "@/lib/open-outside";

type Tauri = { core?: { invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> } };

function tauri(): Tauri | undefined {
  return typeof window === "undefined" ? undefined : (window as unknown as { __TAURI__?: Tauri }).__TAURI__;
}

function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const call = tauri()?.core?.invoke;
  if (!call) return Promise.reject(new Error("not running inside the desktop app"));
  return call<T>(cmd, args);
}

/** The Rust side's errors are written for the log; say what happened instead. */
function plainError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/timed out/i.test(msg)) return "Nothing came back from your browser. Try again.";
  if (/browser/i.test(msg)) return "Cassette couldn't open your browser. Try again.";
  if (/keychain|store the token|keyring|secret/i.test(msg)) return "Cassette couldn't save your sign-in to the keychain. Try again.";
  return "Cassette couldn't finish signing in. Try again.";
}

export function ConnectClient({ cloudBase, start }: { cloudBase: string; /** the dev-only preview's state (/proto/account-cards) */ start?: "app" | "waiting" }) {
  const [inApp, setInApp] = useState<boolean | null>(start ? true : null);
  const [waiting, setWaiting] = useState(start === "waiting");
  const [error, setError] = useState<string | null>(null);
  // The app waits half an hour for the browser; a closed tab can be opened again, and only the latest try speaks.
  const attempt = useRef(0);

  // The app is the frame here: drop the site's masthead and footer (lib/app-surface.ts).
  useEffect(() => {
    if (start) return;
    const present = !!tauri()?.core?.invoke;
    setInApp(present);
    if (present) document.documentElement.setAttribute("data-surface", "app");
  }, [start]);

  const signIn = useCallback(async () => {
    const mine = ++attempt.current;
    setWaiting(true);
    setError(null);
    try {
      // The dev server is its own cloud; a shipped app pairs against the real one.
      const base = window.location.port === "3100" ? window.location.origin : cloudBase;
      // On success the app quits and starts again signed in, so this rarely returns.
      await invoke("begin_pairing", { baseUrl: base });
    } catch (e) {
      if (mine === attempt.current) setError(plainError(e));
    } finally {
      if (mine === attempt.current) setWaiting(false);
    }
  }, [cloudBase]);

  if (inApp === false) {
    return (
      <AuthCard
        title="Open Cassette."
        line="This page signs in the Cassette app on your computer."
        keys={[
          <a key="get" href="/apps#mac" className={buttonClass("outlined")} data-give="keep">
            Get the app
          </a>,
        ]}
      />
    );
  }

  const links: AuthLink[] = [];
  if (waiting) links.push({ label: "Open the page again", onPress: () => void signIn() });
  // the seat form is on the website, so it opens in the browser; its page points a friend's link on to /invite
  links.push({ label: "Save a seat", onPress: () => openOutside(`${cloudBase}/waitlist`) });

  return (
    <AuthCard
      subject={{ device: "computer" }}
      title="Sign in to Cassette."
      line="Finish in your browser, then Cassette opens signed in."
      notice={error ? { say: error } : undefined}
      keys={[
        <Button key="go" look="filled" give="keep" onClick={signIn} disabled={waiting || inApp === null} aria-busy={waiting || undefined}>
          {waiting ? "Waiting for your browser…" : "Sign in"}
        </Button>,
      ]}
      links={links}
    />
  );
}
