import "server-only";

/**
 * Who is signed in, in the paired Mac app: the account the device token belongs to, from the cloud
 * (lib/desktop-session), in the same tagged union the website's session read gives (lib/auth-helpers
 * getVerifiedSessionUser, which hands over to this in token mode). Apart from auth-helpers so the screens the
 * app draws need nothing of the website's sign-in.
 */

import { loadDashboardShell } from "@/lib/desktop-session";

export type AuthedUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  /** Default disc when image is null (silhouette / initials / color). */
  avatarPreset: string;
  emailVerified: Date | null;
  /** Account-level Appearance (skin + app icon); default "classic". Read on the
   *  dashboard shell to apply the user's skin cross-device. */
  themeId: string;
  iconId: string;
  /** Self-serve beta-stream opt-in (users.is_beta_tester) — a cohort, not a
   *  privilege. Gates early/experimental UI (see the Mixtape feature). */
  isBetaTester: boolean;
};

// ─── Server-component helpers ────────────────────────────────────────────────

export type VerifiedSessionResult =
  | { kind: "unauth" }
  /** Signed in, address not confirmed yet. `user` is there for the places that let such an account in (the
   *  account window and Settings, since 2026-11-11: sign-up lands in the account and confirms the address there). */
  | { kind: "unverified"; email: string; name: string | null; image: string | null; user: AuthedUser }
  | { kind: "ok"; user: AuthedUser };

/**
 * Token-mode resolution of the verified session: the website's read (auth-helpers getVerifiedSessionUser)
 * made from the device token (via the cloud) instead of auth() + a local DB
 * read. Same tagged union, so the dashboard gate / sidebar / home page branch
 * identically. A refused token (401/403) → "unauth", signed out; the cloud not
 * answering → the account from the copy kept on this Mac (BUG-542), so the app
 * still opens offline; offline with no copy yet → "unauth". Never a thrown 500.
 */
export async function getTokenModeSessionUser(): Promise<VerifiedSessionResult> {
  const shell = await loadDashboardShell();
  if (!shell) return { kind: "unauth" };

  const user: AuthedUser = {
    id: shell.id,
    email: shell.email,
    name: shell.name,
    image: shell.image,
    avatarPreset: shell.avatarPreset,
    emailVerified: shell.emailVerified ? new Date(shell.emailVerified) : null,
    themeId: shell.themeId,
    iconId: shell.iconId,
    isBetaTester: shell.isBetaTester,
  };
  if (!shell.emailVerified) {
    return {
      kind: "unverified",
      email: shell.email,
      name: shell.name,
      image: shell.image,
      user,
    };
  }

  return { kind: "ok", user };
}
