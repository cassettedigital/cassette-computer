/**
 * Pages the desktop app doesn't draw itself (the artist studio, a station's own website) open outside it:
 * inside the desktop app's window they go to the person's browser through Tauri's opener plugin, so the
 * window never leaves Cassette; in a browser they open in a new tab.
 */

type TauriInvoke = (cmd: string, args?: unknown) => Promise<unknown>;

const tauriInvoke = (): TauriInvoke | undefined =>
  (globalThis as { __TAURI__?: { core?: { invoke?: TauriInvoke } } }).__TAURI__?.core?.invoke;

/** True inside the desktop app's window. */
export function inDesktopApp(): boolean {
  return !!tauriInvoke();
}

/** Open a page outside the app: the desktop app hands it to the browser, a browser opens a new tab. */
export function openOutside(href: string): void {
  const invoke = tauriInvoke();
  if (invoke) void invoke("plugin:opener|open_url", { url: href });
  else window.open(href, "_blank", "noopener,noreferrer");
}
