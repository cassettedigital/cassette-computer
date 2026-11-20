
/**
 * Where to buy the record, as one list for the one Buy button (BuyMenu.tsx). The founder (2026-10-21):
 * "one dropdown that gets better as we offer more and more experiences ... surface prices when we can,
 * pick optimally on behalf of our users, but also follow their buying habits ... physical and digital".
 *
 *   - Physical: Barnes & Noble (new, studio albums and compilations only: a webcast or a B-side single is
 *     not on a bookshop's shelf), eBay (used, anything a person can own), Amazon when its program is on.
 *     None of them has a price we can read, so the row says where you will see one.
 *   - Digital: Cassette Direct when the artist sells it here (its own price); the artist's own Bandcamp
 *     page when they have one that still opens (founder, 2026-11-12: "if they have an active bandcamp, let's
 *     post that under the buy dropdown"), a link to their page, not to this record, so no price; and Apple's download when
 *     Apple's public lookup finds this exact record (its price, asked for when a person points at Buy,
 *     never while the page renders: api/album/[slug]/apple). Apple's lookup is the one the providers layer
 *     already names as a digital buy option (lib/providers/itunes.ts).
 *
 * The pick, before a person has bought anything: Cassette Direct (the artist's own store), else Barnes &
 * Noble (the founder's store to lead with, 2026-09-16), else Apple when it has a price, else eBay. Once
 * a person picks a store, the menu remembers it (in their browser) and leads with it on every record.
 * No webcast or broadcast gets a store at all.
 */

import type { RecordKind } from "@/app/(taste)/_kit/types";
import { buyPick, storesFor } from "./shape";
import type { BuyOption } from "./types";

type StoreLink = { key: string; label: string; href: string };

const money = (amount: number, currency: string) => {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
};

/**
 * Every store the page knows without asking anyone. Apple's row is not here: the page never waits on
 * Apple. `apple` says whether the menu should ask for it (/api/album/[slug]/apple) once a person points
 * at Buy. A Cassette Direct sale is the artist's own checkout (/api/creator/checkout), started by the menu;
 * its link is the sign-in page for someone signed out, and the menu stops it for someone signed in.
 */
/** The person's own store (the one they picked last in BuyMenu), kept as a cookie too, so a page drawn per request
 *  (Discover) draws the Buy button with it from the first frame and the button never changes its words, and so its
 *  width, once the page is up. Here, not in BuyMenu.tsx, so a server page can read the name. */
export const BUY_STORE_COOKIE = "taste-buy-store";

export function buyOptions(opts: {
  slug: string;
  kind: RecordKind;
  title: string;
  physical: StoreLink[];
  direct: { productId: string; minimumPrice: number; currency: string | null } | null;
  hideAmazon: boolean;
  /** The artist's own Bandcamp page (lib/artist-own-links.ts), when they have one that still opens. */
  bandcamp?: string | null;
}): { options: BuyOption[]; pick: string | null; apple: boolean } {
  const can = storesFor(opts.kind, opts.title);
  if (!can) return { options: [], pick: null, apple: false };
  const link = (k: string) => opts.physical.find((x) => x.key === k) ?? null;
  const options: BuyOption[] = [];

  if (opts.direct) {
    options.push({
      key: "direct",
      group: "Digital",
      store: "Cassette Direct",
      what: "Download, from the artist",
      price: money(opts.direct.minimumPrice / 100, opts.direct.currency ?? "USD"),
      href: `/sign-in?callbackUrl=${encodeURIComponent(`/album/${opts.slug}`)}`,
      external: false,
      sponsored: false,
      productId: opts.direct.productId,
    });
  }
  // their Bandcamp page is the artist's own shop for anything a person can own here; never the pick (B&N leads)
  if (opts.bandcamp) {
    options.push({ key: "bandcamp", group: "Digital", store: "Bandcamp", what: "From the artist", price: null, href: opts.bandcamp, external: true, sponsored: false });
  }
  const bn = can.newCopies ? link("bn") : null;
  if (bn) options.push({ key: "bn", group: "Physical", store: "Barnes & Noble", what: "New CD or vinyl", price: null, href: bn.href, external: true, sponsored: true });
  // an artist can ask that their record never point at Amazon (studio setting, hideAmazon)
  const amazon = can.newCopies && !opts.hideAmazon ? link("amazon") : null;
  if (amazon) options.push({ key: "amazon", group: "Physical", store: "Amazon", what: "New CD or vinyl", price: null, href: amazon.href, external: true, sponsored: true });
  const ebay = can.used ? link("ebay") : null;
  if (ebay) options.push({ key: "ebay", group: "Physical", store: "eBay", what: "Used CD or vinyl", price: null, href: ebay.href, external: true, sponsored: true });

  const pick = buyPick(options.map((o) => o.key));
  // physical first in the menu, then digital
  const order = ["Physical", "Digital"];
  options.sort((x, y) => order.indexOf(x.group) - order.indexOf(y.group));
  return { options, pick, apple: can.apple };
}
