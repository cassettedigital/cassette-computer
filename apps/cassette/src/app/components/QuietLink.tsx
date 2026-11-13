"use client";

/**
 * The link for windows whose pages are built fresh on every visit and read the database (Admin, Studio).
 * BUG-995 and its follow-up, 2026-11-10:
 *
 *  - It is never fetched just for being on screen (prefetch={false}). That built every page in Admin's rail
 *    behind each click, and Studio's writing page six to ten times on opening it.
 *  - Resting the pointer on it, focusing it or touching it fetches only that page's frame, its loading screen
 *    (an "auto" prefetch stops at the nearest loading.tsx and reads nothing), so the click shows it at once.
 *  - A click answers straight away: the window is told which link is on its way (PendingNav), lights it in
 *    its rail and lets the page step back until the new one lands, instead of nothing moving until the next
 *    page is ready.
 *
 * Every link under app/admin and app/studio goes through this (admin/_shell/no-prefetch.test.ts).
 */

import { createContext, useContext, useEffect, useRef } from "react";
import NextLink, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import type { KitLinkProps } from "@discovery/cassette-kit";

/** Where a window hears which link is on its way (its address), and null once it has landed. */
export const PendingNav = createContext<(href: string | null) => void>(() => {});

/** The address a pending link is going to, without its query or fragment: what a rail compares against. */
export const pendingPath = (href: string | null): string | null => (href ? href.split(/[?#]/)[0] : null);

export function QuietLink({ href, children, onMouseEnter, onFocus, onTouchStart, ...rest }: KitLinkProps) {
  const router = useRouter();
  const intend = () => {
    try {
      router.prefetch(href, { kind: PrefetchKind.AUTO });
    } catch {
      // an address the router can't prefetch (another site): the click still works
    }
  };
  return (
    <NextLink
      prefetch={false}
      href={href}
      {...rest}
      onMouseEnter={(e) => {
        onMouseEnter?.(e);
        intend();
      }}
      onFocus={(e) => {
        onFocus?.(e);
        intend();
      }}
      onTouchStart={(e) => {
        onTouchStart?.(e);
        intend();
      }}
    >
      {children}
      <Pending href={href} />
    </NextLink>
  );
}

/** Inside the link, so Next's own status for this link is the one read: on its way, then landed. */
function Pending({ href }: { href: string }) {
  const { pending } = useLinkStatus();
  const tell = useContext(PendingNav);
  const was = useRef(false);
  useEffect(() => {
    if (pending) tell(href);
    else if (was.current) tell(null);
    was.current = pending;
  }, [pending, href, tell]);
  return null;
}
