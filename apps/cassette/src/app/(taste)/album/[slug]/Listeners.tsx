"use client";

/**
 * Listeners: what people who play this record on Cassette said about it, in their own section of the reviews
 * area, after the press and never mixed with it or with our writers' reviews (the founder, 2026-11-08). Each
 * one is the stars they gave, their few lines, and their name, which goes to their page. Only reviews they
 * chose to make public (lib/writing/reviews.ts); no average, no count of stars. Newest first, a handful shown
 * and the rest a key away.
 */

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/app/_taste/Button";
import { SectionHead } from "@/app/_taste/SectionHead";
import { Stars } from "@/app/_taste/writing/Stars";
import k from "@/app/_taste/taste.module.css";
import type { AlbumPage, ListenerReview } from "./types";
import a from "./album.module.css";
import l from "./listeners.module.css";

const FIRST = 6;

/** "November 8, 2026", the same on the server and in the browser. */
const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
};

function One({ v }: { v: ListenerReview }) {
  return (
    <figure className={l.review}>
      {v.words.length > 0 && (
        <blockquote className={l.words}>
          {v.words.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </blockquote>
      )}
      <figcaption className={l.by}>
        <Stars score={v.score} />
        <Link className={l.name} href={v.href}>
          {v.name}
        </Link>
        <span className={l.date}>{day(v.date)}</span>
        {v.more && (
          <Link className={l.rest} href={v.piece}>
            Read all of it
          </Link>
        )}
      </figcaption>
    </figure>
  );
}

export function Listeners({ p }: { p: AlbumPage }) {
  const [all, setAll] = useState(false);
  const list = p.listeners ?? [];
  if (list.length === 0) return null;
  const shown = all ? list : list.slice(0, FIRST);
  return (
    <section id="listeners" className={`${k.ed} ${a.section}`} aria-labelledby="listeners-head">
      <div className={k.wrap}>
        <SectionHead id="listeners-head">Listeners.</SectionHead>
        <ul className={l.list}>
          {shown.map((v) => (
            <li key={v.piece}>
              <One v={v} />
            </li>
          ))}
        </ul>
        {list.length > FIRST && !all && (
          <div className={l.moreRow}>
            <Button look="outlined" onClick={() => setAll(true)}>
              {`Show ${list.length - FIRST} more`}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
