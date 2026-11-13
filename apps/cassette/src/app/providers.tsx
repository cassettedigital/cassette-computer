"use client";

/**
 * Root client providers wrapper.
 *
 * SessionProvider must wrap the entire React tree so that useSession()
 * works anywhere in the app without needing a layout-level auth() call.
 * Kept in a thin client component so layout.tsx stays a server component.
 *
 * React Aria's RouterProvider maps RA's `navigate` onto the Next App Router so
 * RA Links (and Buttons that link) navigate client-side through Next, not a
 * full page load. Wired once here — every later React Aria migration inherits
 * it. (We pass only the href to router.push; RA's router options aren't Next's.)
 */

import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";
import { useRouter } from "next/navigation";
import { RouterProvider } from "react-aria-components";
import { ToastProvider } from "./components/Toast";
import { NavProgress } from "./components/NavProgress";
import { DashboardNavOverlay } from "./components/DashboardNavOverlay";
import { RadioProvider } from "./components/radio/RadioProvider";
import { RadioDock } from "./components/radio/RadioDock";
import { FollowAccountLook } from "./components/FollowAccountLook";

export function Providers({
  children,
  initialSession = null,
  tokenMode = false,
}: {
  children: React.ReactNode;
  /** Desktop token mode only: identity seeded from the device token (or null
   *  when the token didn't resolve). Ignored on the web. */
  initialSession?: Session | null;
  /** True only on the token-authenticated desktop server (isTokenMode). */
  tokenMode?: boolean;
}) {
  const router = useRouter();
  // Token mode (desktop, no DB): seed the session from the device token and stop
  // the client from ever polling GET /api/auth/session — that route is the
  // DB-less 503 stub here, so a poll would flip useSession() to signed-out.
  // Web mode: SessionProvider EXACTLY as before (no session prop, default
  // refetch) so the Vercel deploy stays byte-identical.
  const sessionProviderProps = tokenMode
    ? { session: initialSession, refetchInterval: 0, refetchOnWindowFocus: false }
    : {};
  return (
    <SessionProvider {...sessionProviderProps}>
      {/* the account's skin on every signed-in page, not only the library */}
      <FollowAccountLook off={tokenMode} />
      <RouterProvider navigate={(href) => router.push(href)}>
        {/* Global 2px indeterminate top bar for every internal navigation. */}
        <NavProgress />
        {/* Instant full-screen dashboard skeleton when entering /dashboard. */}
        <DashboardNavOverlay />
        <ToastProvider>
          {/* The radio lane lives at the root so a station keeps playing across
              Discover, Search and Library; the dock follows it. */}
          <RadioProvider>
            {children}
            <RadioDock />
          </RadioProvider>
        </ToastProvider>
      </RouterProvider>
    </SessionProvider>
  );
}
