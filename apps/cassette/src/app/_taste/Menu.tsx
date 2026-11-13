"use client";

/**
 * One dropdown menu (P4), its look and its keyboard written once: a real menu button (aria-haspopup,
 * aria-expanded, aria-controls always naming its panel) and a role="menu" panel. Enter, Space, ArrowDown
 * and ArrowUp open it, and opening puts the focus on the item the menu asks for (the current choice, the
 * store it leads with) or the first; the arrow keys move and wrap, Home and End jump, Escape closes and
 * gives the focus back to the button, Tab closes, and a click or tap outside closes. Picking closes it.
 *
 * One panel: the stock's raised surface, 5px corners, one ring, group heads in the label type, items in
 * the serif. The current choice is a lit row (a wash of the record's colour): no dot, no tick.
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
 * the person's own face (`face`) in it; its spoken name is `buttonLabel`. `align` is which edge the panel
 * hangs from; under 760 a start-aligned panel hangs from the whole row the page puts the menu in (the
 * page makes that row the positioned box), so a long line never wraps. "row" hangs it from the start of
 * that row at every width (Buy: the last of a row of buttons, its menu opens under the whole row, never
 * past the window's edge).
 *
 * Items: MenuRadio (one choice of several), MenuLink (a store), MenuItem (a plain place or action:
 * the account's Library, Settings, Sign out).
 */

import { createContext, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Button } from "./Button";
import { Icon } from "./Icon";
import b from "./button.module.css";
import m from "./menu.module.css";

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
  buttonLabel,
  focusOnOpen,
  onWarm,
  children,
}: {
  trigger: "label" | "button" | "text" | "avatar" | "word";
  align: "start" | "end" | "row";
  /** The menu's spoken name. */
  label: string;
  /** The button's word ("Buy"), the small text of a "text" trigger, the word of a "word" one. */
  title?: ReactNode;
  /** trigger "avatar": what sits in the round key (the person's photo or initial). */
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
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const focusRef = useRef(focusOnOpen);
  focusRef.current = focusOnOpen;

  const items = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
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
  const buttonProps = {
    ref: button,
    "aria-haspopup": "menu" as const,
    "aria-expanded": open,
    "aria-controls": menuId,
    "aria-label": buttonLabel,
    onClick: () => {
      onWarm?.();
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
      <div ref={wrap} className={m.wrap} data-align={align} data-open={open || undefined}>
        {trigger === "text" ? (
          <button type="button" className={m.text} data-open={open || undefined} {...buttonProps}>
            {title}
            {chevron}
          </button>
        ) : trigger === "avatar" ? (
          <button type="button" className={m.avatar} data-open={open || undefined} {...buttonProps}>
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
        <div ref={panel} id={menuId} role="menu" aria-label={label} className={m.panel} hidden={!open} onKeyDown={onMenuKey}>
          {children}
        </div>
      </div>
    </Ctx.Provider>
  );
}

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
 * One store: its name with a small tag (information, not state), what you get, the price, and the
 * up-and-out arrow when it leaves the site. `lead` lights the row it leads with. Picking follows the link
 * and closes the menu; a pick that starts something of its own first (a checkout) stops the link through
 * the click it is handed. `sponsored` marks a store link that can earn us a commission.
 */
export function MenuLink({
  href,
  external,
  sponsored = false,
  lead,
  priced,
  name,
  tag,
  what,
  price,
  onPick,
}: {
  href: string;
  external: boolean;
  sponsored?: boolean;
  lead: boolean;
  priced: boolean;
  name: ReactNode;
  tag: ReactNode;
  what: ReactNode;
  price: ReactNode;
  onPick: (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const { close } = useMenu();
  return (
    <a
      role="menuitem"
      tabIndex={-1}
      className={`${m.item} ${m.store}`}
      data-lit={lead || undefined}
      data-priced={priced ? "" : undefined}
      href={href}
      {...(external ? { target: "_blank", rel: `noopener noreferrer nofollow${sponsored ? " sponsored" : ""}` } : {})}
      onClick={(e) => {
        onPick(e);
        close(false);
      }}
    >
      <span className={m.name}>
        {name}
        {tag && <span className={m.tag}>{tag}</span>}
      </span>
      <span className={m.what}>{what}</span>
      <span className={m.price}>{price}</span>
      {external && (
        <span className={m.out} aria-hidden="true">
          <Icon name="out" size={12} />
        </span>
      )}
    </a>
  );
}

/**
 * A plain item: a place (`href`, a plain link, so it can leave this app for the dashboard) or an action
 * (`onPick` alone, a button). Picking closes the menu; an action gives the focus back to the button.
 */
export function MenuItem({ href, onPick, children }: { href?: string; onPick?: () => void; children: ReactNode }) {
  const { close } = useMenu();
  return href ? (
    <a
      role="menuitem"
      tabIndex={-1}
      className={m.item}
      href={href}
      onClick={() => {
        onPick?.();
        close(false);
      }}
    >
      {children}
    </a>
  ) : (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className={m.item}
      onClick={() => {
        onPick?.();
        close(true);
      }}
    >
      {children}
    </button>
  );
}
