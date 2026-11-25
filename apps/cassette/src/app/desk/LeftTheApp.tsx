"use client";

/**
 * The safety net under the desk's link catcher (in-app-links.ts): when something inside the computer app
 * navigates in code to a website page the app doesn't carry (a menu's router.push, a redirect after an
 * account change), the app's server has no page there and draws the not-found page. Inside the app this
 * sends that address where a link to it would have gone (the desk's own screen, or the website in the
 * person's browser) and steps the window back to where it was. In a browser it does nothing: the address
 * really has no page.
 */
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { inDesktopApp, openOutside } from "@/lib/open-outside";
import { PUBLIC_SITE_URL } from "@/lib/urls";
import { DESK } from "./types";
import { inAppTarget } from "./in-app-links";

export function LeftTheApp() {
  const pathname = usePathname();
  const router = useRouter();
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!inDesktopApp() || !pathname || done.current === pathname) return;
    done.current = pathname;
    const go = inAppTarget(`${pathname}${window.location.search}`, true);
    if (!go) return;
    if (go.to === "desk") return router.replace(go.path);
    if (go.to === "station") return router.replace(`${DESK}/radio`);
    openOutside(`${PUBLIC_SITE_URL}${go.path}`);
    if (window.history.length > 1) router.back();
    else router.replace(DESK);
  }, [pathname, router]);
  return null;
}
