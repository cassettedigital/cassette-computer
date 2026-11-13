/**
 * Desktop-only cloud proxy — the token-mode "/api/*" chokepoint (Move 3).
 *
 * The shipped desktop standalone runs with a per-device bearer token and NO
 * DATABASE_URL, so its local /api/* handlers (which query Neon directly) can't
 * run. In token mode, next.config.ts installs a build-time `beforeFiles` rewrite
 *
 *     /api/:path  →  /api/cloud-proxy/:path      (isDesktop builds only)
 *
 * that funnels every cloud-bound /api call here BEFORE the local handler is
 * reached, EXCLUDING the routes that must stay local (/api/auth, /api/webhooks,
 * /api/healthz, /api/desktop, and this /api/cloud-proxy route itself). This
 * handler then re-issues the request to CASSETTE_CLOUD_BASE with `Authorization:
 * Bearer <token>` injected — one server-side chokepoint instead of ~50 per-route
 * edits, and the token never touches browser JS.
 *
 * NOTE: the folder is `cloud-proxy`, NOT `_cloud`: Next treats a leading-
 * underscore app-router segment as a private folder and excludes it from routing,
 * so the rewrite destination would 404.
 *
 * Mirrors app/sidecar/[...path]/route.ts (method + streamed body + header
 * hygiene), but the sidecar (/sidecar/*, the LOCAL hub) is not under /api and is
 * never touched by this proxy.
 *
 * Inert unless CASSETTE_PLAYER_TOKEN is set — on the hosted cloud deploy there is
 * no rewrite feeding it and no token, so a stray hit returns 404.
 */

import { type NextRequest, NextResponse } from "next/server";
import { PUBLIC_SITE_URL } from "@/lib/urls";
import { fetchCloud } from "@/lib/cloud-fetch";
import { localRequestRefusal } from "@/lib/desktop-local-guard";

export const dynamic = "force-dynamic";

const TOKEN = process.env.CASSETTE_PLAYER_TOKEN?.trim() || "";
const CLOUD_BASE =
  process.env.CASSETTE_CLOUD_BASE?.trim().replace(/\/$/, "") || PUBLIC_SITE_URL;

// Belt-and-suspenders: even if a hit reaches here, never proxy the must-stay-
// local prefixes (the rewrite already excludes them; this guards direct hits).
const NEVER_PROXY = ["auth/", "webhooks/", "healthz", "desktop/", "cloud-proxy/"];

async function proxy(req: NextRequest, path: string[]): Promise<Response> {
  // Token mode only. On the hosted cloud there is no token → this route 404s,
  // exactly like the sidecar route is a no-op without SIDECAR_PROXY_TARGET.
  if (!TOKEN) return new NextResponse("not found", { status: 404 });
  // Only the app's own window may spend the token (BUG-774): this is where a
  // website's forged POST or rebound read would otherwise pick it up.
  if (localRequestRefusal(req.headers)) return new NextResponse("forbidden", { status: 403 });

  const rest = path.join("/");
  if (NEVER_PROXY.some((p) => rest === p.replace(/\/$/, "") || rest.startsWith(p))) {
    return new NextResponse("not found", { status: 404 });
  }

  const url = `${CLOUD_BASE}/api/${rest}${req.nextUrl.search}`;

  // Forward the request headers, swapping the loopback identity for the bearer.
  const headers = new Headers(req.headers);
  headers.set("authorization", `Bearer ${TOKEN}`);
  headers.delete("host");
  headers.delete("origin");
  headers.delete("connection");
  headers.delete("content-length");
  // Ask the cloud for an unencoded body so re-streaming can't desync a
  // content-encoding header against a decoded body.
  headers.delete("accept-encoding");

  const method = req.method;
  const init: RequestInit = { method, headers, redirect: "manual" };
  if (method !== "GET" && method !== "HEAD") {
    // Buffer the request body instead of streaming it. Cloud API writes carry
    // small JSON payloads, and a buffered body avoids the duplex:"half"
    // ReadableStream request path that undici rejects here ("expected non-null
    // body source"). Large binary uploads (rips) go through /sidecar, not here.
    const buf = await req.arrayBuffer();
    if (buf.byteLength > 0) init.body = buf;
  }

  try {
    // No answer in 15 s counts as unreachable (BUG-782).
    const upstream = await fetchCloud(url, init);
    const respHeaders = new Headers(upstream.headers);
    respHeaders.delete("transfer-encoding");
    respHeaders.delete("connection");
    respHeaders.delete("content-encoding");
    respHeaders.delete("content-length");
    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });
  } catch {
    // Cloud unreachable (offline) — fail soft rather than crash the page.
    return new NextResponse("cloud unreachable", { status: 502 });
  }
}

type Ctx = { params: Promise<{ path: string[] }> };

// Next.js detects route handlers by explicit named exports — spell each out.
export async function GET(req: NextRequest, ctx: Ctx) { return proxy(req, (await ctx.params).path); }
export async function POST(req: NextRequest, ctx: Ctx) { return proxy(req, (await ctx.params).path); }
export async function PUT(req: NextRequest, ctx: Ctx) { return proxy(req, (await ctx.params).path); }
export async function PATCH(req: NextRequest, ctx: Ctx) { return proxy(req, (await ctx.params).path); }
export async function DELETE(req: NextRequest, ctx: Ctx) { return proxy(req, (await ctx.params).path); }
export async function OPTIONS(req: NextRequest, ctx: Ctx) { return proxy(req, (await ctx.params).path); }
export async function HEAD(req: NextRequest, ctx: Ctx) { return proxy(req, (await ctx.params).path); }
