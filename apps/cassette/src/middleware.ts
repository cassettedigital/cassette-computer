/**
 * Cassette middleware.
 *
 * Uses NextAuth + @discovery/auth's middleware factory for route protection.
 *
 * TWO shapes ship from this one file, chosen once at server start:
 *
 *  - WEB / CLOUD mode (no CASSETTE_PLAYER_TOKEN): the historical behavior,
 *    `auth(createAuthMiddleware({ rules }))`. UNCHANGED and byte-identical — the
 *    same middleware.ts is what Vercel deploys, so the cloud must keep exactly
 *    today's rules AND matcher.
 *
 *  - DESKTOP TOKEN mode (CASSETTE_PLAYER_TOKEN set — run-token-mode.sh / the
 *    shipped desktop standalone): the local server holds a per-device bearer and
 *    NO DATABASE_URL, so `auth()` is the DB-less stub (always null) and wrapping
 *    it is pointless. The token IS the identity, so this path simply skips the
 *    session gate: the gated surfaces render locally and their cloud DATA arrives
 *    over the bearer via the /api/cloud-proxy proxy (wired in next.config.ts as
 *    an isDesktop-only rewrite → app/api/cloud-proxy/[...path]/route.ts). The matcher is
 *    deliberately left UNCHANGED — broadening it here would regress the cloud
 *    (e.g. /api/follows would newly match the /api/follow rule) and a computed
 *    matcher is not honored by Next (it degrades to match-all). The /api proxy
 *    therefore lives in next.config, not in a broadened matcher here.
 *
 * Both shapes hand a let-through /dashboard request's address to the dashboard layout
 * (withLibraryPath, lib/desk/library-path-header). What they allow and block is unchanged.
 *
 * Rules (lib/web-middleware.ts, where the website's shape is made, so the paired app's copy carries none of
 * the website's sign-in):
 * - /dashboard/* → requires authentication (isCreator checked in page component)
 * - /account/* → requires authentication (the website's account window; its layout meets an unconfirmed email)
 * - /api/creator/* → requires authentication
 * - /api/upload/* → requires authentication
 * - /api/webhooks/* → allowed through (Stripe signature verified in handler)
 * - /admin/* → requires admin role
 * - /api/admin/* → requires admin role
 * - /claim/* → public (claiming is an email we receive; account made at grant)
 * - /download → public (get-the-apps index); /download/[saleId] → requires auth (purchase verification)
 * - /purchase/* → requires authentication
 * - /mixtape/* → retired (dev-only in lib/routes/visibility.ts, 2026-11-08); the maker and the feed check
 *   sign-in themselves on a dev server
 * - /api/playlist/* → requires authentication
 * - /api/library/* → requires authentication
 * - /api/taste-profile/* → requires authentication
 * - /api/follow/* → requires authentication
 * - /api/feed/* → requires authentication
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { withLibraryPath } from "@/lib/desk/library-path-header";
import { localRequestRefusal } from "@/lib/desktop-local-guard";
import { webMiddleware } from "@/lib/web-middleware";

// Presence of a per-device bearer (set at RUNTIME by run-token-mode.sh / the
// shipped shell — read here at module load, i.e. server start) flips this
// server into a token-authenticated desktop client with no local database.
const IS_TOKEN_MODE = !!process.env.CASSETTE_PLAYER_TOKEN?.trim();

export default IS_TOKEN_MODE
  ? // Token IS the identity: skip the (stubbed) session gate on every matched
    // surface. Cloud data for these routes arrives via the /api/cloud-proxy
    // (next.config.ts rewrite). Never calls auth() — it is the DB-less stub here.
    // A rebinding site's Host is refused here (BUG-774). Host only: the splash
    // hands off to the first page from tauri://, a cross-site navigation. The
    // origin checks live in the two proxies, where every write lands.
    withLibraryPath(function tokenModeMiddleware(req: NextRequest) {
      if (localRequestRefusal(req.headers, { checkOrigin: false })) {
        return new NextResponse("forbidden", { status: 403 });
      }
      return NextResponse.next();
    })
  : webMiddleware();

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/settings/:path*",
    "/account/:path*",
    "/api/creator/:path*",
    "/api/upload/:path*",
    "/api/playlist/:path*",
    "/api/library/:path*",
    "/api/taste-profile/:path*",
    "/api/follow/:path*",
    "/api/feed/:path*",
    "/api/webhooks/:path*",
    "/admin/:path*",
    "/api/admin/:path*",
    "/download/:path+",
    "/purchase/:path*",
    "/api/user/:path*",
  ],
};
