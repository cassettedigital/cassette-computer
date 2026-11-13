"use client";

/**
 * The parts every Studio page lays itself out with, beside the player kit's own (keys, fields, switches,
 * tables, notes, dialogs: packages/cassette-kit Pages.tsx, which Studio uses as they are, one key size). See
 * studio.module.css for what each looks like.
 *
 *   StudioPage     a page's frame: the kit's heading as its title, tools at the end of the line, one plain
 *                  line under it, an optional switch between pages, then the page. `read` holds it to a
 *                  reading width (pages of words and fields).
 *   StudioSection  a section: the kit's heading (the shout and a quiet aside), keys at its end, then its body.
 *   PageSwitch     the kit's switch as links, for pages that live at their own address (an artist's pages).
 *   Area           a paragraph box, the kit's field with room for lines.
 *   FileKey        a key that picks a file.
 *   Rows, RowItem  a list held apart by space, a wash under the pointer: a picture, the words, keys at the end.
 *   Thumb          a cover or a photo at the row's size or large, round for a person.
 *   Words          a person's own words as a fan reads them.
 *   OutKey         a key that opens a page in a new tab (the live page, a preview).
 *   (ui.ts)        the layout classes, row, rowEnd, fields, stack, split, for server and client pages.
 */

import { useId, useRef, type ReactNode, type TextareaHTMLAttributes } from "react";
import { usePathname } from "next/navigation";
import { QuietLink } from "@/app/components/QuietLink";
import { Heading, Key } from "@discovery/cassette-kit";
import s from "./studio.module.css";

export function StudioPage({
  title,
  line,
  tools,
  switcher,
  before,
  read,
  children,
}: {
  title: string;
  line?: ReactNode;
  tools?: ReactNode;
  switcher?: ReactNode;
  /** above the title: a way back to where the page came from */
  before?: ReactNode;
  read?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={s.page} data-measure={read ? "read" : undefined}>
      <header className={s.head}>
        {before}
        <div className={s.headRow}>
          <Heading as="h1" shout={title} tone="quiet" />
          {tools && <div className={s.row}>{tools}</div>}
        </div>
        {line && <p className={s.line}>{line}</p>}
        {switcher}
      </header>
      {children}
    </div>
  );
}

export function StudioSection({ title, note, end, children }: { title?: string; note?: string; end?: ReactNode; children?: ReactNode }) {
  return (
    <section className={s.section}>
      {(title || end) && (
        <div className={s.sectionHead}>
          {title && <Heading shout={title} answer={note} tone="quiet" />}
          {end && <div className={s.row}>{end}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** The kit's switch as links. A page is lit when the address is it, or (with `deep`) anything under it. */
export function PageSwitch({ label, items }: { label: string; items: Array<{ href: string; label: string; deep?: boolean }> }) {
  const path = usePathname() ?? "";
  return (
    <nav className={s.switch} aria-label={label}>
      {items.map((it) => {
        const on = path === it.href || (!!it.deep && path.startsWith(it.href + "/"));
        return (
          <QuietLink key={it.href} href={it.href} aria-current={on ? "page" : undefined}>
            {it.label}
          </QuietLink>
        );
      })}
    </nav>
  );
}

export function Area({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={className ? `${s.area} ${className}` : s.area} {...rest} />;
}

/** A key that opens the file picker. The input is out of sight; the key is what you press. */
export function FileKey({
  accept,
  onFile,
  disabled,
  tone = "line",
  children,
}: {
  accept: string;
  onFile: (file: File) => void;
  disabled?: boolean;
  tone?: "fill" | "line" | "plain";
  children: ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const id = useId();
  return (
    <>
      <input
        ref={ref}
        id={id}
        type="file"
        accept={accept}
        className={s.hidden}
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (file) onFile(file);
        }}
      />
      <Key tone={tone} disabled={disabled} onClick={() => ref.current?.click()}>
        {children}
      </Key>
    </>
  );
}

export function Rows({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <ul className={s.rows} aria-label={label}>
      {children}
    </ul>
  );
}

/** One row: a picture, the words (a link when it goes somewhere), keys at the end. `dim` for one set aside. */
export function RowItem({
  art,
  href,
  title,
  meta,
  children,
  end,
  dim,
}: {
  art?: ReactNode;
  href?: string;
  title: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
  end?: ReactNode;
  dim?: boolean;
}) {
  const words = (
    <>
      <span className={s.rowTitle}>{title}</span>
      {meta && <span className={s.rowMeta}>{meta}</span>}
      {children}
    </>
  );
  return (
    <li className={s.rowItem} data-dim={dim || undefined}>
      {art ?? <span />}
      {href ? (
        <QuietLink href={href} className={s.rowLink}>
          {words}
        </QuietLink>
      ) : (
        <div className={s.rowLink}>{words}</div>
      )}
      {end ? <div className={s.row}>{end}</div> : <span />}
    </li>
  );
}

export function Thumb({ children, size, round, initials }: { children?: ReactNode; size?: "large"; round?: boolean; initials?: string }) {
  return (
    <span className={s.thumb} data-size={size} data-round={round || undefined}>
      {children ?? (initials ? <span className={s.thumbInitials}>{initials}</span> : null)}
    </span>
  );
}

/** A grid of thumbs, each with what's under it. */
export function Thumbs({ children }: { children: ReactNode }) {
  return <div className={s.thumbs}>{children}</div>;
}

export function Words({ lead, quiet, children }: { lead?: boolean; quiet?: boolean; children: ReactNode }) {
  return (
    <p className={s.words} data-size={lead ? "lead" : undefined} data-quiet={quiet || undefined}>
      {children}
    </p>
  );
}

/** A key that opens a page in a new tab (the live page, a preview), so Studio stays where it was. */
export function OutKey({ href, tone = "line", children }: { href: string; tone?: "fill" | "line" | "plain"; children: ReactNode }) {
  return (
    <Key tone={tone} onClick={() => window.open(href, "_blank", "noopener,noreferrer")}>
      {children}
    </Key>
  );
}
