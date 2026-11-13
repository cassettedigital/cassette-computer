"use client";

/**
 * Dashboard left rail — a single scrolling column of identically-shaped rows.
 * Hierarchy from three type treatments (meta / destination / entry) and the
 * two-tier ink rule (ink2 → ink hover → orange selected). Annotations sit in
 * the trailing slot and do not change on hover. Section headers are real
 * destinations (no collapse) and sit flush left (no lead slot). Owned entries
 * earn their lead slot: playlists show a cover thumb, devices a StatusDot.
 * Device hardware glyphs stay gone.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Bookmark, ChevronDown, Compass, Disc3, EyeOff, House, ListMusic, Save, Users } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import { NavRailItem } from "@/app/components/NavRailItem";
import { StatusDot } from "@/app/components/StatusDot";
import { toneForLight } from "@/lib/device-status";
import { RailAccountMenu } from "@/app/components/RailAccountMenu";
import { isPresetCover } from "@/data/playlist-cover-presets";
import { Picture } from "@discovery/cassette-kit/picture";
import { picture } from "@/lib/images/picture";
import { useShell } from "./shell-context";
import { RailDiscSlot } from "./RailDiscSlot";
import styles from "./Sidebar.module.css";

export type SidebarCounts = {
  albums?: number;
  artists?: number;
  playlists?: number;
  devices?: number;
};
export type SidebarUser = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  avatarPreset?: string | null;
};
export type SidebarPlaylist = { id: string; name: string; coverImageUrl?: string | null };
export type SidebarDevice = {
  id: string;
  label: string;
  href: string;
  status: string;
  online: boolean;
  /** Connectivity lamp: live → reachable, idle → syncing, offline → offline. */
  light: "live" | "idle" | "offline";
  /** Hub carries a tiny inline "hub" tag beside its name + the disc slot. */
  isHub?: boolean;
  /** @deprecated kept for callers; icons no longer render on device rows. */
  kind: "laptop" | "desktop" | "phone";
};

const PLAYLIST_CAP = 8;

/** 16px playlist cover thumb for the rail's lead slot. Falls back to a quiet
 *  well with a list glyph so lead-less playlists keep the column rhythm. */
function PlaylistThumb({ url, name }: { url?: string | null; name: string }) {
  if (url) {
    // a 16px thumb, at the image ladder's smallest size when the cover is on it
    return (
      <Picture
        {...picture(url, "playlist")}
        frame={16}
        className={`${styles.plThumb}${isPresetCover(url) ? " cs-cover-skin" : ""}`}
        alt=""
        aria-hidden="true"
        title={name}
      />
    );
  }
  return (
    <span className={styles.plThumbEmpty} aria-hidden="true">
      <ListMusic size={10} strokeWidth={1.75} />
    </span>
  );
}

// Device-row dress (founder pass 2026-08-13): resting lamps read as clutter,
// so the StatusDot moved to the trailing slot and reveals on row hover only.
// The hub mark is a tiny inline tag beside the name (the old right-edge "HUB"
// annotation read as messy), with a plain-English tooltip saying what it means.

/** Droppable wrapper for playlist rows — flash + drag-over stay on the organism. */
function DropRow({
  dropId,
  flashing,
  children,
}: {
  dropId: string;
  flashing?: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `nav:${dropId}` });
  return (
    <div
      ref={setNodeRef}
      className={styles.dropWrap}
      style={
        isOver
          ? {
              background: "var(--cs-dragover-bg)",
              boxShadow: "inset 0 0 0 1.5px var(--cs-border-accent)",
            }
          : flashing
            ? {
                background: "color-mix(in srgb, var(--cs-orange) 25%, transparent)",
              }
            : undefined
      }
    >
      {children}
    </div>
  );
}

export function Sidebar({
  playlists = [],
  playlistTotal,
  devices = [],
  user = {},
  hasHidden = false,
  wishlistCount = 0,
  isCreator = false,
  studioLabel,
  isAdmin = false,
}: {
  counts?: SidebarCounts;
  playlists?: SidebarPlaylist[];
  /** True total playlist count (may exceed the fetched list). */
  playlistTotal?: number;
  devices?: SidebarDevice[];
  user?: SidebarUser;
  hasHidden?: boolean;
  /** Wishlist line count. The row (the whole Shop zone) shows only when > 0. */
  wishlistCount?: number;
  /** Anyone with a Studio room → the account pane offers Studio. */
  isCreator?: boolean;
  /** What it's called there ("Studio" for everyone). */
  studioLabel?: string;
  /** Admin → the account pane shows the "Admin" jump. */
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  const { flashPlaylistId, isBetaTester } = useShell();

  // Devices fold — collapsed by default. Most people manage at the section
  // level (the Devices page); the per-device rows are a peek, not the resting
  // state. The choice sticks per browser once someone opens it.
  const [devicesOpen, setDevicesOpen] = useState(false);
  useEffect(() => {
    try {
      setDevicesOpen(localStorage.getItem("cs-sidebar-devices-open") === "1");
    } catch {
      /* private mode */
    }
  }, []);
  const toggleDevices = () =>
    setDevicesOpen((o) => {
      const next = !o;
      try {
        localStorage.setItem("cs-sidebar-devices-open", next ? "1" : "0");
      } catch {
        /* best-effort */
      }
      return next;
    });

  // Selection hand-off: accent bar + orange ink lag the route by ~200ms so the
  // previous row can clear before the new one lights.
  //
  // Nothing is lit until the first client commit, on purpose (BUG-342). The rail
  // streams in behind Suspense and can hydrate AFTER a client redirect has
  // already moved the router: the desktop always cold-starts that way
  // (/dashboard/resume, then the library). The streamed HTML was drawn for the
  // redirect page with no row lit, while seeding from usePathname() made the
  // first client render light Home. React does not patch attribute mismatches
  // in production, so the DOM kept the unlit row until the next real
  // navigation, and clicking Home on Home is a same-URL navigation that never
  // changes the props. Server and first client render now agree (nothing lit,
  // no aria-current); the mount effect lights the current row at once, and
  // only route changes take the hand-off lag.
  const [hydrated, setHydrated] = useState(false);
  const [litHref, setLitHref] = useState<string | null>(null);
  const litRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  useEffect(() => {
    litRef.current = litHref;
  }, [litHref]);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      setHydrated(true);
      setLitHref(pathname);
      return;
    }
    if (pathname === litRef.current) return;
    setLitHref(null);
    const t = setTimeout(() => setLitHref(pathname), 120);
    return () => clearTimeout(t);
  }, [pathname]);

  const selected = (href: string) => litHref === href;
  const current = (href: string) => hydrated && pathname === href;

  // Group headers own their href — a child must not also light on the same path.
  const GROUP_HEADER_HREFS = new Set([
    "/dashboard/library",
    "/dashboard/library/playlists",
    "/dashboard/devices",
  ]);
  const childSelected = (href: string) => selected(href) && !GROUP_HEADER_HREFS.has(href);
  const childCurrent = (href: string) => current(href) && !GROUP_HEADER_HREFS.has(href);

  const totalPlaylists = playlistTotal ?? playlists.length;
  const shownPlaylists = playlists.slice(0, PLAYLIST_CAP);
  const showSeeAll = totalPlaylists > PLAYLIST_CAP;

  return (
    <aside className={styles.rail}>
      <nav className={styles.nav} aria-label="Library">
        <NavRailItem
          treatment="destination"
          href="/discover"
          label="Discover"
          icon={<Compass strokeWidth={1.75} />}
          selected={selected("/discover")}
          current={current("/discover")}
        />

        {/* Shop zone (store, not library) — progressive disclosure: the Wishlist
            appears only once it holds something. Cart joins it under a "Shop"
            header in the checkout pass. */}
        {wishlistCount > 0 ? (
          <NavRailItem
            treatment="destination"
            href="/dashboard/shop/wishlist"
            label="Wishlist"
            icon={<Bookmark strokeWidth={1.75} />}
            count={wishlistCount}
            selected={selected("/dashboard/shop/wishlist")}
            current={current("/dashboard/shop/wishlist")}
          />
        ) : null}

        <div className={styles.section}>
          <NavRailItem
            treatment="destination"
            href="/dashboard/library"
            label="Home"
            icon={<House strokeWidth={1.75} />}
            selected={selected("/dashboard/library")}
            current={current("/dashboard/library")}
          />
          <NavRailItem
            treatment="destination"
            href="/dashboard/library/albums"
            label="Albums"
            icon={<Disc3 strokeWidth={1.75} />}
            selected={childSelected("/dashboard/library/albums")}
            current={childCurrent("/dashboard/library/albums")}
          />
          <NavRailItem
            treatment="destination"
            href="/dashboard/library/artists"
            label="Artists"
            icon={<Users strokeWidth={1.75} />}
            selected={childSelected("/dashboard/library/artists")}
            current={childCurrent("/dashboard/library/artists")}
          />
          {hasHidden ? (
            <NavRailItem
              treatment="destination"
              href="/dashboard/library/hidden"
              label="Hidden"
              icon={<EyeOff strokeWidth={1.75} />}
              selected={childSelected("/dashboard/library/hidden")}
              current={childCurrent("/dashboard/library/hidden")}
            />
          ) : null}
        </div>

        <div className={styles.section}>
          <NavRailItem
            treatment="destination"
            href="/dashboard/library/playlists"
            label="Playlists"
            selected={selected("/dashboard/library/playlists")}
            current={current("/dashboard/library/playlists")}
          />
          <NavRailItem
            treatment="entry"
            href="/dashboard/library/favorites"
            label="Saved"
            icon={<Save size={12} strokeWidth={1.75} />}
            selected={childSelected("/dashboard/library/favorites")}
            current={childCurrent("/dashboard/library/favorites")}
          />
          {shownPlaylists.map((p) => {
            const href = `/dashboard/library/playlists/${p.id}`;
            return (
              <DropRow key={p.id} dropId={p.id} flashing={flashPlaylistId === p.id}>
                <NavRailItem
                  treatment="entry"
                  href={href}
                  label={p.name}
                  leading={<PlaylistThumb url={p.coverImageUrl} name={p.name} />}
                  selected={childSelected(href)}
                  current={childCurrent(href)}
                />
              </DropRow>
            );
          })}
          {showSeeAll ? (
            <NavRailItem
              treatment="meta"
              href="/dashboard/library/playlists"
              label={`See all ${totalPlaylists}`}
              selected={false}
              current={false}
            />
          ) : null}
          <NavRailItem
            treatment="meta"
            href="/dashboard/library/playlists/new"
            label="+ New playlist"
            selected={childSelected("/dashboard/library/playlists/new")}
            current={childCurrent("/dashboard/library/playlists/new")}
          />
        </div>

        <div className={styles.section}>
          {/* Header navigates to the Devices page (the "manage at a higher
              level" surface); the chevron folds the per-device rows, which stay
              collapsed by default. No fold when there's nothing to hide. */}
          <div className={styles.foldHead}>
            <NavRailItem
              treatment="destination"
              href="/dashboard/devices"
              label="Devices"
              className={styles.foldHeadLink}
              selected={selected("/dashboard/devices")}
              current={current("/dashboard/devices")}
            />
            {devices.length > 0 ? (
              <button
                type="button"
                className={styles.foldToggle}
                aria-expanded={devicesOpen}
                aria-label={devicesOpen ? "Hide devices" : "Show devices"}
                onClick={toggleDevices}
              >
                <ChevronDown
                  size={13}
                  strokeWidth={2}
                  className={`${styles.foldChev} ${devicesOpen ? styles.foldChevOpen : ""}`}
                />
              </button>
            ) : null}
          </div>
          {devices.length === 0 ? (
            <NavRailItem
              treatment="meta"
              href="/help/getting-the-apps"
              label="+ Set up a device"
              selected={childSelected("/help/getting-the-apps")}
              current={childCurrent("/help/getting-the-apps")}
            />
          ) : devicesOpen ? (
            devices.map((d) => (
              <div key={d.id} className={styles.deviceGroup}>
                <NavRailItem
                  treatment="entry"
                  href={d.href}
                  label={d.label}
                  className={styles.deviceRow}
                  affix={
                    d.isHub ? (
                      <span
                        className={styles.hubTag}
                        title="Your library lives on this Mac. Your other devices fill from it."
                      >
                        hub
                      </span>
                    ) : undefined
                  }
                  trailing={
                    <span className={styles.rowLamp}>
                      <StatusDot
                        tone={toneForLight(d.light)}
                        label={d.status}
                        showLabel={false}
                        size="sm"
                      />
                    </span>
                  }
                  selected={childSelected(d.href)}
                  current={childCurrent(d.href)}
                />
                {/* The disc rides under the hub: see a seated CD and rip it
                    without leaving the rail. Mounted only while the fold is
                    open, so the sidecar poll doesn't run app-wide. */}
                {d.isHub ? <RailDiscSlot /> : null}
              </div>
            ))
          ) : null}
        </div>
      </nav>

      <div className={styles.spacer} />

      <RailAccountMenu
        context="library"
        user={user}
        isCreator={isCreator}
        studioLabel={studioLabel}
        isAdmin={isAdmin}
        // the new desk library: beta, or anyone on a local dev server (app/desk/session.ts)
        desk={isBetaTester || process.env.NODE_ENV !== "production"}
      />
    </aside>
  );
}
