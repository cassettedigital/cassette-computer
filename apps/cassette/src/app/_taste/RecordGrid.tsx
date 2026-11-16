"use client";

/**
 * Records as a grid of covers: the shared cover (its shadow, its hover lift, 2px corners), the record with
 * no cover typeset in its sleeve, the one caption under it (the title, then "ARTIST · YEAR" or a line the
 * page chooses), and, when the page says why a record is here, that in the caption type. Every cover is a
 * door to its album page. Two columns on a phone, three from 560, four from 760, six from 1100. With
 * `wholeRows` (a curated row) it never ends on a short row: at each count it shows the most that fill
 * whole rows; `rows` caps it at that many rows (a shelf of one or two). Results (search) show every record.
 * A record can carry a figure (`stat`, a station's plays of it this month), shown over its cover only while
 * it is pointed at: the number large over a dimmed cover, its word under it (the founder, 2026-11-16).
 */

import Link from "next/link";
import { CoverArt, CoverCaption } from "./Cover";
import { Sleeve } from "./Sleeve";
import { albumHref } from "./links";
import { fullRows } from "./rows";
import r from "./records.module.css";

export type RecordTile = {
  slug: string;
  title: string;
  cover: string | null;
  /** the caption's second line, usually "ARTIST · YEAR" */
  meta?: string;
  /** a short sentence under the caption: why this record is here */
  note?: string;
  /** a figure shown over the cover while it's pointed at (a station's plays of it this month): the number
      large, its word small under it. Said aloud after the caption. */
  stat?: { value: string; word: string };
};

export function RecordGrid({
  records,
  priority = 0,
  wholeRows = false,
  rows,
}: {
  records: RecordTile[];
  /** how many covers load first */
  priority?: number;
  /** show only whole rows at each column count */
  wholeRows?: boolean;
  /** at most this many rows at each column count (whole rows) */
  rows?: number;
}) {
  const n = records.length;
  const at = (c: number) => (rows ? Math.min(fullRows(n, c), c * rows) : wholeRows ? fullRows(n, c) : n);
  const cut = { 2: at(2), 3: at(3), 4: at(4), 6: at(6) };
  return (
    <ul className={r.grid}>
      {records.map((rec, i) => (
        <li key={rec.slug} data-past2={i >= cut[2] || undefined} data-past3={i >= cut[3] || undefined} data-past4={i >= cut[4] || undefined} data-past6={i >= cut[6] || undefined}>
          <Link className={r.tile} href={albumHref(rec.slug)}>
            <CoverArt>
              <Sleeve src={rec.cover} title={rec.title} sizes="(max-width: 560px) 45vw, 200px" loading={i < priority ? "eager" : "lazy"} />
              {rec.stat ? (
                <span className={r.stat} aria-hidden="true">
                  <span className={r.statValue}>{rec.stat.value}</span>
                  <span className={r.statWord}>{rec.stat.word}</span>
                </span>
              ) : null}
            </CoverArt>
            <CoverCaption title={rec.title} meta={rec.meta} />
            {rec.stat ? <span className={r.say}>, {`${rec.stat.value} ${rec.stat.word}`}</span> : null}
            {rec.note ? <span className={r.note}>{rec.note}</span> : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}
