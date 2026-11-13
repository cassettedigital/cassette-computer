"use client";

/**
 * TextLink — the canonical inline link atom (graduated from styleguide-next).
 *
 * One React Aria Link reskinned through `data-*` state attributes into three
 * voices, so every surface stops hand-rolling its own `.link` CSS:
 *   • body   — serif, underlined, ink; the in-prose reading link (manifesto,
 *              help, liner notes). Underline warms to orange on hover.
 *   • quiet  — mono, tracked, ink2; utility / "back" / footer links.
 *   • accent — Barlow, orange, with a nudging arrow; the "more →" call-to-read.
 *
 * Internal hrefs route through the app RouterProvider; pass `target`/`rel` for
 * external destinations. Behavior + focus ring come from React Aria.
 */

import type { ReactNode } from "react";
import type { LinkProps } from "react-aria-components";
import { Link } from "react-aria-components";
import styles from "./TextLink.module.css";

export type TextLinkVariant = "body" | "quiet" | "accent";

export function TextLink({
  children,
  variant = "body",
  className,
  ...props
}: Omit<LinkProps, "children" | "className"> & {
  variant?: TextLinkVariant;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Link
      {...props}
      data-variant={variant}
      className={[styles.link, typeof className === "string" ? className : null]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
      {variant === "accent" ? (
        <span className={styles.arrow} aria-hidden="true">
          →
        </span>
      ) : null}
    </Link>
  );
}
