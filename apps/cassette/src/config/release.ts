/**
 * release — single source of truth for app-release metadata (versions, sizes,
 * requirements, download/TestFlight links, platform list) consumed by
 * PlayerSetupPane, the setup guides, and the future public /download page.
 *
 * Why this exists: versions/URLs were previously hardcoded per surface, which is
 * exactly what produced the dead `/download` links. One source, every surface
 * reads it; a version bump or a new TestFlight build updates all at once.
 *
 * Every platform that's out points `downloadUrl` at the signed-in download route
 * (api/desktop/download), which sends the person on to the file or, for the
 * iPhone, to TestFlight. Surfaces MUST render a coming-soon / disabled state
 * when `downloadUrl` is null, never a dead link. `setupGuide`
 * points at a real internal /guides/* route and is always safe to link.
 *
 * When distribution lands: set `downloadUrl`, flip `status` to "available", and
 * fill `version` / `sizeLabel`. Nothing else changes.
 */

export type Platform = "macos" | "ios" | "android" | "windows" | "linux";

export type PlatformStatus = "available" | "coming_soon";

export interface PlatformRelease {
  platform: Platform;
  label: string;
  status: PlatformStatus;
  version: string | null;
  sizeLabel: string | null;
  requirement: string | null;
  /** null until distribution lands — render coming-soon, never a dead link. */
  downloadUrl: string | null;
  /** internal /guides/* route; always safe to link even pre-distribution. */
  setupGuide: string | null;
  /** One plain line said under the download keys on /apps, when a build needs one (an early, unsigned build). */
  note?: string;
}

export const RELEASE: Record<Platform, PlatformRelease> = {
  macos: {
    platform: "macos",
    label: "macOS",
    status: "available",
    version: "0.5.49", // the release whose disk image /api/desktop/download serves; bump with each published DMG
    sizeLabel: null, // filled from the published disk image
    // Apple silicon only (only darwin-aarch64 is built); 13.5 is the bundled Node 24's floor.
    requirement: "Apple silicon · macOS 13.5 or later",
    // Signed-in only; redirects to the latest notarized disk image (scripts/publish-desktop-release.mts --dmg).
    downloadUrl: "/api/desktop/download/darwin/aarch64",
    setupGuide: "/guides/cassette-player-setup",
  },
  ios: {
    platform: "ios",
    label: "iOS",
    status: "available", // TestFlight Public beta open since 2026-11-20 (0.1.0 build 7 approved)
    version: "0.1.0",
    sizeLabel: null,
    requirement: "iPhone · iOS 26 or later", // the app target's IPHONEOS_DEPLOYMENT_TARGET (Amperfy.xcodeproj), checked 2026-11-20
    // Signed-in only, like the others; the route sends them on to the TestFlight public link, which lives only there.
    downloadUrl: "/api/desktop/download/ios/testflight",
    setupGuide: "/guides/cassette-player-ios",
  },
  android: {
    platform: "android",
    label: "Android",
    status: "available",
    version: "0.1.114", // the APK scripts/publish-android-download.mts placed; a download only, no update feed yet
    sizeLabel: null,
    requirement: "Android 7 or later", // the app's minSdk 24
    downloadUrl: "/api/desktop/download/android/universal",
    setupGuide: null, // its help article is /help/your-android
  },
  windows: {
    platform: "windows",
    label: "Windows",
    status: "available",
    version: "0.5.49", // the signed installer publish-desktop-release.mts --target windows placed; it is also the update
    sizeLabel: null,
    requirement: "Windows 10 or 11, 64-bit",
    // Signed-in only, like macOS; redirects to the installer in the private desktop bucket.
    downloadUrl: "/api/desktop/download/windows/x86_64",
    setupGuide: null, // the Windows guide, once it's written
    // Signed from 0.5.48 (Microsoft Artifact Signing), but Windows keeps warning about a new publisher until enough
    // people have installed it cleanly, a few weeks. Drop this line once a fresh download opens without the warning.
    note: "The Windows app is new, so Windows may warn the first time you open it: choose More info, then Run anyway.",
  },
  linux: {
    platform: "linux",
    label: "Linux",
    status: "coming_soon",
    version: null,
    sizeLabel: null,
    requirement: null,
    downloadUrl: null,
    setupGuide: null,
  },
};

/** The two platforms the pane leads with (active targets). */
export const PRIMARY_PLATFORMS: Platform[] = ["macos", "ios"];

/** Display-only, always disabled — no functional target. */
export const COMING_SOON_PLATFORMS: Platform[] = ["android", "linux"];

/** True once there's a real installable build for at least one primary platform. */
export function anyPlatformInstallable(): boolean {
  return PRIMARY_PLATFORMS.some((p) => RELEASE[p].downloadUrl != null);
}
