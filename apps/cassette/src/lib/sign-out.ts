import { signOut as signOutOfSite } from "next-auth/react";

/**
 * Sign out, wherever you are (BUG-605). The one copy every account menu calls: the site's nav, the
 * masthead, the desk's rail and the old library's account menu.
 *
 * In the Mac app the session is the paired device token, which next-auth's signOut can't touch (the
 * DB-less /api/auth stub never issued it), so signing out means unpairing. First the cloud is told to
 * end that token (/api/player/sign-out, BUG-778), so a copy left on the disk stops working; offline,
 * the app still signs out here and the token stays live until the person removes it. Then
 * `clear_device_token` drops it from the keychain and restarts the app, whose local server only reads
 * the token at launch, and the app opens on its sign-in screen (/desktop/connect). An older app that
 * only clears the token comes back here, and the reload is the best it can do. Everywhere else it is
 * next-auth's signOut.
 */
export function signOut(): void {
  const tauri = (globalThis as { __TAURI__?: { core?: { invoke?: (cmd: string) => Promise<unknown> } } }).__TAURI__;
  const invoke = tauri?.core?.invoke;
  if (invoke) {
    void fetch("/api/player/sign-out", { method: "POST", signal: AbortSignal.timeout(5000) })
      .catch(() => undefined)
      .finally(() => Promise.resolve(invoke("clear_device_token")).finally(() => window.location.assign("/")));
    return;
  }
  void signOutOfSite({ callbackUrl: "/" });
}
