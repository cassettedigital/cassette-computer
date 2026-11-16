"use client";

/**
 * The one Buy button, a split button (the founder, 2026-11-16, dropdown-sketches): its main half says your
 * store and goes straight there ("Buy on Barnes & Noble", with the price when the store gave us one); its
 * chevron opens every store. Your store is the one you picked last (kept in this browser, on every record),
 * else our pick (buy.ts). Picking a store in the menu goes there and makes it your button from then on.
 *
 * The menu is built to hold many stores without overwhelming: chips for All, Digital and Physical (a store
 * that sells both shows under each; by what the store sells, never a guess about this record), stores with
 * a price first (cheapest first), a line, then the rest A to Z, an order that never reshuffles. Your store
 * wears the lift. The list fits what the chips leave, easing between sizes, and scrolls past eight. One line
 * at the foot says what's true: prices come from the store, and stock varies. Drawn and keyed by the shared
 * menu; this file holds the stores and the memory.
 *
 * Apple's download is asked for when a person points at Buy or opens it (/api/album/[slug]/apple), never
 * while the page renders (or at once, when Apple is the person's store), and joins the stores when Apple has
 * this record. Cassette Direct starts the artist's own checkout (/api/creator/checkout, then Stripe); signed
 * out, its row is the way to sign in.
 *
 * Buy never takes over an app's window (Q5). In the desktop app every row opens in the person's browser,
 * Cassette Direct as the record's page on the website, where the checkout runs signed in. The iPhone's
 * web view needs nothing from here: it hands every other site (a store, Stripe) to Safari itself.
 */

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { Icon } from "@/app/_taste/Icon";
import { Menu, MenuLine, MenuLink, splitMainClass } from "@/app/_taste/Menu";
import { inPanelFrame, type Surface } from "@/lib/app-surface";
import { tell } from "@/lib/ask";
import { openOutside } from "@/lib/open-outside";
import { PUBLIC_SITE_URL } from "@/lib/urls";
import type { BuyOption } from "./types";
import b from "./buy.module.css";

/** What each store sells, by the store (not by this record): the chips narrow by it. */
const SELLS: Record<BuyOption["key"], ReadonlyArray<"digital" | "physical">> = {
  direct: ["digital"],
  apple: ["digital"],
  bandcamp: ["digital", "physical"],
  bn: ["physical"],
  amazon: ["physical"],
  ebay: ["physical"],
};
type Chip = "all" | "digital" | "physical";
const CHIPS: Array<{ id: Chip; label: string }> = [
  { id: "all", label: "All" },
  { id: "digital", label: "Digital" },
  { id: "physical", label: "Physical" },
];

/** A price's amount, for the order (cheapest first); an unreadable one sorts last among the priced. */
const amount = (price: string) => {
  const n = Number(price.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : Number.MAX_VALUE;
};

/** The list eases from its old height to its new one when the chips change what it holds: `before` notes
 *  the height a moment before the change, and the new height is measured once the rows have changed. */
function useFit(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const from = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const was = from.current;
    from.current = null;
    el.style.height = "";
    const to = el.offsetHeight;
    if (was && to && was !== to && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.style.height = `${was}px`;
      void el.offsetHeight;
      el.style.height = `${to}px`;
    }
    if (el.scrollHeight > el.clientHeight + 4) el.dataset.more = "";
    else delete el.dataset.more;
  }, [dep]);
  const before = () => {
    from.current = ref.current?.offsetHeight ?? null;
  };
  return { ref, before };
}

const KEY = "taste:buy-store";

function readUsual(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
function keepUsual(key: string) {
  try {
    window.localStorage.setItem(KEY, key);
  } catch {
    // private window or blocked storage: the menu just won't remember
  }
}

/** Apple's row, once asked for: undefined until then, null when Apple doesn't have the record. */
function useApple(slug: string, wanted: boolean) {
  const [apple, setApple] = useState<BuyOption | null | undefined>(undefined);
  const asked = useRef(false);
  const ask = () => {
    if (!wanted || asked.current) return;
    asked.current = true;
    fetch(`/api/album/${encodeURIComponent(slug)}/apple`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { apple: { price: string; url: string } | null } | null) => {
        const hit = d?.apple;
        setApple(
          hit
            ? { key: "apple", group: "Digital", store: "Apple", what: "Download", price: hit.price, href: hit.url, external: true, sponsored: false }
            : null,
        );
      })
      .catch(() => setApple(null));
  };
  return { apple, ask };
}

async function checkout(productId: string): Promise<void> {
  try {
    const res = await fetch("/api/creator/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productId }),
    });
    const data = (await res.json().catch(() => null)) as { checkoutUrl?: string; error?: string } | null;
    if (res.ok && data?.checkoutUrl) {
      // Stripe's page never runs in a frame: from the account window's side panel it takes the whole window
      (inPanelFrame() && window.top ? window.top : window).location.href = data.checkoutUrl;
      return;
    }
    await tell(data?.error ?? "Couldn't start the checkout. Try again.");
  } catch {
    await tell("Couldn't reach the checkout. Try again.");
  }
}

export function BuyMenu({
  slug,
  options: known,
  pick,
  apple: askApple,
  signedIn,
  surface = "web",
}: {
  slug: string;
  options: BuyOption[];
  pick: string | null;
  apple: boolean;
  signedIn: boolean;
  surface?: Surface;
}) {
  const outside = surface === "desk";
  const [usual, setUsual] = useState<string | null>(null);
  const [chip, setChip] = useState<Chip>("all");
  const { apple, ask } = useApple(slug, askApple);
  const options = apple ? [...known, apple] : known;
  const fit = useFit(chip);

  useEffect(() => {
    const u = readUsual();
    if (u) setUsual(u);
    // Apple as your store: its row (and so the button's link) is asked for at once
    if (u === "apple") ask();
  }, []); // once, on arrival

  const mine = usual && options.some((o) => o.key === usual) ? usual : null;
  const lead = options.find((o) => o.key === (mine ?? pick)) ?? options[0];
  if (!lead) return null;

  const choose = (o: BuyOption) => (e: MouseEvent<HTMLAnchorElement>) => {
    keepUsual(o.key);
    setUsual(o.key);
    if (outside) {
      e.preventDefault();
      openOutside(o.key === "direct" ? `${PUBLIC_SITE_URL}/album/${encodeURIComponent(slug)}` : o.href);
      return;
    }
    if (o.key === "direct" && o.productId && signedIn) {
      e.preventDefault();
      void checkout(o.productId);
    }
  };
  const leaves = (o: BuyOption) => o.external || outside;
  const linkProps = (o: BuyOption) =>
    // the same rel as the menu's store rows: a store link that can earn keeps the referrer (BUG-335)
    leaves(o) ? { target: "_blank", rel: o.sponsored ? "noopener nofollow sponsored" : "noopener noreferrer nofollow" } : {};

  // the order: a price first, cheapest first; then the rest A to Z. It never reshuffles.
  const priced = options.filter((o) => o.price).sort((x, y) => amount(x.price!) - amount(y.price!));
  const rest = options.filter((o) => !o.price).sort((x, y) => x.store.localeCompare(y.store));
  const shows = (o: BuyOption) => chip === "all" || SELLS[o.key].includes(chip);
  const both = options.some((o) => SELLS[o.key].includes("digital")) && options.some((o) => SELLS[o.key].includes("physical"));
  const pricedShown = priced.some(shows);
  const restShown = rest.some(shows);

  // opening puts the focus on your store's row
  const leadItem = (items: HTMLElement[]) => items.find((el) => el.dataset.store === lead.key) ?? items[0];

  const row = (o: BuyOption) => (
    <MenuLink
      key={o.key}
      href={o.href}
      external={leaves(o)}
      sponsored={o.sponsored}
      chosen={o.key === lead.key}
      name={o.store}
      price={o.price}
      go={o.key === "direct" && !outside ? "Buy" : "Open"}
      hidden={!shows(o)}
      store={o.key}
      onPick={choose(o)}
    />
  );

  return (
    <Menu
      trigger="split"
      align="row"
      label="Every store"
      buttonLabel="Every store"
      focusOnOpen={leadItem}
      onWarm={ask}
      primary={
        <a
          href={lead.href}
          className={splitMainClass}
          onClick={choose(lead)}
          onPointerEnter={ask}
          onFocus={ask}
          {...linkProps(lead)}
        >
          <span>Buy on {lead.store}</span>
          {lead.price && <span className={b.price}>{lead.price}</span>}
          {leaves(lead) && <Icon name="out" size={12} />}
        </a>
      }
    >
      {both && (
        <div className={b.chips} role="group" aria-label="What you want">
          {CHIPS.map((c) => (
            <button
              key={c.id}
              type="button"
              role="menuitemradio"
              aria-checked={chip === c.id}
              tabIndex={-1}
              className={b.chip}
              onClick={() => {
                fit.before();
                setChip(c.id);
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}
      <div ref={fit.ref} className={b.list}>
        {priced.map(row)}
        <MenuLine hidden={!(pricedShown && restShown)} />
        {rest.map(row)}
      </div>
      <p className={b.foot}>Prices come from the store. Stock varies.</p>
    </Menu>
  );
}
