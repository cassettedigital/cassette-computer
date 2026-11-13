/**
 * Desktop-only sidecar proxy.
 *
 * The macOS Cassette.app serves the UI from http://localhost:41730 — an origin
 * the local sidecar's CORS allowlist (cassette.digital + localhost:3100/3000)
 * rejects with 403. So the desktop build points the sidecar client at a relative
 * base (NEXT_PUBLIC_SIDECAR_URL=/sidecar) and every call lands here, same-origin.
 * This handler forwards to the local sidecar SERVER-SIDE: no browser Origin
 * header travels, so the sidecar's "no Origin = native/same-origin" path accepts
 * it and CORS never enters the picture. Handles every method + streams bodies so
 * rip actions and file uploads work, not just GET polling.
 *
 * Inert unless SIDECAR_PROXY_TARGET is set — only the desktop shell sets it, so
 * the hosted deployment ships this route as a no-op 404.
 */

import { type NextRequest, NextResponse } from "next/server";
import { localRequestRefusal } from "@/lib/desktop-local-guard";

export const dynamic = "force-dynamic";

async function proxy(req: NextRequest, path: string[]): Promise<Response> {
  const target = process.env.SIDECAR_PROXY_TARGET;
  if (!target) return new NextResponse("not found", { status: 404 });
  // The hub trusts anything without an Origin, and this proxy strips it, so the
  // check the hub can't make happens here (BUG-774).
  if (localRequestRefusal(req.headers)) return new NextResponse("forbidden", { status: 403 });

  const url = `${target}/${path.join("/")}${req.nextUrl.search}`;

  // Forward the request headers minus the ones that would either trip the
  // sidecar's CORS check (Origin) or misdescribe the re-issued request.
  const headers = new Headers(req.headers);
  headers.delete("origin");
  headers.delete("host");
  headers.delete("connection");
  headers.delete("content-length");

  const method = req.method;
  const init: RequestInit & { duplex?: "half" } = { method, headers, redirect: "manual" };
  if (method !== "GET" && method !== "HEAD") {
    init.body = req.body; // stream the body through (uploads, rip payloads)
    init.duplex = "half";
  }

  try {
    const upstream = await fetch(url, init);
    const respHeaders = new Headers(upstream.headers);
    respHeaders.delete("transfer-encoding");
    respHeaders.delete("connection");
    return new NextResponse(upstream.body, { status: upstream.status, headers: respHeaders });
  } catch {
    // Sidecar down / not installed — mirror its own fail-soft contract.
    return new NextResponse("sidecar unreachable", { status: 502 });
  }
}

type Ctx = { params: Promise<{ path: string[] }> };

// Next.js detects route handlers by explicit named exports — an aliased
// re-export (`export { h as GET }`) is NOT recognized, so spell each one out.
export async function GET(req: NextRequest, ctx: Ctx) { return proxy(req, (await ctx.params).path); }
export async function POST(req: NextRequest, ctx: Ctx) { return proxy(req, (await ctx.params).path); }
export async function PUT(req: NextRequest, ctx: Ctx) { return proxy(req, (await ctx.params).path); }
export async function PATCH(req: NextRequest, ctx: Ctx) { return proxy(req, (await ctx.params).path); }
export async function DELETE(req: NextRequest, ctx: Ctx) { return proxy(req, (await ctx.params).path); }
export async function OPTIONS(req: NextRequest, ctx: Ctx) { return proxy(req, (await ctx.params).path); }
export async function HEAD(req: NextRequest, ctx: Ctx) { return proxy(req, (await ctx.params).path); }
