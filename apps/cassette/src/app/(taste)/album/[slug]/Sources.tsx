"use client";

/**
 * Sources: one pill (stacked favicons and "N sources") that opens the linked list of every outlet on the
 * page. Its number is the press set's one count. Each outlet shows the shared outlet mark, fed by the
 * favicons stored with the press. No line vouches for the quotes under it (the founder, 2026-11-07: copy
 * never vouches for our own method).
 */

import { useState } from "react";
import { Icon } from "@/app/_taste/Icon";
import { OutletMark } from "@/app/_taste/Quote";
import k from "@/app/_taste/taste.module.css";
import type { AlbumPage, SourceItem } from "./types";
import a from "./album.module.css";

function Mark({ s }: { s: SourceItem }) {
  return <OutletMark icon={s.icon} name={s.outlet} size={20} />;
}

export function Sources({ p }: { p: AlbumPage }) {
  const [open, setOpen] = useState(false);
  const n = p.press.total;
  return (
    <section className={`${k.ed} ${a.sources}`} aria-label="Sources">
      <div className={k.wrap}>
        <button type="button" className={a.pill} aria-expanded={open} aria-controls="source-list" onClick={() => setOpen((v) => !v)}>
          <span className={a.avatars} aria-hidden="true">
            {p.sources.slice(0, 6).map((s) => (
              <Mark key={s.outlet} s={s} />
            ))}
          </span>
          {/* a real space between the marks and the count: the pill is a flex row, so it draws nothing, but
              a reader that takes only the text gets "6 sources", never a letter run into the number (BUG-832) */}
          {" "}
          <span>
            {n} {n === 1 ? "source" : "sources"}
          </span>
          <Icon name="chevron" size={12} className={a.chev} />
        </button>
        {open && (
          <ul id="source-list" className={a.srcList}>
            {p.sources.map((s) => (
              <li key={s.outlet}>
                {s.url ? (
                  <a href={s.url} target="_blank" rel="noopener noreferrer nofollow">
                    {s.icon && <Mark s={s} />}
                    {s.outlet}
                  </a>
                ) : (
                  <span>
                    {s.icon && <Mark s={s} />}
                    {s.outlet}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
