/**
 * The public copy's stand-in for the website's middleware (its sign-in gate). This copy only ever runs as the
 * computer app's screens, signed in by the computer's own key (middleware.ts, token mode); started without
 * one, it says so instead of showing pages that would only fail.
 */

import { NextResponse } from "next/server";

export function webMiddleware() {
  return () =>
    new NextResponse(
      "This copy of Cassette runs inside the Cassette app. To run it on its own, set CASSETTE_PLAYER_TOKEN to this computer's sign-in key (apps/cassette-player/desktop/scripts/run-token-mode.sh).",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
}
