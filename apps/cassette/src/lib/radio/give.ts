/**
 * Backing a station, two ways: support it (donate, membership) or buy from its own shop (merch, its own
 * records). The founder sees them as two sides of one coin, so a station page offers them as one key
 * (StationGiveKey): its main half is the way this listener used last, on any station that has it, else the
 * one this station has; a first-time listener gets Support. Remembered per browser, as Buy remembers its
 * store. Pure, so the choice is tested (give.test.ts).
 */

export type StationGive = "support" | "shop";

/** The browser's memory of the way this listener backed a station last. */
export const GIVE_KEY = "taste:station-give";

export type GiveLinks = { supportUrl: string | null; shopUrl: string | null };

/** The ways this station has, Support first. */
export function givesOf(links: GiveLinks): StationGive[] {
  return [...(links.supportUrl ? ["support" as const] : []), ...(links.shopUrl ? ["shop" as const] : [])];
}

/** The way the key leads with: the one used last when this station has it, else Support, else Shop; null for neither. */
export function giveLead(links: GiveLinks, usual: string | null): StationGive | null {
  const has = givesOf(links);
  if (usual === "support" || usual === "shop") {
    if (has.includes(usual)) return usual;
  }
  return has[0] ?? null;
}

/** What a way is called, the same everywhere a station is offered: "Support KEXP", "dublab shop". */
export function giveLabel(give: StationGive, name: string): string {
  return give === "support" ? `Support ${name}` : `${name} shop`;
}

/** Its word alone, where the station's name is already beside it (the dock's foot, a tight row). */
export function giveWord(give: StationGive): string {
  return give === "support" ? "Support" : "Shop";
}

export type GiveItem = { give: StationGive; label: string; word: string; href: string };

/**
 * Every way this station has, in the order anything that lists them shows them: the one the key would lead
 * with first (the way used last, else Support), then the other. The station page's key, the dial's menus,
 * the Mac app's station menu and the dock all read this, so a station is backed the same way everywhere.
 */
export function giveItems(station: GiveLinks & { name: string }, usual: string | null): GiveItem[] {
  const lead = giveLead(station, usual);
  if (!lead) return [];
  const order = [lead, ...givesOf(station).filter((g) => g !== lead)];
  return order.map((give) => ({
    give,
    label: giveLabel(give, station.name),
    word: giveWord(give),
    href: (give === "support" ? station.supportUrl : station.shopUrl)!,
  }));
}

/**
 * The ways as menu entries, for any station menu: opening one remembers it as this listener's usual way, as
 * the key does. `open` is how that surface opens an outside page (a new tab on the web, the browser from the
 * Mac app). Read the usual way when the menu is built, so a menu opened after a choice already leads with it.
 */
export function giveMenu(
  station: GiveLinks & { name: string },
  open: (href: string) => void,
): { label: string; onSelect: () => void }[] {
  return giveItems(station, readUsualGive()).map((g) => ({
    label: g.label,
    onSelect: () => {
      keepUsualGive(g.give);
      open(g.href);
    },
  }));
}

export function readUsualGive(): string | null {
  try {
    return window.localStorage.getItem(GIVE_KEY);
  } catch {
    return null;
  }
}

export function keepUsualGive(give: StationGive): void {
  try {
    window.localStorage.setItem(GIVE_KEY, give);
  } catch {
    // private window or blocked storage: the key just won't remember
  }
}
