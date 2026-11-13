"use client";

/**
 * The one Buy button: the word and the chevron, nothing else, the same height as Preview album beside it
 * (the founder, 2026-10-21: "keep the top level simple as possible"). It opens a menu of every way to own
 * the record, physical and digital, each with what you get and its price when one is known; that is
 * where the explaining lives. The store it leads with is the one you picked last time (kept in this
 * browser, on every record), else our pick (buy.ts), and it is the menu's lit row, tagged "Yours" or
 * "Our pick". Choosing a store opens it and remembers it. Drawn and keyed by the shared menu (its trigger
 * the outlined Button; its panel hangs from the start of the opener's row of buttons, so it never runs
 * past the window's edge); this file holds the stores and the memory.
 *
 * Apple's download is asked for when a person points at Buy or opens it (/api/album/[slug]/apple), never
 * while the page renders, and joins the Digital group when Apple has this record. Cassette Direct starts
 * the artist's own checkout (/api/creator/checkout, then Stripe); signed out, its row is the way to sign in.
 *
 * Buy never takes over an app's window (Q5). In the desktop app every row opens in the person's browser,
 * Cassette Direct as the record's page on the website, where the checkout runs signed in. The iPhone's
 * web view needs nothing from here: it hands every other site (a store, Stripe) to Safari itself.
 */

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Menu, MenuGroup, MenuLink } from "@/app/_taste/Menu";
import { inPanelFrame, type Surface } from "@/lib/app-surface";
import { tell } from "@/lib/ask";
import { openOutside } from "@/lib/open-outside";
import { PUBLIC_SITE_URL } from "@/lib/urls";
import type { BuyOption } from "./types";

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
  const { apple, ask } = useApple(slug, askApple);
  const options = apple ? [...known, apple] : known;

  useEffect(() => {
    const u = readUsual();
    if (u) setUsual(u);
  }, []);

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

  // opening puts the focus on the store it leads with (by its place among the options)
  const leadItem = (items: HTMLElement[]) => items[Math.max(0, options.findIndex((o) => o.key === lead.key))];

  const groups = (["Physical", "Digital"] as const).map((g) => ({ g, list: options.filter((o) => o.group === g) })).filter((x) => x.list.length);

  return (
    <Menu trigger="button" align="row" label="Where to buy it" title="Buy" focusOnOpen={leadItem} onWarm={ask}>
      {groups.map(({ g, list }) => (
        <MenuGroup key={g} label={g}>
          {list.map((o) => (
            <MenuLink
              key={o.key}
              href={o.href}
              external={o.external || outside}
              sponsored={o.sponsored}
              lead={o.key === lead.key}
              priced={!!o.price}
              name={o.store}
              tag={o.key === mine ? "Yours" : !mine && o.key === pick ? "Our pick" : null}
              what={o.what}
              price={o.price ?? "See price"}
              onPick={choose(o)}
            />
          ))}
        </MenuGroup>
      ))}
    </Menu>
  );
}
