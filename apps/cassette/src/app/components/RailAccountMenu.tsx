"use client";

/**
 * RailAccountMenu — the ONE account pane at the base of every workspace rail
 * (library + studio + admin, and any rail we add later). Just the avatar as a
 * plain icon button — no name, no bar/backplate, nothing that reads as a rail
 * row — opening a pop-up that carries the account links AND the cross-nav
 * between workspaces, so every rail shares one identity console instead of
 * each hand-rolling its own.
 *
 * `context` decides which workspace jumps show: every jump except the one
 * matching your current context appears (so library shows Studio/Admin,
 * admin shows Library/Studio, etc). Studio shows for anyone with a room in it
 * (an artist, a writer) and every site admin. Everything else (Account / Appearance / Purchases / Sign out) is
 * the same everywhere.
 *
 * The desk (/desk, the desktop library, beta) is a fourth context. It has
 * retired the old library for the people on it (lib/desk/retired-library), so
 * from the desk there's no library jump; the other rails offer "New library"
 * when `desk` is on.
 * `compact` drops the footer's own padding and anchors the menu to the avatar's
 * left edge, for a rail that lays the avatar out in a row of its own.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signOut } from "@/lib/sign-out";
import { AppWindow, ChevronRight, Library, Shield, Store } from "lucide-react";
import { AvatarDisc } from "@/app/components/AvatarDisc";
import { UpdatePill } from "@/app/components/UpdatePill";
import { inDesktopApp, openOutside } from "@/lib/open-outside";
import { PUBLIC_SITE_URL } from "@/lib/urls";
import styles from "./RailAccountMenu.module.css";

export type RailAccountUser = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  avatarPreset?: string | null;
};

/** `web`: a place only the website draws (the artist studio), so the desktop app opens it in the browser. */
type Jump = { href: string; label: string; icon: React.ReactNode; web?: boolean };

export function RailAccountMenu({
  user,
  context,
  isCreator = false,
  studioLabel = "Studio",
  isAdmin = false,
  desk = false,
  compact = false,
}: {
  user: RailAccountUser;
  /** Which workspace this rail belongs to — hides that workspace's own jump. */
  context: "library" | "studio" | "admin" | "desk";
  /** Anyone with a Studio room can jump to it (from any other context). */
  isCreator?: boolean;
  /** What the jump is called: "Studio" for everyone. */
  studioLabel?: string;
  isAdmin?: boolean;
  /** The new desk library is open to this person (beta, or a local dev server). */
  desk?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const username = user.name?.trim() || user.email?.split("@")[0] || "Account";

  // Click-away + Escape dismiss — a plain div popover (not the Aria Menu kit),
  // so it doesn't get this for free the way overflow menus elsewhere do.
  // Checked against the button + menu specifically, NOT a wrapper around both
  // (.footer has its own padding around the avatar for visual breathing room —
  // a wrapper ref would make that padding "inside" too, so a click on the
  // clearly-empty space right next to the avatar would never count as outside).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // the desk keeps its own copies of the account pages inside its window; everywhere else they are the
  // website's Settings (/settings), outside the old library
  const settings =
    context === "desk"
      ? { account: "/desk/settings/account", appearance: "/desk/settings/appearance", purchases: "/desk/settings/purchases" }
      : { account: "/settings", appearance: "/settings/appearance", purchases: "/settings/purchases" };

  // Canvases, not actions — name the place, drop the verb.
  const jumps: Jump[] = [];
  if (context !== "desk" && desk) {
    jumps.push({ href: "/desk", label: "New library", icon: <AppWindow size={14} strokeWidth={1.75} /> });
  }
  // the desk has retired the old library for the people on it, so it offers no way back there
  if (context !== "library" && context !== "desk") {
    jumps.push({ href: "/desk", label: "Library", icon: <Library size={14} strokeWidth={1.75} /> });
  }
  if (context !== "studio" && isCreator) {
    jumps.push({ href: "/studio", label: studioLabel, icon: <Store size={14} strokeWidth={1.75} />, web: true });
  }
  if (context !== "admin" && isAdmin) {
    jumps.push({ href: "/admin/pipeline", label: "Admin", icon: <Shield size={14} strokeWidth={1.75} /> });
  }

  return (
    <div className={compact ? `${styles.footer} ${styles.compact}` : styles.footer}>
      {open && (
        <div className={styles.menu} ref={menuRef}>
          {user.email && <div className={styles.email}>{user.email}</div>}
          {jumps.map((j) => (
            <Link
              key={j.href}
              href={j.href}
              onClick={(e) => {
                setOpen(false);
                if (j.web && inDesktopApp()) {
                  e.preventDefault();
                  openOutside(`${PUBLIC_SITE_URL}${j.href}`);
                }
              }}
              className={styles.jump}
            >
              <span className={styles.jumpIcon}>{j.icon}</span>
              <span className={styles.jumpLabel}>{j.label}</span>
              <ChevronRight size={14} className={styles.jumpGo} aria-hidden="true" />
            </Link>
          ))}
          {jumps.length > 0 && <div className={styles.divider} />}
          <Link href={settings.account} onClick={() => setOpen(false)} className={styles.item}>
            Account
          </Link>
          <Link href={settings.appearance} onClick={() => setOpen(false)} className={styles.item}>
            Appearance
          </Link>
          <Link href={settings.purchases} onClick={() => setOpen(false)} className={styles.item}>
            Purchases
          </Link>
          {/* a member's three links (BUG-957). The page is the website's own: the desktop app has no database to
              make them, so there it opens in the browser, which asks them to sign in if it hasn't been */}
          <Link
            href="/account/invites"
            onClick={(e) => {
              setOpen(false);
              if (inDesktopApp()) {
                e.preventDefault();
                openOutside(`${PUBLIC_SITE_URL}/account/invites`);
              }
            }}
            className={styles.item}
          >
            Invite friends
          </Link>
          <button type="button" onClick={() => signOut()} className={styles.item}>
            Sign out
          </button>
        </div>
      )}
      <div className={styles.footerRow}>
        <button
          type="button"
          ref={buttonRef}
          onClick={() => setOpen((o) => !o)}
          className={styles.account}
          aria-label={`Account menu for ${username}`}
        >
          <AvatarDisc
            image={user.image}
            preset={user.avatarPreset}
            name={user.name}
            email={user.email}
            size={40}
          />
        </button>
        {/* Desktop-only: renders nothing on web / until an update is available.
            Sits in the avatar's row, to its right. */}
        <UpdatePill />
      </div>
    </div>
  );
}
