/**
 * Button — the single canonical button surface for the app.
 *
 * Wraps the established `.cs-btn-*` classes in globals.css (primary/secondary/
 * ghost/danger) so call sites stop re-implementing button styling inline.
 * `buttonClass()` is exported for the cases that can't be a <button> element
 * (a Next <Link>, an <a>, or a file-input <label>) but must still share the
 * exact same canonical styling — one source of truth, no 7th system.
 *
 * Two orthogonal modifiers ride on every variant — same button, different scale
 * or affordance, never a new button:
 *   • size  — `sm` is the compact action-bar/nav scale (a small primary sits flush
 *             beside a small ghost); `lg` is the marketing row scale (~50px).
 *   • icon  — any inline <svg> child auto-sizes to the type scale and inherits the
 *             button's ink (see `.cs-btn-* svg` in globals.css). Pass a stroke-based
 *             icon next to the label; no extra prop needed.
 *
 * Server-safe: no client hooks. Renders a plain <button>; pass onClick from a
 * client component as usual.
 */

import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";
import Link from "next/link";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "lg";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "cs-btn-primary",
  secondary: "cs-btn-outline",
  ghost: "cs-btn-action",
  danger: "cs-btn-danger",
};

// Per-variant size hooks. Secondary's geometry lives ENTIRELY in its modifier, so
// it always carries one (defaulting to sm). The solid/bordered variants own a full
// default scale, so they only opt into the compact `--sm`; ghost is already small.
const SIZE_CLASS: Record<ButtonVariant, Partial<Record<ButtonSize, string>>> = {
  // `lg` is the marketing row scale: same primary, taller, with a lit rim + gradient
  // face (the only extra "emphasis" a top-of-funnel CTA earns) — never a new button.
  primary: { sm: "cs-btn-primary--sm", lg: "cs-btn-primary--lg" },
  secondary: { sm: "cs-btn-outline--sm", lg: "cs-btn-outline--lg" },
  ghost: {}, // already the compact action-bar scale — `sm` is a no-op
  danger: { sm: "cs-btn-danger--sm" },
};

export type ButtonClassOptions = {
  className?: string;
  size?: ButtonSize;
};

/** The canonical class string for a variant — for non-<button> elements. */
export function buttonClass(
  variant: ButtonVariant = "primary",
  options?: string | ButtonClassOptions,
): string {
  const normalized: ButtonClassOptions =
    typeof options === "string" ? { className: options } : (options ?? {});

  const parts: (string | undefined)[] = [VARIANT_CLASS[variant]];

  if (variant === "secondary") {
    parts.push(SIZE_CLASS.secondary[normalized.size ?? "sm"]);
  } else if (normalized.size) {
    parts.push(SIZE_CLASS[variant][normalized.size]);
  }

  if (normalized.className) {
    parts.push(normalized.className);
  }

  return parts.filter(Boolean).join(" ");
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({
  variant = "primary",
  size,
  className,
  type,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={buttonClass(variant, { size, className })}
      {...rest}
    />
  );
}

export type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

/**
 * ButtonLink — a navigation target wearing the canonical button skin. The one
 * sanctioned way to make an <a> look like a button: a Next <Link> (internal
 * routing / prefetch) over `buttonClass()`, so links and buttons never drift.
 * Pass `target`/`rel` for external destinations.
 */
export function ButtonLink({
  href,
  variant = "primary",
  size,
  className,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link href={href} className={buttonClass(variant, { size, className })} {...rest} />
  );
}
