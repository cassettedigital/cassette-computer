/**
 * Doors: a list of places to go, each a name in the display face over one line about it, no boxes and no
 * rules between them. One column on a phone, two from 760, three from 1100 (or at most `max`; 1 keeps a
 * short list, such as an article's related reading, in one column). The line is
 * in the label type for a run of names (a genre's styles), or in the caption type for a sentence (what a
 * document covers). Promoted from the genre index.
 */

import Link from "next/link";
import d from "./doors.module.css";

export type Door = { href: string; name: string; line?: string };

export function Doors({ doors, max = 3, line = "label" }: { doors: Door[]; max?: 1 | 2 | 3; line?: "label" | "caption" }) {
  return (
    <ul className={d.doors} data-max={max}>
      {doors.map((door) => (
        <li key={door.href}>
          <Link className={d.door} href={door.href}>
            <span className={d.name}>{door.name}</span>
            {door.line ? <span className={line === "caption" ? d.caption : d.label}>{door.line}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
