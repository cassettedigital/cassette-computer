import type { NextConfig } from "next";
import fs from "node:fs";
import path from "node:path";

/**
 * The player screens' build: the computer app's own server, nothing else. Cassette's website builds the same
 * screens with these same settings when it builds the app (its next.config.ts, DESKTOP_BUILD=1); this copy has
 * only that half.
 *
 * Built as a self-contained Node server (`standalone`) that the app's window starts on this computer's own
 * port. Every /api call goes to the cloud (www.cassette.digital) through /api/cloud-proxy, signed with this
 * computer's key; the music, its covers and playback come from the hub through /sidecar.
 */

// The window stamps its crash reports with the release they came from (desktop-0.5.24).
function desktopVersion(): string {
  try {
    const conf = path.resolve(process.cwd(), "../cassette-player/desktop/src-tauri/tauri.conf.json");
    return `desktop-${JSON.parse(fs.readFileSync(conf, "utf8")).version}`;
  } catch {
    return "desktop";
  }
}

// The cloud the pictures that stay on the website come from (station marks, the photographs drawn covers use).
const CLOUD = process.env.CASSETTE_CLOUD_BASE?.trim().replace(/\/$/, "") || "https://www.cassette.digital";

const nextConfig: NextConfig = {
  output: "standalone",
  // trace from the repository's root, so the shared packages come along into the standalone server
  outputFileTracingRoot: path.resolve(process.cwd(), "../../"),
  // its own folder, so a build never clobbers a running `next dev`
  distDir: process.env.DESKTOP_DISTDIR || ".next-desktop",
  // the server runs from inside the signed app: nothing may be written into it at runtime (BUG-512)
  experimental: { isrFlushToDisk: false },
  env: { NEXT_PUBLIC_APP_VERSION: desktopVersion() },
  // the player kit ships its TypeScript and CSS source
  transpilePackages: ["@discovery/cassette-kit"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "coverartarchive.org" },
      { protocol: "https", hostname: "media.cassette.digital" },
      { protocol: "https", hostname: "**.r2.dev" },
    ],
    minimumCacheTTL: 2592000,
    // re-encoded on every first view inside the app, so WebP only (AVIF encodes several times slower)
    formats: ["image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200],
  },
  // never ship source maps inside the app (BUG-1009)
  productionBrowserSourceMaps: false,
  webpack: (config) => {
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
  async rewrites() {
    return {
      // every cloud-bound /api call goes through the key-signing proxy, ahead of any local route
      beforeFiles: [{ source: "/api/:path((?!auth/|webhooks/|healthz|desktop/|cloud-proxy/).*)", destination: "/api/cloud-proxy/:path" }],
      afterFiles: [],
      // pictures that aren't ours to hand out (station marks, licensed photographs) stay on the website
      fallback: [
        { source: "/radio-art/:path*", destination: `${CLOUD}/radio-art/:path*` },
        { source: "/cover-photos/:path*", destination: `${CLOUD}/cover-photos/:path*` },
      ],
    };
  },
  async headers() {
    return [
      {
        // No other site may frame these pages, no injected <base> may redirect them, and scripts come only from
        // the app itself: this page can call the app's own commands (BUG-784, BUG-870).
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: "script-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'" }],
      },
      { source: "/cover-fonts/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
    ];
  },
};

export default nextConfig;
