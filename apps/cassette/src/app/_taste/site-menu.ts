/**
 * The site's menu, written once (the founder, 2026-11-16): the masthead's corner menu and the account menu in
 * every app-style rail (the account window, Settings, Studio, Admin) offer the same places in the same order,
 * so wherever a person is, their face takes them anywhere and they learn the menu once. In order of how much a
 * person wants each thing, with lines between kinds and no group heads:
 *
 *   signed in    you (your account), Apps, Studio and Admin when your own door lets you in
 *   signed out   Sign in, Apps (and, on a narrow phone, the page's action, Save a seat)
 *   then         the places: Discover, Radio, Search, Journal, Guides, and the page's own links
 *   signed in    last: Feedback (the one door, components/feedback-door), Settings and Sign out
 *
 * While the session loads, the places alone. The masthead draws it with the shared menu (_taste/Menu.tsx, its
 * icons and the pill's glass); a rail draws it with the kit's own menu (railMenu below), the app's look.
 */

import type { MenuItem } from "@discovery/cassette-kit";
import { FEEDBACK, openFeedback } from "@/app/components/feedback-door";
import type { IconName } from "./Icon";

export type SiteEntry =
  | { kind: "person"; href: string; name: string }
  | {
      kind: "item";
      label: string;
      icon: IconName;
      /** A place; or an action: open the search or sign out (the menu's owner does these), or open the note box. */
      href?: string;
      action?: "search" | "signOut" | "feedback";
      /** The page you're on. */
      current?: boolean;
      /** Shown only where the page's own action has stepped out of a narrow bar (the masthead's Save a seat). */
      seat?: boolean;
    }
  | { kind: "line" };

export type SitePlace = "discover" | "radio" | "search" | "journal" | "guides" | "apps" | null;

/** Which place a path is in, for the menu's lit row (and the masthead's lifted key). */
export function sitePlaceOf(path: string): SitePlace {
  const under = (p: string) => path === p || path.startsWith(`${p}/`);
  if (under("/discover")) return "discover";
  if (under("/radio")) return "radio";
  if (under("/search")) return "search";
  if (under("/journal")) return "journal";
  if (under("/guides")) return "guides";
  if (under("/apps")) return "apps";
  return null;
}

export const APPS_PAGE = "/apps";

export function siteMenu(o: {
  who: "in" | "out" | "loading";
  /** The signed-in person's name, for their row. */
  name?: string;
  studio?: boolean;
  /** What Studio is called for this person, when their door names it otherwise (getStudioEntry's label). */
  studioLabel?: string;
  admin?: boolean;
  /** The library (/desk), offered where the menu can reach it (Admin, which also opens in the computer app). */
  library?: boolean;
  here?: SitePlace;
  /** The page's own action, for someone not yet in (the homepage's Save a seat). */
  cta?: { href: string; label: string };
  /** The page's own links, after the places. */
  links?: Array<{ href: string; label: string; icon?: IconName }>;
}): SiteEntry[] {
  const here = o.here ?? null;
  const out: SiteEntry[] = [];
  if (o.who === "in") {
    out.push({ kind: "person", href: "/account", name: o.name ?? "Your account" });
    out.push({ kind: "item", label: "Apps", icon: "devices", href: APPS_PAGE, current: here === "apps" });
    if (o.library) out.push({ kind: "item", label: "Library", icon: "book", href: "/desk" });
    if (o.studio) out.push({ kind: "item", label: o.studioLabel ?? "Studio", icon: "idea", href: "/studio" });
    if (o.admin) out.push({ kind: "item", label: "Admin", icon: "sliders", href: "/admin/pipeline" });
  } else if (o.who === "out") {
    out.push({ kind: "item", label: "Sign in", icon: "person", href: "/sign-in" });
    out.push({ kind: "item", label: "Apps", icon: "devices", href: APPS_PAGE, current: here === "apps" });
    if (o.cta) out.push({ kind: "item", label: o.cta.label, icon: "arrow", href: o.cta.href, seat: true });
  }
  if (o.who !== "loading") out.push({ kind: "line" });
  out.push(
    { kind: "item", label: "Discover", icon: "compass", href: "/discover", current: here === "discover" },
    { kind: "item", label: "Radio", icon: "radio", href: "/radio", current: here === "radio" },
    { kind: "item", label: "Search", icon: "search", action: "search", current: here === "search" },
    { kind: "item", label: "Journal", icon: "book", href: "/journal", current: here === "journal" },
    { kind: "item", label: "Guides", icon: "signpost", href: "/guides", current: here === "guides" },
  );
  for (const l of o.links ?? []) out.push({ kind: "item", label: l.label, icon: l.icon ?? "arrow", href: l.href });
  if (o.who === "in") {
    out.push(
      { kind: "line" },
      { kind: "item", label: FEEDBACK.label, icon: FEEDBACK.icon, action: "feedback" },
      { kind: "item", label: "Settings", icon: "gear", href: "/settings" },
      { kind: "item", label: "Sign out", icon: "leave", action: "signOut" },
    );
  }
  return out;
}

/**
 * The site's menu for a rail's account key, in the kit's menu (the app's own look: it opens where you click).
 * The person's row is their address over Account; Search goes to the search page; a seat row never shows (a rail
 * has no narrow bar). `go` follows a place (a rail may send some places outside the computer app).
 */
export function railMenu(entries: SiteEntry[], o: { email?: string | null; go: (href: string) => void; signOut: () => void }): MenuItem[] {
  const items: MenuItem[] = [];
  for (const e of entries) {
    if (e.kind === "line") items.push("separator");
    else if (e.kind === "person") {
      if (o.email) items.push({ caption: o.email });
      items.push({ label: "Account", onSelect: () => o.go(e.href) });
    } else if (!e.seat) {
      const pick =
        e.action === "signOut" ? o.signOut : e.action === "search" ? () => o.go("/search") : e.action === "feedback" ? openFeedback : () => o.go(e.href!);
      items.push({ label: e.label, onSelect: pick });
    }
  }
  return items;
}
