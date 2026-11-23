"use client";

/**
 * The text field: its label above in the label role, one line of input drawn as a line around the paper
 * (no well, no inset shadow), and a hint or an error under it. React Aria's TextField supplies the label
 * association, the hint and error wiring and the validation state; the kit owns only the look, so the
 * old kit's Field props carry over as they were.
 *
 * `hideLabel` keeps the label for screen readers only. `mono` sets a code (an invite, a one-time code) in
 * DM Mono caps. `description` is the hint; `errorMessage` is the error (it also marks the field invalid).
 * `inputProps` reaches the <input> for native attributes the wrapper doesn't model (inputMode, maxLength,
 * autoCapitalize, spellCheck), `inputClassName` its class. `reveal` on a password field adds a Show key at its
 * end, so a long password typed on a phone can be checked before it's sent.
 */

import { useState, type InputHTMLAttributes, type ReactNode } from "react";
import { FieldError, Input, Label, Text, TextField, type TextFieldProps } from "react-aria-components";
import f from "./field.module.css";

export function Field({
  label,
  hideLabel = false,
  placeholder,
  type = "text",
  className,
  inputClassName,
  autoComplete,
  mono = false,
  description,
  errorMessage,
  inputProps,
  isInvalid,
  reveal = false,
  ...props
}: Omit<TextFieldProps, "className"> & {
  label?: string;
  /** keep the label for screen readers, hide it on the page */
  hideLabel?: boolean;
  placeholder?: string;
  /** the native input type (text, email, password, search) */
  type?: string;
  className?: string;
  inputClassName?: string;
  autoComplete?: string;
  /** DM Mono caps, for codes */
  mono?: boolean;
  /** the hint under the input */
  description?: ReactNode;
  /** the error under the input; also marks the field invalid */
  errorMessage?: ReactNode;
  inputProps?: InputHTMLAttributes<HTMLInputElement>;
  /** a password field: a Show key at its end */
  reveal?: boolean;
}) {
  const [shown, setShown] = useState(false);
  const revealable = reveal && type === "password";
  const input = (
    <Input
      {...inputProps}
      placeholder={placeholder}
      autoComplete={autoComplete}
      className={[f.input, mono ? f.mono : null, revealable ? f.withReveal : null, inputClassName].filter(Boolean).join(" ")}
    />
  );
  return (
    <TextField
      {...props}
      type={revealable && shown ? "text" : type}
      isInvalid={isInvalid ?? (errorMessage ? true : undefined)}
      className={className ? `${f.field} ${className}` : f.field}
    >
      {label ? <Label className={hideLabel ? f.hidden : f.label}>{label}</Label> : null}
      {revealable ? (
        <div className={f.reveal}>
          {input}
          <button
            type="button"
            className={f.show}
            aria-pressed={shown}
            aria-label={shown ? "Hide password" : "Show password"}
            onClick={() => setShown((v) => !v)}
          >
            {shown ? "Hide" : "Show"}
          </button>
        </div>
      ) : (
        input
      )}
      {description ? (
        <Text slot="description" className={f.hint}>
          {description}
        </Text>
      ) : null}
      <FieldError className={f.error}>{errorMessage}</FieldError>
    </TextField>
  );
}
