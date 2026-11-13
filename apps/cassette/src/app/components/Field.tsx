"use client";

/**
 * Field — the canonical text / search input for the whole site, and the third
 * component on the WRAP-AND-RESKIN PATTERN established by [[ActionButton]]: a thin
 * Cassette wrapper over ONE React Aria primitive (here `TextField` + `Input`,
 * with an optional `Label`) plus a co-located `.module.css` that reskins by
 * targeting the primitive's `data-*` state attributes ([data-focused],
 * [data-hovered], [data-invalid], [data-disabled]) and maps each onto tokens.
 *
 * React Aria supplies the field semantics — label association, validation state,
 * controlled value via `onChange(value: string)` (NOT an event), and the focus
 * ring. We own only the look. Everything that needs a text/search box uses THIS.
 *
 * Two affordances live inside the recessed well:
 *  - `icon`   — a leading glyph (the search affordance).
 *  - `action` — a trailing inset submit cap. The CONVENTION for "button in a
 *    field": it is always present but ASLEEP when the field is empty (quiet,
 *    slightly shrunk), and WAKES on focus/typing (orange faceplate, full size).
 *    Pure CSS (`:placeholder-shown`/`:focus`), so it needs a `placeholder`.
 *
 * API: pass React Aria TextField props — `value`/`defaultValue` + `onChange`
 * (string), `name`, `type`, `isRequired`, `isDisabled`, `aria-label` (when there
 * is no visible `label`). `inputClassName` reaches the inner <input>.
 *
 * Form-field affordances (graduated in from the styleguide-next KitField so the
 * auth surface can retire its native-input AuthField):
 *  - `hideLabel`    — keep the <Label> for screen readers, hide it visually.
 *  - `mono`         — DM Mono / wide tracking / uppercase (invite + OTP codes).
 *  - `description`  — RA `Text slot="description"` hint under the input.
 *  - `errorMessage` — RA `FieldError` message (also marks the field invalid).
 *  - `inputProps`   — escape hatch onto the inner <input> for native attrs the
 *    wrapper doesn't model (inputMode, maxLength, autoCapitalize, spellCheck…).
 */

import type { InputHTMLAttributes, ReactNode } from "react";
import { TextField, Input, Label, Text, FieldError } from "react-aria-components";
import type { TextFieldProps } from "react-aria-components";
import styles from "./Field.module.css";

type FieldAction = {
  /** accessible label for the inset button (icon-only, so this is required) */
  label: string;
  /** "submit" (default) posts the wrapping <form>; "button" calls onPress */
  type?: "submit" | "button";
  onPress?: () => void;
  /** glyph inside the cap — defaults to the go/enter arrow */
  icon?: ReactNode;
};

/** Default "go / enter" glyph for the inset action cap. */
function GoArrow() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h13" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

export function Field({
  label,
  hideLabel = false,
  placeholder,
  type = "text",
  className,
  inputClassName,
  autoComplete,
  icon,
  action,
  mono = false,
  quiet = false,
  soft = false,
  description,
  errorMessage,
  inputProps,
  isInvalid,
  ...props
}: Omit<TextFieldProps, "className"> & {
  label?: string;
  /** keep the <Label> for screen readers but hide it visually (inline rows) */
  hideLabel?: boolean;
  placeholder?: string;
  /** native input type (text | email | …) */
  type?: string;
  className?: string;
  inputClassName?: string;
  autoComplete?: string;
  /** optional leading glyph (search icon, etc.) rendered inside the well */
  icon?: ReactNode;
  /** optional trailing inset submit cap — the "button in a field" convention */
  action?: FieldAction;
  /** DM Mono / wide tracking / uppercase — invite + one-time codes */
  mono?: boolean;
  /** Quiet well — subtle border, no recessed inset shadow, larger radius. For
   *  dense stacks of fields (the album edit pane), where the default recessed
   *  well repeated 5+ times reads as high-contrast "zebra" striping. Matches the
   *  top-bar GlobalSearch field's calmer treatment. */
  quiet?: boolean;
  /** Soft well — blends into whatever surface it sits on: a gentle translucent
   *  darken instead of a solid well + no hard border or recess, so a field in a
   *  calm editing pane (Studio) reads as part of the page, not a stamped-on box.
   *  Focus still lights the orange ring. */
  soft?: boolean;
  /** hint rendered under the input (RA Text slot="description") */
  description?: ReactNode;
  /** error rendered under the input (RA FieldError; also marks invalid) */
  errorMessage?: ReactNode;
  /** escape hatch onto the inner <input> for native attrs not modelled above */
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
}) {
  return (
    <TextField
      {...props}
      type={type}
      isInvalid={isInvalid ?? (errorMessage ? true : undefined)}
      className={[styles.field, className].filter(Boolean).join(" ")}
    >
      {label ? (
        <Label className={[styles.label, hideLabel ? styles.srOnly : null].filter(Boolean).join(" ")}>
          {label}
        </Label>
      ) : null}
      <div className={styles.inputWrap}>
        {icon ? (
          <span className={styles.icon} aria-hidden="true">
            {icon}
          </span>
        ) : null}
        <Input
          {...inputProps}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className={[
            styles.input,
            icon ? styles.hasIcon : null,
            action ? styles.hasAction : null,
            mono ? styles.mono : null,
            quiet ? styles.quiet : null,
            soft ? styles.soft : null,
            inputClassName,
          ]
            .filter(Boolean)
            .join(" ")}
        />
        {action ? (
          <button
            type={action.type ?? "submit"}
            onClick={action.onPress}
            aria-label={action.label}
            className={styles.action}
          >
            {action.icon ?? <GoArrow />}
          </button>
        ) : null}
      </div>
      {description ? (
        <Text slot="description" className={styles.desc}>
          {description}
        </Text>
      ) : null}
      <FieldError className={styles.error}>{errorMessage}</FieldError>
    </TextField>
  );
}
