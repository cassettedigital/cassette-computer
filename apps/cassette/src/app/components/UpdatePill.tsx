"use client";

/**
 * UpdatePill — the desktop app's "an update is ready" affordance, sitting by the
 * avatar in RailAccountMenu. Deliberately NOT a silent background install: the
 * app checks the signed release feed and, when a newer build is available, shows
 * a quiet "UPDATE AVAILABLE" button. Clicking it downloads + installs the new
 * bundle and relaunches (the Rust `install_update` command verifies the minisign
 * signature before swapping anything).
 *
 * Desktop-only by construction: it talks to the Tauri shell via
 * `window.__TAURI__.core.invoke` (same bridge NavAuthIsland uses for unpair). On
 * the web there is no bridge, so it renders nothing. It also renders nothing
 * until a check actually reports a newer version, so it is invisible on the
 * common "already current" path.
 */

import { useCallback, useEffect, useState } from "react";
import styles from "./UpdatePill.module.css";
import { tell } from "@/lib/ask";

type TauriInvoke = (cmd: string) => Promise<unknown>;

function tauriInvoke(): TauriInvoke | null {
  const t = (
    globalThis as { __TAURI__?: { core?: { invoke?: TauriInvoke } } }
  ).__TAURI__;
  return t?.core?.invoke ?? null;
}

const RECHECK_MS = 30 * 60 * 1000; // re-check every 30 minutes while the app is open

/**
 * The desktop shell's update, for anything that shows it (this pill in the old rail, the desk
 * sidebar's own line): the newer version on offer, or null while the app is current and on the
 * web; whether it is installing; and the install, which restarts the app when it works.
 */
export function useDesktopUpdate() {
  const [version, setVersion] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const invoke = tauriInvoke();
    if (!invoke) return; // web / not the desktop shell — render nothing
    let alive = true;
    const check = async () => {
      try {
        const v = await invoke("check_for_update");
        if (alive && typeof v === "string" && v.length > 0) setVersion(v);
      } catch {
        // Offline / feed hiccup — stay hidden, try again on the next interval.
      }
    };
    void check();
    const id = window.setInterval(() => void check(), RECHECK_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const install = useCallback(async () => {
    const invoke = tauriInvoke();
    if (!invoke || installing) return;
    setInstalling(true);
    try {
      // Downloads, installs, and relaunches — the promise never resolves on
      // success (the app restarts). A rejection means it failed; re-enable so the
      // person can retry.
      await invoke("install_update");
      setInstalling(false);
    } catch (err) {
      setInstalling(false);
      // Said out loud: a failed install used to just put the button back (BUG-790).
      const why = typeof err === "string" ? err : err instanceof Error ? err.message : "";
      void tell(
        `The update couldn't be installed${why ? ` (${why})` : ""}. Try again from Cassette > Check for Updates.`
      );
    }
  }, [installing]);

  /** Ask now (the menu bar's Check for Updates): the newer version, or null when this is the newest.
   *  Throws when the feed couldn't be reached, so that never reads as "up to date" (BUG-790). */
  const checkNow = useCallback(async (): Promise<string | null> => {
    const invoke = tauriInvoke();
    if (!invoke) return null;
    const v = await invoke("check_for_update");
    const found = typeof v === "string" && v.length > 0 ? v : null;
    setVersion(found);
    return found;
  }, []);

  return { version, installing, install, checkNow };
}

export function UpdatePill() {
  const { version, installing, install: onClick } = useDesktopUpdate();

  if (!version) return null;

  return (
    <button
      type="button"
      className={styles.pill}
      onClick={onClick}
      disabled={installing}
      data-installing={installing ? "true" : undefined}
      title={installing ? "Updating Cassette…" : `Cassette ${version} is ready to install`}
    >
      {/* The dot and the spinner share one fixed slot and cross-fade, so the
          state change reads as one smooth motion, not a hard swap. */}
      <span className={styles.icon} aria-hidden="true">
        <span className={styles.dot} data-on={String(!installing)} />
        <span className={styles.spinner} data-on={String(installing)} />
      </span>
      {/* Both labels stack in one grid cell (sized to the wider one) and cross-fade,
          so the width never jumps and the two states never overlap mid-swap. */}
      <span className={styles.label}>
        <span className={styles.labelText} data-on={String(!installing)}>
          Update available
        </span>
        <span className={styles.labelText} data-on={String(installing)}>
          Updating…
        </span>
      </span>
    </button>
  );
}
