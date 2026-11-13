import type { Metadata, Viewport } from "next";
import { shareCard } from "@/lib/share-card";
import type { Session } from "next-auth";
import { APP_SURFACE_SCRIPT } from "@/lib/app-surface";
import { DESKTOP_LINKS_SCRIPT, DESKTOP_SHELL_SCRIPT } from "@/lib/desktop-shell";
import { Barlow_Condensed, DM_Mono, Newsreader } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { Providers } from "./providers";
import { isTokenMode } from "@/lib/player-client";
import { loadDashboardShell } from "@/lib/desktop-session";
import { IMAGE_HOST } from "@discovery/cassette-kit/images";
import { siteUrl } from "@/lib/urls";
import { ServiceWorkerRegister } from "@/app/components/ServiceWorkerRegister";
import { ReportProblem } from "@/app/components/ReportProblem";
import { AppSurface } from "@/app/components/AppSurface";
import "./globals.css";

/**
 * Fonts loaded at build time via next/font — self-hosted, zero external requests,
 * zero render blocking. CSS variables are injected onto <html> via className.
 */
const display = Barlow_Condensed({
  weight: ["300", "400", "600", "700", "800", "900"],
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const mono = DM_Mono({
  weight: ["400", "500"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

const serif = Newsreader({
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  // Resolves relative OG/canonical URLs and silences the Next metadataBase warning.
  metadataBase: new URL(siteUrl()),
  // Every page passes a bare title and this adds the site's name, one way everywhere. A layout that sets
  // a plain string title drops the template for its pages, so a layout names itself with { default }.
  title: { default: "Cassette", template: "%s · Cassette" },
  description: "Discover music you actually want to own.",
  // The site's share picture (opengraph-image.tsx) for every page without one of its own; a page with a
  // card of its own goes through shareCard too, so it keeps the picture.
  openGraph: shareCard({ type: "website" }),
  twitter: { card: "summary_large_image" },
};

// The browser's own colours (a phone's toolbar, over-scroll) follow the paper the way the pages do: the
// light card stock or the dark paper by the device. The shells that stay dark (the old library, the
// studio, admin, the styleguide) hold dark in their own layouts.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3eadb" },
    { media: "(prefers-color-scheme: dark)", color: "#16110d" },
  ],
};

const LIGHT = "background:#f3eadb";
const UNDER_PAGE = [
  "html,body{background:#1c1913}",
  `@media (prefers-color-scheme:light){html:not([data-paper=dark]):has([data-follows]:not([data-paper=dark])),html:not([data-paper=dark]):has([data-follows]:not([data-paper=dark])) body{${LIGHT}}}`,
  `html[data-paper=light]:has([data-follows]:not([data-paper=dark])),html[data-paper=light]:has([data-follows]:not([data-paper=dark])) body{${LIGHT}}`,
  `html:has([data-follows][data-paper=light]),html:has([data-follows][data-paper=light]) body{${LIGHT}}`,
].join("");


export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Desktop token mode only: resolve the paired account's identity from the
  // device token server-side and seed SessionProvider with it, so useSession()
  // reads authed without polling the DB-less /api/auth/session stub. On the web
  // isTokenMode() is false → no fetch, and Providers renders SessionProvider
  // exactly as before (byte-identical Vercel deploy).
  const desktopMode = isTokenMode();
  let desktopSession: Session | null = null;
  if (desktopMode) {
    const shell = await loadDashboardShell();
    if (shell) {
      // The custom session fields (id/username/isAdmin/isCreator) live on the
      // packages/auth module augmentation, which isn't in this app's compilation
      // (its auth() is typed `any`), so the app sees the default Session type.
      // Cast to carry the runtime fields useSession() consumers read — this is
      // the exact shape the cloud's NextAuth session callback produces.
      desktopSession = {
        user: {
          id: shell.id,
          name: shell.name,
          email: shell.email,
          image: shell.image,
          username: shell.username,
          isAdmin: shell.isAdmin,
          isCreator: shell.isCreator,
          isBetaTester: shell.isBetaTester,
        },
        // Refetch is disabled in token mode, so this only needs to be a valid
        // future timestamp the client never re-validates.
        expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      } as Session;
    }
  }
  return (
    // the scripts below set data-theme and data-shell on <html> before React starts: expected, not a mismatch
    <html lang="en" className={`${display.variable} ${mono.variable} ${serif.variable}`} suppressHydrationWarning>
      <body>
        {/* Desktop app cold-start: the external stylesheet (globals.css, which
            sets body{background}) needs a round trip to fetch + parse before it
            can paint, and until then the webview shows ITS OWN default white —
            Tauri's own window backgroundColor fill doesn't reach the webview's
            content area. A same-value inline style tag needs no round trip, so
            it paints on the very first frame regardless. Matches the hex
            tauri.conf.json's window backgroundColor already hardcodes. Under a page whose paper
            follows the device (data-follows: PageFrame, the homepage, the desk, the essays) it is the light card
            stock when the paper is: a light device or the reader's Light in Appearance, unless the
            iPhone app's dark hold or the page's own review link holds it dark. */}
        <style dangerouslySetInnerHTML={{ __html: UNDER_PAGE }} />
        {/* Appearance/skins: apply the saved theme before first paint so there's
            no flash of the default orange. Runs synchronously during parse;
            mirrors lib/appearance.ts (localStorage key "cs-theme", validated on
            write). Any non-classic id sets data-theme; an unknown value simply
            matches no skin block and falls back to Classic — so new skins need
            no change here. The light-or-dark choice ("cs-paper", light or dark;
            Auto stores nothing to stamp) goes on as data-paper the same way, ahead
            of the iPhone app's script below, whose dark hold wins. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{var h=document.documentElement,t=localStorage.getItem("cs-theme"),p=localStorage.getItem("cs-paper");if(t&&t!=="classic")h.setAttribute("data-theme",t);if(p==="light"||p==="dark")h.setAttribute("data-paper",p);}catch(e){}',
          }}
        />
        {/* Covers land softly (the founder, 2026-11-11: "a gentle and timed fade in"): a cover marked data-lands
            (AlbumCover) stays clear over its sleeve until it has loaded, then fades in (globals.css, cs-land).
            Load events do not bubble, so one listener on the document in the capture phase hears every picture,
            those that load before React starts included, with nothing waiting on the page's code. The rule
            that hides a cover holds only once this has run (data-pics-land), so without it every cover shows. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{document.addEventListener("load",function(e){var t=e.target;if(t&&t.tagName==="IMG"&&t.hasAttribute("data-lands"))t.setAttribute("data-landed","")},true);document.documentElement.setAttribute("data-pics-land","")}catch(e){}',
          }}
        />
        {/* Inside the iPhone app (lib/app-surface): the app is the frame, so the
            site's menus and footer step aside before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: APP_SURFACE_SCRIPT }} />
        {/* Inside the Mac app (lib/desktop-shell): the window runs to its top edge. A page without a
            top of its own for that starts under this strip, which holds the window's buttons and
            moves the window. */}
        <script dangerouslySetInnerHTML={{ __html: DESKTOP_SHELL_SCRIPT }} />
        {/* Inside the desktop app: a link off the site opens in the browser, not in the window (lib/desktop-shell). */}
        <script dangerouslySetInnerHTML={{ __html: DESKTOP_LINKS_SCRIPT }} />
        <div className="cs-shell-top" data-tauri-drag-region aria-hidden="true" />
        {/* Diagnostics opt-out (Feature A). Mirrors the theme script above: runs
            synchronously during parse and reads localStorage so web-report.ts can
            suppress AUTO reports the instant an error fires — before any React
            hydration. Opt-out model → default true (key absent or storage blocked
            → always-on); an explicit "off" is the only value that disables it.
            The account toggle writes both this key (device-fast) and the DB (the
            cross-device source, read by native clients via /api/sync/account) and
            re-seeds the key from the DB value when the account page mounts. Manual
            "Report a problem" feedback ignores this flag and always sends. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'try{var c=localStorage.getItem("cs-diagnostics-consent");window.__cassetteDiag={consent:c!=="off"};}catch(e){window.__cassetteDiag={consent:true};}',
          }}
        />
        {/* Our own referrer rule, the browser's usual one, said out loud (BUG-847). Safari carries the rule of the
            page that opened a tab into it when the tab's page names none, so a tab opened from a page that sends
            no referrer (a Claude artifact's links) sent YouTube none, and YouTube refused every preview (error
            153). Said here, the YouTube player always says it is on cassette.digital. */}
        <meta name="referrer" content="strict-origin-when-cross-origin" />
        {/* Every picture comes from the image ladder's host (docs/reference/CASSETTE_IMAGES.md): open that connection early. */}
        <link rel="preconnect" href={IMAGE_HOST} />
        <link rel="dns-prefetch" href={IMAGE_HOST} />
        <Providers initialSession={desktopSession} tokenMode={desktopMode}>{children}</Providers>
        <ServiceWorkerRegister />
        <ReportProblem />
        <AppSurface />
        {/* Vercel Web Analytics is the website's. The desktop app serves its own pages and has no /_vercel/insights script, so loading it there only logs a 404 on every page. */}
        {desktopMode ? null : <Analytics />}
      </body>
    </html>
  );
}
