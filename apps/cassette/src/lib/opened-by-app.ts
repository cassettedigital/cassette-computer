/**
 * Which Cassette app opened a sign-in, if one did (design wave 1a, the founder's D3 B, 2026-11-22).
 *
 * Every app starts its sign-in on the pairing page, /auth/player, with its own name in the address: client=
 * cassette-player (the computer app, in the person's own browser), cassette-ios (the iPhone app's sign-in sheet),
 * cassette-android (the browser tab the Android app opens). The steps that can come before Allow (sign in, the invite,
 * the email code, a forgotten password, the seat form) carry the pairing page's address along as where to go next
 * (callbackUrl), so the fact rides inside that address and each step reads it back out here. No phone build is needed
 * for any of this: both phones already send their name.
 *
 * Nothing is stored. A cookie would outlive the sheet and take the website's masthead away in the person's own browser
 * the next time they visit.
 *
 * What it decides is only how the page is framed (FocusFrame) and what the card names (the app's tile); where anyone is
 * sent still goes through signInReturn / safeNext, so a crafted address can't send anyone anywhere through this.
 */

/** The device an app runs on: the computer app, or either phone. */
export type AppDevice = "computer" | "phone";

/** The app a pairing's `client` names. */
export function appOfClient(client: unknown): AppDevice | null {
  if (client === "cassette-player") return "computer";
  if (client === "cassette-ios" || client === "cassette-android") return "phone";
  return null;
}

/** How deep an onward address may nest before it stops being read (/sign-in → /verify-email → /auth/player is two). */
const DEPTH = 4;

/**
 * The app a step's onward address leads back to: a path on this site (already through signInReturn or safeNext) that is
 * the pairing page, or a step whose own onward address is (verify-email's "sign in first" nests one inside another).
 */
export function appOfReturn(path: string | null | undefined, depth = 0): AppDevice | null {
  if (!path || !path.startsWith("/") || depth > DEPTH) return null;
  let u: URL;
  try {
    u = new URL(path, "https://cassette.invalid");
  } catch {
    return null;
  }
  if (u.origin !== "https://cassette.invalid") return null;
  if (u.pathname === "/auth/player") return appOfClient(u.searchParams.get("client"));
  return appOfReturn(u.searchParams.get("callbackUrl"), depth + 1);
}

/**
 * A link to another sign-in step that keeps the onward address, so the next step still knows what opened the flow:
 * `/forgot-password` with `?callbackUrl=` when there is somewhere to go back to. Home ("/") is not carried.
 */
export function withReturn(href: string, back: string | null | undefined): string {
  if (!back || back === "/") return href;
  return `${href}${href.includes("?") ? "&" : "?"}callbackUrl=${encodeURIComponent(back)}`;
}
