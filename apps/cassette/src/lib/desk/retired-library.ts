/**
 * The old library's pages the desk has replaced, and where each now lives (the founder, 2026-10-22: "get
 * rid of the old library"). For anyone on the desk these dashboard pages send them to the desk instead.
 *
 * The old pages with no new home (Saved, the wishlist, mixtapes, the taste editor) are retired on the
 * website (the founder 2026-11-08, the site flow audit: hide them, don't delete them): they forward to the
 * desk, which on the website is the account's landing. Inside the desktop app, where the desk has no copy
 * of them yet, they stay where they are.
 *
 * The account's pages (account, purchases, appearance, hidden albums, imported artists) go to Settings: on
 * the website its own window at /settings, inside the desktop app the desk's copies (/desk/settings). On
 * the website every desk page is the "open the app" screen, so the music pages still point to the app
 * there, as the website never reaches it. Imported artists has no desk copy: inside the app the old address
 * stays, and says it lives on the website.
 *
 * Pure, so the map is tested on its own (retired-library.test.ts).
 */

/** Where the request is drawn: inside the desktop app (token mode), or on the website. */
export type LibraryWhere = "app" | "website";

/** Where a page goes: the same everywhere, or one place in the app and another on the website (null: it stays). */
type To = string | { app: string | null; website: string | null };

const RETIRED: Array<[RegExp, (m: RegExpMatchArray) => To]> = [
  [/^\/dashboard\/?$/, () => "/desk"],
  [/^\/dashboard\/resume\/?$/, () => "/desk"],
  [/^\/dashboard\/library\/?$/, () => "/desk/albums"],
  [/^\/dashboard\/library\/albums\/?$/, () => "/desk/albums"],
  [/^\/dashboard\/library\/artists\/?$/, () => "/desk/artists"],
  [/^\/dashboard\/library\/recently-played\/?$/, () => "/desk"],
  [/^\/dashboard\/library\/playlists\/?$/, () => "/desk/playlists"],
  [/^\/dashboard\/library\/playlists\/new\/?$/, () => "/desk/playlists"],
  [/^\/dashboard\/library\/playlists\/([0-9a-f-]{36})\/?$/i, (m) => `/desk/playlists/${m[1]}`],
  [/^\/dashboard\/devices(\/.*)?$/, () => "/desk/devices"],
  [/^\/dashboard\/account\/?$/, () => ({ app: "/desk/settings/account", website: "/settings" })],
  [/^\/dashboard\/account\/purchases\/?$/, () => ({ app: "/desk/settings/purchases", website: "/settings/purchases" })],
  [/^\/dashboard\/appearance\/?$/, () => ({ app: "/desk/settings/appearance", website: "/settings/appearance" })],
  [/^\/dashboard\/library\/hidden\/?$/, () => ({ app: "/desk/settings/hidden", website: "/settings/hidden" })],
  [/^\/dashboard\/account\/imported-artists\/?$/, () => ({ app: null, website: "/settings/imported-artists" })],
  [/^\/dashboard\/library\/favorites\/?$/, () => ({ app: null, website: "/desk" })],
  [/^\/dashboard\/shop\/wishlist\/?$/, () => ({ app: null, website: "/desk" })],
  [/^\/dashboard\/mixtapes(\/[^/]+)?\/?$/, () => ({ app: null, website: "/desk" })],
  [/^\/dashboard\/taste\/?$/, () => ({ app: null, website: "/desk" })],
];

/** Where a retired dashboard page now lives, or null when it isn't retired (for `where` it's drawn). */
export function deskPathFor(pathname: string, where: LibraryWhere = "app"): string | null {
  for (const [re, to] of RETIRED) {
    const m = pathname.match(re);
    if (!m) continue;
    const at = to(m);
    return typeof at === "string" ? at : at[where];
  }
  return null;
}
