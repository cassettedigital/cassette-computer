/**
 * Appearance catalog + persistence — the SINGLE source of truth for the skins
 * and app-icon variants offered in /dashboard/appearance.
 *
 * Persistence today is localStorage-only, deliberately: this is the "showcase
 * the selection + restart-to-apply-icon" slice, with zero database risk. The
 * read/write pair below is the ONE swap-point that turns this cross-device —
 * when we add `users.themeId` / `users.iconId`, `loadAppearance()` seeds from
 * the account (via GET /api/sync/account, mirroring downloadQualityTier) and
 * `saveTheme()` / `saveIcon()` also PATCH it. Nothing else in the UI changes.
 *
 * The theme id maps 1:1 to a `:root[data-theme="…"]` block in globals.css; the
 * live web swap is just stamping that attribute on <html>. The icon id is
 * stored + shown selected but applied on next launch (the desktop dock icon /
 * iOS alternate icon can't hot-swap) — hence the "Restart to see it" affordance.
 */

export type ThemeId = "classic" | "amber" | "rust" | "marine" | "lime" | "violet" | "rose";
/** App-icon options — the actual generated icon SET: the classic Signature plus
 *  the moody per-skin alts. Each is a distinct colour choice (independent of the
 *  active skin), mirroring the CassetteIcon-<id>.icon bundles the generator bakes. */
export type IconId = "classic" | "lime" | "violet" | "rose";

// No preview colours here on purpose: the picker previews each skin by scoping
// `data-theme` to the swatch/tile, so the swatch DERIVES the real accent + chassis
// from the one source of truth (globals.css). A hardcoded hex would be a snapshot
// that could drift from what the skin actually does — so there isn't one.
export type ThemeDef = {
  id: ThemeId;
  name: string;
  blurb: string;
};

export type IconDef = {
  id: IconId;
  name: string;
  blurb: string;
  /** data-theme the tile scopes to, so its colours DERIVE (via scopable skins)
   *  exactly as the generator computes them for the matching native bundle.
   *  undefined = classic. */
  theme?: ThemeId;
  bg: string;
  mark: string;
};

/** The skins on offer: none but the classic look. The site is light and dark only (the founder's D14, 2026-11-22:
 *  "We nixed the skins for now - it's just light and dark mode, at the moment"). */
export const THEMES: readonly ThemeDef[] = [
  { id: "classic", name: "Classic Orange", blurb: "The original. Warm amber deck, orange needle." },
] as const;

/**
 * The skins retired by D14 (design wave 3): hidden, never deleted (retire means hide). Never offered and never applied;
 * kept so a choice an account or a browser already holds still reads as a known id, left where it is, and the account
 * route still accepts what an older app sends. Anyone who picked one sees the default orange from their next visit,
 * with no message.
 */
export const RETIRED_SKINS: readonly ThemeDef[] = [
  { id: "amber",   name: "Amber Gold",     blurb: "A hair warmer: gold where the orange was." },
  { id: "rust",    name: "Rust",           blurb: "Deeper and redder, a well-worn faceplate." },
  { id: "marine",  name: "Marine",         blurb: "The cool one. Teal needle on the warm chassis." },
  { id: "lime",    name: "Lime",           blurb: "Jersey lime, and the whole deck turns forest to match." },
  { id: "violet",  name: "Violet",         blurb: "Electric violet on a cooled-down slate chassis." },
  { id: "rose",    name: "Rose",           blurb: "Warm rose-pink that keeps the classic warm deck." },
] as const;

// Signature = accent tile + cream mark (slot 1); the alts = each skin's moody
// slot-2 (its pivoted chassis tile + accent mark). Rendering scopes `theme` so
// var(--cs-gray-*)/var(--cs-orange) resolve to that skin's derived colours —
// the web mirror of CassetteIcon2 / CassetteIcon-<skin>.icon.
const TILE_SLOT2 = "linear-gradient(160deg, var(--cs-gray-3), var(--cs-gray-1))";
export const ICONS: readonly IconDef[] = [
  {
    id: "classic",
    name: "Signature",
    blurb: "The default: orange tile, cream mark.",
    theme: "classic",
    bg: "linear-gradient(180deg, var(--cs-accent-9), var(--cs-accent-10))",
    mark: "var(--cs-gray-12)",
  },
  { id: "lime", name: "Lime", blurb: "Forest tile, lime mark.", theme: "lime", bg: TILE_SLOT2, mark: "var(--cs-accent-9)" },
  { id: "violet", name: "Violet", blurb: "Slate tile, violet mark.", theme: "violet", bg: TILE_SLOT2, mark: "var(--cs-accent-9)" },
  { id: "rose", name: "Rose", blurb: "Charcoal tile, rose mark.", theme: "rose", bg: TILE_SLOT2, mark: "var(--cs-accent-9)" },
] as const;

export const DEFAULT_THEME: ThemeId = "classic";
export const DEFAULT_ICON: IconId = "classic";

const THEME_KEY = "cs-theme";
const ICON_KEY = "cs-icon";

const THEME_IDS = new Set<string>([...THEMES, ...RETIRED_SKINS].map((t) => t.id));
const ICON_IDS = new Set<string>(ICONS.map((i) => i.id));

/** Coerce an unknown stored value to a valid theme id (defaults to classic). */
export function coerceTheme(v: unknown): ThemeId {
  return typeof v === "string" && THEME_IDS.has(v) ? (v as ThemeId) : DEFAULT_THEME;
}
export function coerceIcon(v: unknown): IconId {
  return typeof v === "string" && ICON_IDS.has(v) ? (v as IconId) : DEFAULT_ICON;
}

/** Light or dark: the paper the pages that follow it are drawn on (the album and artist pages, the desk).
 *  `auto` follows the device and is the default; `light` or `dark` holds one, stamped on <html> as
 *  data-paper, which the pages' own CSS reads (_taste/taste.module.css, the kit's .auto and .follow).
 *  Per device on purpose, so it stays in localStorage and is not sent to the account: someone can want
 *  dark on one screen and light on another, as Apple's own setting is. */
export type PaperId = "auto" | "light" | "dark";
export const PAPERS: readonly { id: PaperId; name: string }[] = [
  { id: "auto", name: "Auto" },
  { id: "light", name: "Light" },
  { id: "dark", name: "Dark" },
] as const;
export const DEFAULT_PAPER: PaperId = "auto";
const PAPER_KEY = "cs-paper";

export function coercePaper(v: unknown): PaperId {
  return v === "light" || v === "dark" ? v : DEFAULT_PAPER;
}

/** Strict membership checks (reject invalid) — used server-side to validate the
 *  PATCH /api/account/appearance body. Safe to import in a server route: this
 *  module touches window/localStorage only inside functions, never at top level. */
export function isValidTheme(v: unknown): v is ThemeId {
  return typeof v === "string" && THEME_IDS.has(v);
}
export function isValidIcon(v: unknown): v is IconId {
  return typeof v === "string" && ICON_IDS.has(v);
}

/** Current selections from localStorage. Client-only; SSR returns defaults. */
export function loadAppearance(): { theme: ThemeId; icon: IconId } {
  if (typeof window === "undefined") {
    return { theme: DEFAULT_THEME, icon: DEFAULT_ICON };
  }
  try {
    return {
      theme: coerceTheme(window.localStorage.getItem(THEME_KEY)),
      icon: coerceIcon(window.localStorage.getItem(ICON_KEY)),
    };
  } catch {
    return { theme: DEFAULT_THEME, icon: DEFAULT_ICON };
  }
}

/** Skins are retired (D14): nothing stamps one on <html> any more, so this only clears one a page may still carry,
 *  whatever the stored choice says. The stored choice itself is left where it is. */
export function applyTheme(_theme: ThemeId): void {
  if (typeof document === "undefined") return;
  document.documentElement.removeAttribute("data-theme");
}

/** Best-effort cross-device write. localStorage + the live apply already made
 *  the change locally; this syncs it to the account so it follows you to other
 *  devices (and the phone, via GET /api/sync/account). Fire-and-forget: a failure
 *  (offline, signed-out) is fine — the local choice stands and re-syncs next time. */
function patchAccount(body: { theme_id?: ThemeId; icon_id?: IconId }): void {
  if (typeof window === "undefined") return;
  void fetch("/api/account/appearance", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  }).catch(() => {
    /* best-effort — localStorage already holds the choice locally */
  });
}

/** Persist + apply a theme (localStorage + live DOM), then sync to the account. */
export function saveTheme(theme: ThemeId): ThemeId {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode / storage disabled — the live apply below still works */
  }
  applyTheme(theme);
  patchAccount({ theme_id: theme });
  return theme;
}

/** Persist an icon choice (applied on next app launch — no live swap), then
 *  sync to the account so it follows you (native clients set the alternate icon). */
export function saveIcon(icon: IconId): IconId {
  try {
    window.localStorage.setItem(ICON_KEY, icon);
  } catch {
    /* no-op */
  }
  patchAccount({ icon_id: icon });
  return icon;
}

/** The saved light-or-dark choice. Client-only; SSR returns auto. */
export function loadPaper(): PaperId {
  if (typeof window === "undefined") return DEFAULT_PAPER;
  try {
    return coercePaper(window.localStorage.getItem(PAPER_KEY));
  } catch {
    return DEFAULT_PAPER;
  }
}

/** Stamp the paper on <html>; `auto` clears it back to the device. The iPhone app's web view keeps the
 *  dark it holds (lib/app-surface.ts) while the app is dark-only. */
export function applyPaper(paper: PaperId): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (root.dataset.surface === "app") return;
  if (paper === DEFAULT_PAPER) root.removeAttribute("data-paper");
  else root.setAttribute("data-paper", paper);
}

/** Persist + apply the light-or-dark choice on this device. */
export function savePaper(paper: PaperId): PaperId {
  try {
    window.localStorage.setItem(PAPER_KEY, paper);
  } catch {
    /* private mode / storage disabled: the live apply below still works */
  }
  applyPaper(paper);
  return paper;
}

/** On a signed-in page load, treat the ACCOUNT as the source of truth and
 *  reconcile the local cache to it — so a skin picked on another device shows up
 *  here. Only writes/applies when the account differs from what's cached, so a
 *  same-device pick (already in localStorage) is a no-op. Coerces unknown inputs. */
export function reconcileFromAccount(theme: unknown, icon: unknown): void {
  if (typeof window === "undefined") return;
  const t = coerceTheme(theme);
  const i = coerceIcon(icon);
  const current = loadAppearance();
  if (t !== current.theme) {
    try {
      window.localStorage.setItem(THEME_KEY, t);
    } catch {
      /* apply still works below */
    }
    applyTheme(t);
  }
  if (i !== current.icon) {
    try {
      window.localStorage.setItem(ICON_KEY, i);
    } catch {
      /* no-op */
    }
  }
}
