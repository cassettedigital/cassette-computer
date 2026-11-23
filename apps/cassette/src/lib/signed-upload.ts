/**
 * Putting a file on a signed upload link (the uploads store's or the feedback store's), from a browser or from the
 * computer app's window.
 *
 * Those stores let in a browser on www.cassette.digital only, so in the app the window's own PUT was refused
 * before it started and the picture never landed (BUG-1075). There it goes through the app's own server
 * (app/api/desktop/upload-put), which sends the same signed PUT on with no window to refuse. A browser goes
 * straight to the store, as before. An app server that doesn't have the relay yet (an older copy of these
 * pages, a local dev server) answers 404, and the window then tries the store itself.
 */

import { inDesktopApp } from "@/lib/open-outside";

/** True when the file landed. Never throws: a failed upload is the caller's to say. */
export async function putSignedUpload(link: string, body: Blob, contentType: string): Promise<boolean> {
  const direct = () => fetch(link, { method: "PUT", body, headers: { "Content-Type": contentType } });
  try {
    if (inDesktopApp()) {
      const relayed = await fetch(`/api/desktop/upload-put?to=${encodeURIComponent(link)}`, {
        method: "PUT",
        body,
        headers: { "Content-Type": contentType },
      });
      if (relayed.status !== 404) return relayed.ok;
    }
    return (await direct()).ok;
  } catch {
    return false;
  }
}
