"use client";

/**
 * The parts a desktop page of figures, lists and forms wants, beside the player parts. No iPhone twin (the
 * phone has no such pages); drawn from the same tokens so they sit with the rest without a seam. The desk
 * (the desktop app's library) and the admin pages both draw with them; neither keeps a copy of its own.
 *
 *   Places, Place  the rail's places, as the desk's: a glyph, the name, a note at the end, and a live line
 *                  under the name when something's going on there (a waveform and what's on). The page
 *                  you're on is a lit row with its glyph in the accent; a place with nowhere to go yet is
 *                  dimmed. Folded (a rail down to its icons), the glyphs alone, centred, names as tooltips.
 *   DataTable      a dense table: no lines between rows, a wash under the pointer, figures in even widths,
 *                  sideways scroll when the window is narrow. A cell says what it is with a data attribute:
 *                  data-end (right-aligned, for figures), data-lead (the row's name, in the first ink),
 *                  data-wrap (words that wrap, keeping their line breaks), data-quiet (the least ink).
 *   Stats, Stat    figures in a row: a label in caps over the number, a line under it when it needs one.
 *                  Small: each as wide as its words, the figure a size down (a device's particulars).
 *   Facts, Fact    label and value pairs, one a line (a report's particulars)
 *   Tag            a word in a capsule, in a tone: a status, a role, a kind
 *   Key            the small key a page acts with: a capsule the Segmented switch's height (34), so a row
 *                  of keys, fields and switches lines up. fill (the one primary fill), line, plain, danger.
 *                  A link when it has an href.
 *   Field, Input, Select   a label over a control; the controls are capsules the Key's height. A Select can
 *                  wear a tone (a status picked in place) and come small (inside a table's row).
 *   Toggle, Check  a switch (on is the one primary fill); a box to tick, with its words
 *   Dialog         a small window over the page: the browser's own modal, so Escape and the focus are its.
 *                  460 wide, or the width it's given; it takes its colours from where it's mounted.
 *   Panel, Code    a raised card with a head (a kicker, the title, a line, keys at its end); code or data
 *   Note, Notice   a line a page says (a list with nothing in it, how an action went); a page that isn't
 *                  there or couldn't load: one big line, a quiet line, its keys
 */

import { isValidElement, useEffect, useId, useRef, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from "react";
import { Glyph } from "./Glyph";
import { useKitLink } from "./KitProvider";
import s from "./kit.module.css";

/** The tones a word can take: the inks, the one primary fill, and the three signal colours. */
export type Tone = "plain" | "quiet" | "fill" | "success" | "warning" | "danger";

/* ── the rail's places ── */

export function Places({ label, folded, children }: { label?: string; folded?: boolean; children: ReactNode }) {
  return (
    <div className={s.places} data-folded={folded || undefined}>
      {label && <p className={s.placesLabel}>{label}</p>}
      <ul className={s.placeList}>{children}</ul>
    </div>
  );
}

export function Place({
  href,
  label,
  glyph,
  current,
  note,
  live,
}: {
  href?: string;
  label: string;
  glyph: ReactNode;
  current?: boolean;
  note?: ReactNode;
  /** a line under the name: what's on there, a Waveform first */
  live?: ReactNode;
}) {
  const Link = useKitLink();
  const face = (
    <>
      <span className={s.placeGlyph}>{glyph}</span>
      <span className={s.placeText}>
        <span className={s.placeName}>{label}</span>
        {live && <span className={s.placeLive}>{live}</span>}
      </span>
      {note != null && <span className={s.placeNote}>{note}</span>}
    </>
  );
  return (
    <li>
      {href ? (
        <Link href={href} className={s.place} aria-current={current ? "page" : undefined} title={label}>
          {face}
        </Link>
      ) : (
        <span className={s.place} aria-disabled="true">
          {face}
        </span>
      )}
    </li>
  );
}

/* ── the table ── */

export type Column = string | { label: string; end?: boolean };

export function DataTable({
  label,
  columns,
  minWidth,
  align,
  empty,
  children,
}: {
  label: string;
  columns: Column[];
  /** the least width before it scrolls sideways */
  minWidth?: number;
  /** "top" for rows of long words, each cell starting at the row's top; else the row's middle */
  align?: "middle" | "top";
  /** said in place of the rows when there are none */
  empty?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={s.dataWrap}>
      <table className={s.data} aria-label={label} data-align={align === "top" ? "top" : undefined} style={minWidth ? { minWidth } : undefined}>
        <thead>
          <tr>
            {columns.map((c) => {
              const col = typeof c === "string" ? { label: c } : c;
              return (
                <th key={col.label} scope="col" data-end={col.end || undefined}>
                  {col.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {empty ? (
            <tr className={s.dataEmpty}>
              <td colSpan={columns.length}>{empty}</td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ── figures and particulars ── */

export function Stats({ label, size = "regular", children }: { label?: string; size?: "regular" | "small"; children: ReactNode }) {
  return (
    <dl className={s.stats} aria-label={label} data-size={size}>
      {children}
    </dl>
  );
}

export function Stat({ label, value, line, tone }: { label: string; value: ReactNode; line?: ReactNode; tone?: Tone }) {
  return (
    <div className={s.stat} data-tone={tone}>
      <dt>{label}</dt>
      <dd>{value}</dd>
      {line && <dd className={s.statLine}>{line}</dd>}
    </div>
  );
}

export function Facts({ children }: { children: ReactNode }) {
  return <dl className={s.facts}>{children}</dl>;
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={s.fact}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Tag({ tone = "plain", title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  return (
    <span className={s.tag} data-tone={tone} title={title}>
      {children}
    </span>
  );
}

/* ── keys and fields ── */

type KeyTone = "fill" | "line" | "plain" | "danger";

export function Key({
  tone = "line",
  href,
  children,
  className,
  ...rest
}: { tone?: KeyTone; href?: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const Link = useKitLink();
  const cls = className ? `${s.key} ${className}` : s.key;
  if (href) {
    return (
      <Link href={href} className={cls} data-tone={tone} title={rest.title} aria-label={rest["aria-label"]}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} data-tone={tone} {...rest}>
      {children}
    </button>
  );
}

/** A label over its control. `grow` lets it take a share of a row of fields. */
export function Field({ label, htmlFor, grow, children }: { label: string; htmlFor?: string; grow?: boolean; children: ReactNode }) {
  return (
    <div className={s.field} data-grow={grow || undefined}>
      <label className={s.fieldLabel} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={className ? `${s.input} ${className}` : s.input} {...rest} />;
}

/** The words inside a node (an option's label, however it was written). */
const wordsOf = (node: ReactNode): string =>
  typeof node === "string" || typeof node === "number"
    ? String(node)
    : Array.isArray(node)
      ? node.map(wordsOf).join("")
      : isValidElement<{ children?: ReactNode }>(node)
        ? wordsOf(node.props.children)
        : "";

/** The longest option's length in letters, wherever the options sit among the children. */
const longest = (node: ReactNode): number =>
  Array.isArray(node)
    ? Math.max(0, ...node.map(longest))
    : isValidElement<{ children?: ReactNode }>(node)
      ? node.type === "option"
        ? wordsOf(node.props.children).length
        : longest(node.props.children)
      : 0;

export function Select({ tone, size = "regular", className, style, children, ...rest }: { tone?: Tone; size?: "regular" | "small" } & Omit<SelectHTMLAttributes<HTMLSelectElement>, "size">) {
  return (
    <span className={className ? `${s.selectBox} ${className}` : s.selectBox} data-size={size} data-tone={tone}>
      <select className={s.select} style={{ "--chars": longest(children), ...style } as CSSProperties} {...rest}>
        {children}
      </select>
      <Glyph name="chevronRight" size={size === "small" ? 10 : 11} className={s.selectChev} />
    </span>
  );
}

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" className={s.toggle} aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />;
}

export function Check({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <label className={s.check}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
      <span>{children}</span>
    </label>
  );
}

/* ── the dialog ── */

export function Dialog({
  open,
  onClose,
  title,
  line,
  width,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** its heading: words, or a field the heading is (the Admin board's card, whose title is edited in place) */
  title: ReactNode;
  line?: string;
  /** its width when the window has the room; else 460 */
  width?: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={s.dialog}
      style={width ? ({ "--dialog-w": `${width}px` } as CSSProperties) : undefined}
      aria-labelledby={`${id}-title`}
      onClose={onClose}
      // a click on the dimmed page around it (the dialog's own box is the inner one) puts it away
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {open && (
        <div className={s.dialogBody}>
          <div className={s.dialogHead}>
            <h2 id={`${id}-title`} className={s.dialogTitle}>
              {title}
            </h2>
            {line && <p className={s.dialogLine}>{line}</p>}
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

/* ── cards ── */

export function Panel({ kicker, title, line, end, children }: { kicker?: ReactNode; title?: string; line?: ReactNode; end?: ReactNode; children?: ReactNode }) {
  const head = kicker || title || line || end;
  return (
    <div className={s.panel}>
      {head && (
        <div className={s.panelHead}>
          <div className={s.panelHeadText}>
            {kicker && <div className={s.panelKicker}>{kicker}</div>}
            {title && <h3 className={s.panelTitle}>{title}</h3>}
            {line && <p className={s.panelLine}>{line}</p>}
          </div>
          {end && <div className={s.panelEnd}>{end}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <pre className={s.code}>{children}</pre>;
}

/* ── what a page says ── */

export function Note({ tone, as: El = "p", children }: { tone?: Tone; as?: "p" | "span"; children: ReactNode }) {
  return (
    <El className={s.note} data-tone={tone}>
      {children}
    </El>
  );
}

export function Notice({ head, line, children }: { head: string; line?: string; children?: ReactNode }) {
  return (
    <div className={s.notice}>
      <p className={s.noticeHead}>{head}</p>
      {line && <p className={s.noticeLine}>{line}</p>}
      {children && <div className={s.noticeKeys}>{children}</div>}
    </div>
  );
}
