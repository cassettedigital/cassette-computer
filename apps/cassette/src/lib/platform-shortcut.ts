import { useSyncExternalStore } from "react";

/**
 * Keyboard shortcut labels that match the viewer's system: "⌘K" on Apple systems, "Ctrl+K" on
 * Windows and Linux. The shortcuts themselves already answer to Ctrl everywhere; only the words
 * on screen were Mac-only. (BUG-239)
 */
export function shortcutLabel(key: string, isMac: boolean): string {
  return isMac ? `⌘${key}` : `Ctrl+${key}`;
}

const subscribe = () => () => {};

function isMacSystem(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

/**
 * Whether the viewer's system is Apple's. The server render assumes Mac, the copy these labels were
 * written with; the browser then corrects it after hydrating, so no mismatch warning is raised.
 */
export function useIsMac(): boolean {
  return useSyncExternalStore(subscribe, isMacSystem, () => true);
}
