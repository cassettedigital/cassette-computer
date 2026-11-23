/**
 * PUT /api/desktop/upload-put?to=<signed upload link>: the computer app's own server sending a picture on to
 * the storage link the cloud signed for it (lib/signed-upload).
 *
 * The stores we upload to (the uploads store, the feedback store) let in a browser on www.cassette.digital
 * and nothing else, so a PUT straight from the app's window (http://localhost:41730) is refused before it
 * starts: your own photo as your picture never saved, an artist photo's and an album cover's cloud copies
 * never landed (the copy in your folders did), and screenshots on feedback never arrived (BUG-1075). From
 * this server there is no window to refuse, so the same signed PUT goes through.
 *
 * Narrow on purpose: only on the app's own server (token mode; everywhere else 404, so the website is no
 * relay), only for the app's own window (localRequestRefusal), only to a Cloudflare storage address over
 * https, and only what the link was signed for: the cloud's signature fixes the place, the type and the size.
 */

import { type NextRequest, NextResponse } from "next/server";
import { isTokenMode } from "@/lib/player-client";
import { localRequestRefusal } from "@/lib/desktop-local-guard";
import { storageLink } from "@/lib/storage-link";

export const dynamic = "force-dynamic";

/** The largest upload any page signs for (UPLOAD_CAPS' merch design); anything bigger is no picture of ours. */
const MOST = 50 * 1024 * 1024;

export async function PUT(req: NextRequest): Promise<Response> {
  if (!isTokenMode()) return new NextResponse("not found", { status: 404 });
  if (localRequestRefusal(req.headers)) return new NextResponse("forbidden", { status: 403 });
  const url = storageLink(req.nextUrl.searchParams.get("to"));
  if (!url) return new NextResponse("not a storage link", { status: 400 });
  const body = await req.arrayBuffer();
  if (body.byteLength === 0 || body.byteLength > MOST) return new NextResponse("no picture", { status: 413 });
  const res = await fetch(url, {
    method: "PUT",
    body,
    headers: { "content-type": req.headers.get("content-type") ?? "application/octet-stream" },
  }).catch(() => null);
  return new NextResponse(null, { status: res ? res.status : 502 });
}
