/**
 * The printed label button and the links, shared by the taste pages.
 *
 * Button (P1): one height (the kit's control height, var(--control-h)), one padding, two looks: `filled` (the stock's ink as the
 * fill, its paper as the label: cream on the dark stock, ink on the light one) and `outlined` (a line on
 * the paper). An optional leading glyph, one line of label, and an optional trailing piece; never a
 * second line of detail under the label (the founder, 2026-10-21: the two-line Buy and "Hear it /
 * Paranoid Android" were copy over copy). A trailing arrow's gap opens on the spring when pointed at.
 * The masthead's pill is the one exception to these, and it lives with the masthead.
 *
 * ArrowLink (P2): the underlined label with its arrow, the gap opening on the spring. A link that leaves
 * the site shows the up-and-out arrow, one inside it the right arrow: that is what the link does, not a
 * look. ArrowButton is the same label on a button ("+12 more songs"), with no arrow. InlineLink is a link
 * inside a sentence: the sentence's own letter, underlined.
 *
 * `plain` draws a plain <a> rather than next/link, for a link that leaves the app or stays on the page;
 * a link off the site or to an anchor is always plain.
 */

import type { ComponentPropsWithRef, ReactNode } from "react";
import Link from "next/link";
import { Icon } from "./Icon";
import b from "./button.module.css";

export type ButtonLook = "filled" | "outlined";

/**
 * How a key gives way in a row of keys (ActionRow, row-fit.ts): the play key to "Preview" then its glyph ("play"), a name
 * with a short form ("name"), a word beside a glyph ("word"), or never ("keep"). Every key in a row says one.
 */
export type Give = "play" | "name" | "word" | "keep";

/** The class list for anything drawn as a Button (the Button itself, a menu's trigger, a link). */
export function buttonClass(look: ButtonLook = "filled", extra?: string): string {
  return [b.btn, b[look], extra].filter(Boolean).join(" ");
}

export function Button({
  look,
  give,
  icon,
  trail,
  round,
  className,
  children,
  type = "button",
  ...rest
}: ComponentPropsWithRef<"button"> & {
  look?: ButtonLook;
  /** How it gives way in a row of keys (ActionRow); every key in a row says one. */
  give?: Give;
  /** A leading glyph. */
  icon?: ReactNode;
  /** A trailing piece after the label. */
  trail?: ReactNode;
  /**
   * The glyph alone in a round key at the button's height, for a key whose glyph says it all and which must not
   * change size as its state changes (a live stream's mute: turning, mute, unmute). It still needs an aria-label.
   */
  round?: boolean;
}) {
  return (
    <button type={type} className={buttonClass(look, round ? [b.round, className].filter(Boolean).join(" ") : className)} data-give={give} {...rest}>
      {icon}
      {children}
      {trail}
    </button>
  );
}

const external = (href: string) => /^https?:\/\//i.test(href);
const plainHref = (href: string) => external(href) || href.startsWith("#");

type LinkProps = { href: string; plain?: boolean; className?: string; children: ReactNode } & Omit<
  ComponentPropsWithRef<"a">,
  "href" | "className" | "children"
>;

/** The arrow link: inside the app next/link, or a plain <a> off the site, to an anchor or with `plain`. */
export function ArrowLink({ href, plain, className, children, ...rest }: LinkProps) {
  const cls = className ? `${b.arrow} ${className}` : b.arrow;
  const body = (
    <>
      {children}
      <Icon name={external(href) ? "out" : "arrow"} size={13} />
    </>
  );
  return plain || plainHref(href) ? (
    <a className={cls} href={href} {...rest}>
      {body}
    </a>
  ) : (
    <Link className={cls} href={href} {...rest}>
      {body}
    </Link>
  );
}

/** The arrow link's label on a button ("+12 more songs"): it opens something here, so no arrow. */
export function ArrowButton({ className, children, type = "button", ...rest }: Omit<ComponentPropsWithRef<"button">, "className" | "children"> & { className?: string; children: ReactNode }) {
  return (
    <button type={type} className={className ? `${b.arrow} ${className}` : b.arrow} {...rest}>
      {children}
    </button>
  );
}

/** A link inside a sentence: the sentence's own letter and colour, underlined. With `out` (a link that leaves the
 *  site, in a line of details: a station's own site), underlined only when pointed at, the out arrow sliding in. */
export function InlineLink({ href, plain, className, children, out, ...rest }: LinkProps & { out?: boolean }) {
  const cls = [b.inline, out ? b.out : null, className].filter(Boolean).join(" ");
  if (out)
    return (
      <a className={cls} href={href} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
        <span className={b.outIcon} aria-hidden="true">
          <Icon name="out" size={12} />
        </span>
      </a>
    );
  return plain || plainHref(href) ? (
    <a className={cls} href={href} {...rest}>
      {children}
    </a>
  ) : (
    <Link className={cls} href={href} {...rest}>
      {children}
    </Link>
  );
}
