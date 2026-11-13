/**
 * 4. Known for: what their sound is made of, by weight, as the Known For picker ranks it, with up to
 * three of the records that show each trait most; every cover is a door into that record's page here.
 * The weight is the shared measured bar (the album meter's own), in the lead record's colour. The bars
 * are the page's one focal motion: they fill once when the list scrolls in (the shell marks it
 * data-shown), and stand full at once for anyone who asks for less motion.
 */

import type { CSSProperties } from "react";
import Link from "next/link";
import { Measure } from "@/app/_taste/Measure";
import { SectionHead } from "@/app/_taste/SectionHead";
import { Sleeve } from "@/app/_taste/Sleeve";
import k from "@/app/_taste/taste.module.css";
import { albumHref } from "@/app/_taste/links";
import type { KnownRow } from "../_lib/types";
import s from "./artist.module.css";

export function KnownFor({ rows }: { rows: KnownRow[] }) {
  return (
    <section className={s.ownSec} aria-labelledby="known-title">
      <div className={k.wrap}>
        <SectionHead id="known-title" size="small">
          Known for.
        </SectionHead>
        <ol className={s.known} data-reveal style={{ "--rows": Math.ceil(rows.length / 2) } as CSSProperties}>
          {rows.map((row, i) => (
            <li key={row.id}>
              <span className={s.trait}>
                {row.label}
                <small>{row.category}</small>
              </span>
              {row.exemplars.length > 0 && (
                <span className={s.exemplars}>
                  {row.exemplars.map((e) => (
                    <Link key={e.slug} href={albumHref(e.slug)} title={e.title} aria-label={e.title}>
                      <Sleeve src={e.cover} title={e.title} small />
                    </Link>
                  ))}
                </span>
              )}
              <span className={s.weight}>
                <Measure to={row.weight} i={i} />
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
