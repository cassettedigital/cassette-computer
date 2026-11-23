/**
 * A signed upload link to one of our stores, as the computer app's upload relay takes it
 * (app/api/desktop/upload-put): Cloudflare's storage address, over https. Anything else is not ours to send on.
 */
export function storageLink(to: string | null): URL | null {
  if (!to) return null;
  try {
    const url = new URL(to);
    return url.protocol === "https:" && url.hostname.endsWith(".r2.cloudflarestorage.com") ? url : null;
  } catch {
    return null;
  }
}
