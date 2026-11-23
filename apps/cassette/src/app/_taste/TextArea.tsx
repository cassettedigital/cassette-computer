"use client";

/**
 * The paragraph field, Field's sibling for more than one line: its label above in the label role, the
 * box drawn as a line around the paper with the area's corners (24px, round everywhere: a box you type a
 * paragraph into), and a hint or an error under it. React Aria's TextField supplies the label
 * association, the hint and error wiring and the validation state; the kit owns only the look.
 *
 * `rows` is how tall it opens; it grows no further on its own (the reader can drag it taller). `areaProps`
 * reaches the <textarea> for native attributes the wrapper doesn't model (maxLength, spellCheck).
 */

import type { ReactNode, TextareaHTMLAttributes } from "react";
import { FieldError, Label, TextArea as AriaTextArea, Text, TextField, type TextFieldProps } from "react-aria-components";
import a from "./area.module.css";
import f from "./field.module.css";

export function TextArea({
  label,
  hideLabel = false,
  placeholder,
  rows = 4,
  description,
  errorMessage,
  areaProps,
  isInvalid,
  ...props
}: Omit<TextFieldProps, "className"> & {
  label?: string;
  /** keep the label for screen readers, hide it on the page */
  hideLabel?: boolean;
  placeholder?: string;
  /** how many lines it opens at */
  rows?: number;
  /** the hint under the box */
  description?: ReactNode;
  /** the error under the box; also marks the field invalid */
  errorMessage?: ReactNode;
  areaProps?: TextareaHTMLAttributes<HTMLTextAreaElement>;
}) {
  return (
    <TextField {...props} isInvalid={isInvalid ?? (errorMessage ? true : undefined)} className={f.field}>
      {label ? <Label className={hideLabel ? f.hidden : f.label}>{label}</Label> : null}
      <AriaTextArea {...areaProps} rows={rows} placeholder={placeholder} className={a.area} />
      {description ? (
        <Text slot="description" className={f.hint}>
          {description}
        </Text>
      ) : null}
      <FieldError className={f.error}>{errorMessage}</FieldError>
    </TextField>
  );
}
