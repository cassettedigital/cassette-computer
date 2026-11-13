"use client";

/**
 * Read-first account setting: shows what it is now with a quiet key ("Edit", "Change", "Add") at the end,
 * and opens its form under it on press. Keeps the account page calm: nobody wants every field in edit mode
 * all the time. In the desktop app some changes happen on the website instead (`href`): the key opens it
 * in the browser.
 */

import { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { Key } from "@discovery/cassette-kit";
import { openOutside } from "@/lib/open-outside";
import { Setting } from "@/app/settings/_parts/parts";

export function CollapsibleField({
  label,
  value,
  action = "Edit",
  href,
  children,
}: {
  label: string;
  value: React.ReactNode;
  /** Verb on the key ("Edit" / "Change" / "Add"). */
  action?: string;
  /** The change happens on the website instead: the key opens this address in the browser. */
  href?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const end = href ? (
    <Key onClick={() => openOutside(href)} title="Opens on the website">
      {action}
      <ArrowUpRight size={14} strokeWidth={2.25} aria-hidden="true" />
    </Key>
  ) : (
    <Key tone={open ? "plain" : "line"} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
      {open ? "Cancel" : action}
    </Key>
  );
  return (
    <Setting name={label} value={value} end={end}>
      {open && !href ? children : null}
    </Setting>
  );
}
