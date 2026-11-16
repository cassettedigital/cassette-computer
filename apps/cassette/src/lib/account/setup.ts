/**
 * Setup in the account window (the founder, 2026-11-09: "a 'Setup' tab for users that they land in until we know
 * they've setup their computer app and, if they visit that page on their phone, setup their phone app, too").
 * Pure, so it is tested on its own (setup.test.ts), and safe on the server and in the browser.
 *
 *   the computer   set up once one is paired to the account (user_cassette_players: the desktop app signed in
 *                  and allowed). Whether it's on right now doesn't matter here.
 *   the phone      set up once a phone of the kind this page is open on is paired (user_devices: the phone app
 *                  signed in and allowed). Asked for only on a phone whose app is out (config/release.ts), so
 *                  nobody lands on a step they can't take; until then the phone's step is there to read.
 *   done           the computer, and on a phone the phone too. Until then the window opens on Setup and the rail
 *                  shows it first; after, Setup leaves the rail and the account menu's Apps opens it.
 */

import { RELEASE, type PlatformRelease } from "../../config/release";
import type { ComputerState } from "./places";
import type { NavigatorLike } from "./get-the-app";

export type PhoneKind = "ios" | "android";

/** A phone paired to the account, as Setup names it. */
export type Phone = { kind: PhoneKind; name: string };

/** The kind of phone a browser is on, or null on a computer. An iPad asking for the desktop site says "Mac" with a touch screen. */
export function phoneKindOf(nav: NavigatorLike): PhoneKind | null {
  const ua = nav.userAgent.toLowerCase();
  if (/android/.test(ua)) return "android";
  if (/iphone|ipad|ipod/.test(ua) || (/mac/.test(ua) && (nav.maxTouchPoints ?? 0) > 1)) return "ios";
  return null;
}

/** A phone's row as the devices table keeps it: the platform the app sends, or none from the earliest iPhone builds. */
export type PhoneRow = { platform: string | null; deviceLabel: string | null };

/** The paired phones among a person's devices: corded players (the hub's "usb") aren't phones; no platform is an iPhone, as the desk reads it. */
export function phonesOf(rows: PhoneRow[]): Phone[] {
  return rows.flatMap((r) => {
    const kind: PhoneKind | null = r.platform == null || r.platform === "ios" ? "ios" : r.platform === "android" ? "android" : null;
    if (!kind) return [];
    return [{ kind, name: r.deviceLabel?.trim() || (kind === "ios" ? "iPhone" : "Android phone") }];
  });
}

/** Whether a phone's app can be had today (a release with somewhere to get it). */
export function phoneAppOut(kind: PhoneKind, release: Record<PhoneKind, PlatformRelease> = RELEASE): boolean {
  const r = release[kind];
  return r.status === "available" && !!r.downloadUrl;
}

export type SetupState = {
  computer: boolean;
  /** a phone of the kind this page is open on (any phone, on a computer) */
  phone: boolean;
  /** this page is open on a phone whose app is out, so its step counts */
  phoneAsked: boolean;
  done: boolean;
};

export function setupState(input: {
  computer: ComputerState;
  phones: Phone[];
  onPhone: PhoneKind | null;
  release?: Record<PhoneKind, PlatformRelease>;
}): SetupState {
  const computer = input.computer.kind !== "none";
  const phone = input.onPhone ? input.phones.some((p) => p.kind === input.onPhone) : input.phones.length > 0;
  const phoneAsked = !!input.onPhone && phoneAppOut(input.onPhone, input.release);
  return { computer, phone, phoneAsked, done: computer && (!phoneAsked || phone) };
}

/** Where Setup lives. */
export const SETUP_HREF = "/account/setup";
/** Where the apps are downloaded (the masthead's and the account menu's Apps): the public apps page, one address to
 *  share, with the downloads for an account and the waitlist for everyone else (the founder, 2026-11-16). */
export const APPS_HREF = "/apps";
/** Their computer and phones. */
export const DEVICES_HREF = "/account/devices";
