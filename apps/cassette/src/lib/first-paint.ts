/**
 * The root layout's first-paint settings, said again for a page the browser draws itself (BUG-713).
 *
 * The root layout (app/layout.tsx) runs a few inline scripts before anything draws: the saved skin and the
 * light-or-dark choice go onto <html>, and the diagnostics opt-out is read. When a page throws notFound() (a
 * missing album, artist, station or guide), Next answers 404 with an empty error shell and the browser draws
 * the page itself; scripts drawn that way never run. Moving the notFound() call earlier does not help (a
 * page with no awaits at all still gets the shell), so the page that says "Nothing here." puts the same
 * settings on again once it is up (_taste/FirstPaintAgain.tsx). The iPhone app's mark has its own way back
 * (components/AppSurface.tsx).
 *
 * This mirrors the two scripts in app/layout.tsx and lib/appearance.ts's keys; change them together.
 * Pure: the browser's objects come in as arguments, so the tests need no DOM.
 */

type PaintRoot = { setAttribute(name: string, value: string): void };
type PaintStore = { getItem(key: string): string | null };
type PaintWindow = { __cassetteDiag?: { consent?: boolean } };

const THEME_KEY = "cs-theme";
const PAPER_KEY = "cs-paper";
const DIAGNOSTICS_KEY = "cs-diagnostics-consent";

/** Whether the root layout's scripts already ran on this page: its diagnostics script always leaves
 *  `window.__cassetteDiag` behind, a page drawn from an error shell has none. */
export function firstPaintRan(win: PaintWindow): boolean {
  return win.__cassetteDiag !== undefined;
}

/**
 * Put the saved settings on, as the root layout's scripts do: a skin other than Classic as data-theme, a held
 * light or dark as data-paper, and the diagnostics choice (anything but an explicit "off" is on, and a store
 * that cannot be read is on too). Does nothing when the scripts already ran. True when it applied them.
 */
export function reapplyFirstPaint(win: PaintWindow, root: PaintRoot, store: PaintStore | null): boolean {
  if (firstPaintRan(win)) return false;
  try {
    const theme = store?.getItem(THEME_KEY);
    const paper = store?.getItem(PAPER_KEY);
    if (theme && theme !== "classic") root.setAttribute("data-theme", theme);
    if (paper === "light" || paper === "dark") root.setAttribute("data-paper", paper);
  } catch {
    // storage blocked: the page stays in the default skin and the device's own light or dark
  }
  try {
    win.__cassetteDiag = { consent: store?.getItem(DIAGNOSTICS_KEY) !== "off" };
  } catch {
    win.__cassetteDiag = { consent: true };
  }
  return true;
}
