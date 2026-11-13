/**
 * The old library's address, handed from the middleware to the dashboard layout in a request header,
 * since Next 15 gives a layout no path of its own. With it the layout sends anyone on the desk on from a
 * retired page before that page draws (BUG-644, lib/desk/access).
 */

import { NextResponse, type NextRequest } from "next/server";

/** The request header holding the /dashboard address being asked for, path and query. */
export const LIBRARY_PATH_HEADER = "x-cassette-library-path";

/**
 * Wraps a middleware so a /dashboard request it lets through carries its address to the page. Whatever
 * it stops (a sign-in redirect, a 401) goes out untouched, so what it allows and blocks is unchanged.
 * The header is always set here, so a browser can't send its own.
 */
export function withLibraryPath<R extends NextRequest>(handler: (req: R) => Response): (req: R) => Response {
  return (req) => {
    const res = handler(req);
    const { pathname, search } = req.nextUrl;
    const library = pathname === "/dashboard" || pathname.startsWith("/dashboard/");
    // a let-through is NextResponse.next(), which Next marks with this header
    if (!library || res.headers.get("x-middleware-next") !== "1") return res;
    const headers = new Headers(req.headers);
    headers.set(LIBRARY_PATH_HEADER, pathname + search);
    return NextResponse.next({ headers: res.headers, request: { headers } });
  };
}
