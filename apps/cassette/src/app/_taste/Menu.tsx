"use client";

/**
 * One dropdown menu (P4), its look and its keyboard written once: a real menu button (aria-haspopup,
 * aria-expanded, aria-controls always naming its panel) and a role="menu" panel. Enter, Space, ArrowDown
 * and ArrowUp open it, and opening puts the focus on the item the menu asks for (the current choice, the
 * store it leads with) or the first; the arrow keys move and wrap, Home and End jump, Escape closes and
 * gives the focus back to the button, Tab closes, and a click or tap outside closes. Picking closes it.
 *
 * The panel takes the colour of the button it came out of, not the site's (the founder, 2026-11-18): the
 * masthead's dark pill opens a dark panel, the near-black glass; a button on the paper (Buy, a head's word, the
 * records' sort) opens a panel of the paper, its raised stock in the same ink. And it stays attached to that
 * button: it hangs from the button's own edge, never from the row it sits in, opening inward (from its right
 * edge when the button is in the window's right half), and only slides along to stay inside the window.
 *
 * One panel (the founder, 2026-11-16): made of the masthead's pill, its near-black glass on either paper,
 * with concentric corners (menu.module.css). Group heads in the label type, items in the masthead's
 * typewriter caps; the current choice is the masthead's lift: no dot, no tick. It grows out of its
 * trigger when it opens.
 *
 * The trigger is one of the set's own parts: `trigger` "label" is the arrow link's underlined label, and
 * "button" the outlined Button, one word and the chevron, nothing else (Buy: the founder, 2026-10-21,
 * "keep the top level simple as possible"; what each store offers is the menu's to say); both carry the
 * one chevron. "text" is a small line of text in the label type with the chevron, nothing drawn around it,
 * sat right after a section head's text on the head's baseline (the records' sort: "Newest first"); `title`
 * is the text, and its spoken name is `buttonLabel`. "word" is a word in a section head, the last word of its
 * sentence: the player kit's answer face (italic, 500) in the record's colour with the chevron (the artist
 * page's "If you like Radiohead for their *sound*"); it needs the head's row to set `inline`. "avatar" is the
 * masthead's round account key,
 * the person's own face (`face`) in it; its spoken name is `buttonLabel`. "menu" is the masthead's corner key:
 * the menu's two lines and, after them, `face` (the person's face, or the empty face for no one); it lifts
 * out of the pill while the menu is open. "split" is a split button (Buy): `primary` is its main half (a link
 * the page draws, with `splitMainClass`), and the menu opens from the chevron half beside it. `align` is which edge the panel
 * hangs from; under 760 a start-aligned panel hangs from the whole row the page puts the menu in (the
 * page makes that row the positioned box), so a long line never wraps. "row" hangs it from the start of
 * that row at every width (Buy: the last of a row of buttons, its menu opens under the whole row, never
 * past the window's edge).
 *
 * Items: MenuRadio (one choice of several), MenuLink (a store), MenuItem (a plain place or action:
 * the account's Apps, Settings, Sign out), MenuPerson (the signed-in person at the top of the masthead's
 * menu), MenuLine (a line between kinds of rows).
 */

import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Button } from "./Button";
import { Icon, type IconName } from "./Icon";
import b from "./button.module.css";
import m from "./menu.module.css";
import t from "./taste.module.css";

const Ctx = createContext<{ close: (refocus: boolean) => void } | null>(null);
function useMenu() {
  const v = useContext(Ctx);
  if (!v) throw new Error("A menu item outside a Menu");
  return v;
}

export function Menu({
  trigger,
  align,
  label,
  title,
  face,
  primary,
  buttonLabel,
  focusOnOpen,
  onWarm,
  children,
}: {
  trigger: "label" | "button" | "text" | "avatar" | "word" | "menu" | "split";
  align: "start" | "end" | "row";
  /** The menu's spoken name. */
  label: string;
  /** trigger "split": the main half, drawn by the page (a link with `splitMainClass`). */
  primary?: ReactNode;
  /** The button's word ("Buy"), the small text of a "text" trigger, the word of a "word" one. */
  title?: ReactNode;
  /** trigger "avatar" or "menu": the person's photo or initial (or, for "menu", the empty face). */
  face?: ReactNode;
  /** The button's spoken name, when it should say more than its word. */
  buttonLabel?: string;
  /** Which item takes the focus on opening; the first when this gives none. */
  focusOnOpen?: (items: HTMLElement[]) => HTMLElement | undefined;
  /** Runs when a person points at, focuses or opens the button: the moment to fetch what the menu shows
   *  (Buy asks for Apple's price then, never at render, so a crawler never sets it off). */
  onWarm?: () => void;
  children: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  // which edge it hangs from, worked out as it opens: inward, toward the middle of the window, so a menu at the
  // page's right (Buy, at the end of a row) opens leftward and never runs off (the founder, 2026-11-18)
  const [side, setSide] = useState<"start" | "end">(align === "end" ? "end" : "start");
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const focusRef = useRef(focusOnOpen);
  focusRef.current = focusOnOpen;

  // the items the keys walk: never one a page has hidden (Buy's chips leave stores out)
  const items = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []).filter((el) => !el.hidden);
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  // on open, the focus lands on the asked-for item; a click or tap outside closes
  useEffect(() => {
    if (!open) return;
    const list = items();
    (focusRef.current?.(list) ?? list[0])?.focus();
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  // attached: the panel hangs from its button's edge and only slides along it to stay inside the window
  useLayoutEffect(() => {
    const el = panel.current;
    if (!open || !el) return;
    el.style.removeProperty("--menu-slide");
    // its laid-out box, not its drawn one: it opens from a slightly smaller scale, which a bounding box would read.
    // Measured from the box it actually hangs from, which isn't always its own button: on a phone the masthead
    // stretches its menu across the whole bar, and measuring from the button there threw it off the left edge
    const from = el.offsetParent;
    if (!from) return;
    const left = from.getBoundingClientRect().left + from.clientLeft + el.offsetLeft;
    const right = left + el.offsetWidth;
    const room = 12;
    let dx = 0;
    if (right > window.innerWidth - room) dx = window.innerWidth - room - right;
    if (left + dx < room) dx = room - left;
    if (dx) el.style.setProperty("--menu-slide", `${Math.round(dx)}px`);
  }, [open, side]);

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
    else if (e.key === "Escape") {
      e.preventDefault();
      close(true);
    } else if (e.key === "Tab") setOpen(false);
  };

  // Enter and Space open it as a click does; the arrows open it too
  const onButtonKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setOpen(true);
    }
  };

  const menuId = `${id}-menu`;
  // the masthead's keys are on its dark pill, so their panel is the dark glass; every other trigger sits on the paper
  const ink = trigger === "avatar" || trigger === "menu";
  const buttonProps = {
    ref: button,
    "aria-haspopup": "menu" as const,
    "aria-expanded": open,
    "aria-controls": menuId,
    "aria-label": buttonLabel,
    onClick: () => {
      onWarm?.();
      if (!open && align !== "end") {
        const r = wrap.current?.getBoundingClientRect();
        if (r) setSide(r.left + r.width / 2 > window.innerWidth / 2 ? "end" : "start");
      }
      setOpen((o) => !o);
    },
    onKeyDown: onButtonKey,
    ...(onWarm ? { onPointerEnter: onWarm, onFocus: onWarm } : {}),
  };
  const chevron = (
    <span className={m.chev} aria-hidden="true">
      <Icon name="chevron" size={12} />
    </span>
  );

  return (
    <Ctx.Provider value={{ close }}>
      <div ref={wrap} className={m.wrap} data-align={align} data-side={side} data-open={open || undefined}>
        {trigger === "text" ? (
          <button type="button" className={m.text} data-open={open || undefined} {...buttonProps}>
            {title}
            {chevron}
          </button>
        ) : trigger === "avatar" ? (
          <button type="button" className={m.avatar} data-open={open || undefined} {...buttonProps}>
            {face}
          </button>
        ) : trigger === "split" ? (
          <span className={m.split} data-open={open || undefined}>
            {primary}
            <button type="button" className={m.splitMore} {...buttonProps}>
              <Icon name="chevron" size={12} />
            </button>
          </span>
        ) : trigger === "menu" ? (
          <button type="button" className={m.menuKey} data-open={open || undefined} {...buttonProps}>
            <Icon name="menu" size={20} />
            {face}
          </button>
        ) : trigger === "word" ? (
          <button type="button" className={m.word} data-open={open || undefined} {...buttonProps}>
            {title}
            {chevron}
          </button>
        ) : trigger === "label" ? (
          <button type="button" className={`${b.arrow} ${m.label}`} {...buttonProps}>
            {title}
            {chevron}
          </button>
        ) : (
          <Button look="outlined" className={m.button} trail={chevron} {...buttonProps}>
            {title}
          </Button>
        )}
        <div
          ref={panel}
          id={menuId}
          role="menu"
          aria-label={label}
          className={ink ? `${t.dark} ${m.panel}` : m.panel}
          data-tone={ink ? "ink" : "paper"}
          hidden={!open}
          onKeyDown={onMenuKey}
        >
          {children}
        </div>
      </div>
    </Ctx.Provider>
  );
}

/** The class for a split trigger's main half (the page draws the link itself). */
export const splitMainClass = m.splitMain;

/** A labelled group of items; its head is for the eye, the group's label for the ear. */
export function MenuGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className={m.group}>
      <span className={m.head} aria-hidden="true">
        {label}
      </span>
      {children}
    </div>
  );
}

/** One choice of several: the current one is a lit row. Picking closes the menu and gives the focus back to the button. */
export function MenuRadio({ checked, onPick, children }: { checked: boolean; onPick: () => void; children: ReactNode }) {
  const { close } = useMenu();
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      tabIndex={-1}
      className={m.item}
      onClick={() => {
        onPick();
        close(true);
      }}
    >
      {children}
    </button>
  );
}

/**
 * One store (Buy): its name, and at the right its price when the store gave us one. Pointing at it swaps the
 * price for its way out (`go`: "Buy" for our own checkout, drawn in the orange, or "Open" for a store that
 * leaves the site). `chosen` is the store the person's Buy button goes to: the lift. Picking follows the
 * link and closes the menu; a pick that starts something of its own first (a checkout) stops the link
 * through the click it is handed. `sponsored` marks a store link that can earn us a commission. `hidden`
 * leaves it out while the menu's chips narrow the stores.
 */
export function MenuLink({
  href,
  external,
  sponsored = false,
  chosen,
  name,
  price,
  go,
  hidden,
  store,
  onPick,
}: {
  href: string;
  external: boolean;
  sponsored?: boolean;
  chosen: boolean;
  /** The store's key, for the page to find its row (the focus on opening). */
  store?: string;
  name: ReactNode;
  price: ReactNode | null;
  go: "Buy" | "Open";
  hidden?: boolean;
  onPick: (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const { close } = useMenu();
  return (
    <a
      role="menuitem"
      tabIndex={-1}
      className={`${m.item} ${m.store}`}
      data-lit={chosen || undefined}
      data-store={store}
      hidden={hidden}
      href={href}
      {...(external
        ? {
            target: "_blank",
            // A store link that can earn never drops the referrer: the network has to see
            // the click came from our page (the Amazon closure, BUG-335; Sovrn's site check).
            rel: sponsored ? "noopener nofollow sponsored" : "noopener noreferrer nofollow",
          }
        : {})}
      onClick={(e) => {
        onPick(e);
        close(false);
      }}
    >
      <span className={m.storeName}>{name}</span>
      <span className={m.storeEnd}>
        {price != null && <span className={m.price}>{price}</span>}
        <span className={m.go} data-ours={go === "Buy" || undefined} aria-hidden="true">
          {go}
          {go === "Open" && <Icon name="out" size={11} />}
        </span>
      </span>
    </a>
  );
}

/** A line between kinds of rows (the masthead's menu: you above it, the places below). */
export function MenuLine({ hidden }: { hidden?: boolean }) {
  return <div className={m.line} role="separator" hidden={hidden} />;
}

/** The signed-in person, first in the masthead's menu: their face and name, going to their account. */
export function MenuPerson({ href, face, name, sub }: { href: string; face: ReactNode; name: string; sub: string }) {
  const { close } = useMenu();
  return (
    <a role="menuitem" tabIndex={-1} className={`${m.item} ${m.person}`} href={href} onClick={() => close(false)}>
      <span className={m.lead} aria-hidden="true">
        {face}
      </span>
      <span>
        <span className={m.personName}>{name}</span>
        <span className={m.personSub}>{sub}</span>
      </span>
    </a>
  );
}

/**
 * A plain item: a place (`href`, a plain link, so it can leave this app for the dashboard) or an action
 * (`onPick` alone, a button). Picking closes the menu; an action gives the focus back to the button.
 * `icon` leads the row with its glyph (the masthead's menu, where each place wears the icon it has in the
 * pill); `current` marks the page you are on (a lit row, and aria-current). `className` lets a page show or
 * hide a row by its own rules.
 */
export function MenuItem({
  href,
  onPick,
  icon,
  current,
  className,
  children,
}: {
  href?: string;
  onPick?: () => void;
  icon?: IconName;
  current?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const { close } = useMenu();
  const cls = [m.item, icon ? m.withIcon : "", className ?? ""].filter(Boolean).join(" ");
  const body = icon ? (
    <>
      <Icon name={icon} size={20} />
      <span>{children}</span>
    </>
  ) : (
    children
  );
  return href ? (
    <a
      role="menuitem"
      tabIndex={-1}
      className={cls}
      data-lit={current || undefined}
      aria-current={current ? "page" : undefined}
      href={href}
      onClick={() => {
        onPick?.();
        close(false);
      }}
    >
      {body}
    </a>
  ) : (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={cls}
      onClick={() => {
        onPick?.();
        close(true);
      }}
    >
      {body}
    </button>
  );
}
