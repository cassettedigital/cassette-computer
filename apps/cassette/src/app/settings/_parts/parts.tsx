"use client";

/**
 * The parts Settings' pages lay themselves out with, beside the player kit's own (Key, Field, Input, Toggle,
 * Note: packages/cassette-kit Pages.tsx, one key size) and Studio's (StudioSection, Rows, RowItem, Thumb,
 * studio/_kit/parts.tsx). See settings.module.css for what each looks like.
 *
 *   SettingsPage  a page's frame: the kit's heading as its title, keys at the end of the line, one plain
 *                 line under it, then the page. `fill` takes the box it's given (the desk's window holds
 *                 its own measure); otherwise it keeps the Settings window's reading measure.
 *   SettingList   settings one above the other, held apart by space
 *   Setting       one: its name, what it is now, a line about it, a key or a switch at the end, and what
 *                 opens under it (its form)
 *   SettingForm   a small form: its fields, then its keys and what it says
 *   SettingsEmpty what a page says while it has nothing in it: the shape of what will be there (three faint
 *                 rows like its real ones), what lands here and how, and the keys that get someone there.
 *                 Most people never fill some of these pages, so the empty one has to read as a place,
 *                 not a blank line (the founder, 2026-11-08: "a real empty state").
 */

import type { FormEvent, ReactNode } from "react";
import NextLink from "next/link";
import { Heading } from "@discovery/cassette-kit";
import s from "./settings.module.css";

export function SettingsPage({
  title,
  line,
  tools,
  fill,
  children,
}: {
  title: string;
  line?: ReactNode;
  tools?: ReactNode;
  fill?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={s.page} data-fill={fill || undefined}>
      <header className={s.head}>
        <div className={s.headRow}>
          <Heading as="h1" shout={title} tone="quiet" />
          {tools && <div className={s.end}>{tools}</div>}
        </div>
        {line && <p className={s.line}>{line}</p>}
      </header>
      {children}
    </div>
  );
}

export function SettingList({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <ul className={s.list} aria-label={label}>
      {children}
    </ul>
  );
}

export function Setting({
  name,
  value,
  about,
  end,
  children,
  as: El = "li",
}: {
  name: ReactNode;
  value?: ReactNode;
  about?: ReactNode;
  end?: ReactNode;
  /** what opens under it: its form, the list it holds */
  children?: ReactNode;
  /** a setting outside a SettingList is a div */
  as?: "li" | "div";
}) {
  return (
    <El className={s.setting}>
      <div className={s.words}>
        <span className={s.name}>{name}</span>
        {value != null && <span className={s.value}>{value}</span>}
        {about && <p className={s.about}>{about}</p>}
      </div>
      {end ? <div className={s.end}>{end}</div> : <span />}
      {children && <div className={s.more}>{children}</div>}
    </El>
  );
}

export function SettingForm({
  onSubmit,
  keys,
  children,
}: {
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  /** the form's keys and what it says, in one row under its fields */
  keys: ReactNode;
  children?: ReactNode;
}) {
  return (
    <form className={s.form} onSubmit={onSubmit}>
      {children}
      <div className={s.keys}>{keys}</div>
    </form>
  );
}

/** Words that link somewhere quietly: help, or the way to delete an account. A page of the site goes through
 *  next/link, so the window stays put; anything else (a mail link) is a plain anchor. */
export function QuietLink({ href, children }: { href: string; children: ReactNode }) {
  return href.startsWith("/") ? (
    <NextLink href={href} className={s.quiet}>
      {children}
    </NextLink>
  ) : (
    <a href={href} className={s.quiet}>
      {children}
    </a>
  );
}

/** The quiet link's look on a key that does something here: the way into deleting an account. */
export function QuietKey({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={s.quiet} onClick={onClick}>
      {children}
    </button>
  );
}

export function SettingsEmpty({
  head,
  line,
  round,
  ends,
  children,
}: {
  head: string;
  line: ReactNode;
  /** the rows' pictures are round (people), not square (records) */
  round?: boolean;
  /** what ends each faint row, so they look like the rows that will come (Reviews: a rating) */
  ends?: [ReactNode, ReactNode, ReactNode];
  /** the keys that get someone to where this page fills */
  children?: ReactNode;
}) {
  return (
    <section className={s.empty} aria-label={head}>
      <div className={s.ghost} data-ends={ends ? "" : undefined} aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className={s.ghostRow}>
            <span className={s.ghostArt} data-round={round || undefined} />
            <span className={s.ghostWords}>
              <span />
              <span />
            </span>
            {ends ? <span className={s.ghostEnd}>{ends[i]}</span> : null}
          </div>
        ))}
      </div>
      <div className={s.emptyWords}>
        <h2 className={s.emptyHead}>{head}</h2>
        <p className={s.emptyLine}>{line}</p>
        {children && <div className={s.emptyKeys}>{children}</div>}
      </div>
    </section>
  );
}
