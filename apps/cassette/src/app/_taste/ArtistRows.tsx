"use client";

/**
 * Artists as rows: a face (their photo as a small circle, or with no photo their best-known cover, square,
 * as covers are), their name, and one line under it (what they share with someone, or their genre). Each
 * row is a door to their page. Promoted from the artist page's "Artists like them".
 *
 * One column on a phone, two from 760, three from 1100, and by default never a short last row (the
 * founder, 2026-10-21): at each column count the list shows the most that fill whole rows. The cut is
 * worked out here for every count at once, and the CSS hides the extras at the width that uses it.
 * `wholeRows={false}` (results: search) shows every artist. `single` keeps one column at every width, for a
 * narrow column (the claim page's artist). `twoLines` lets the line under the name wrap to a second line (the
 * Sounds like shelf's reasons) instead of cutting off. `big` is the focal size, for a list that is a section's
 * whole point rather than a note beside it (the artist page's "If you like X for their ___"): bigger faces and
 * names. No rules between rows, as everywhere in the kit (the 2026-11-04 ruled rows were taken out 2026-11-06).
 */

import { useState } from "react";
import Link from "next/link";
import { Skeleton } from "./Skeleton";
import { ArtistPhoto } from "@/app/components/ArtistPhoto";
import { Sleeve } from "./Sleeve";
import { artistHref } from "./links";
import { fullRows } from "./rows";
import a from "./artists.module.css";

export type ArtistRow = { slug: string; name: string; photo: string | null; cover?: string | null; line?: string };

function Face({ r }: { r: ArtistRow }) {
  const [photoGone, setPhotoGone] = useState(false);
  if (r.photo && !photoGone) {
    return (
      <span className={a.face} data-kind="photo">
        <ArtistPhoto imageUrl={r.photo} name={r.name} bare sizes="64px" onError={() => setPhotoGone(true)} />
      </span>
    );
  }
  return (
    <span className={a.face} data-kind="cover">
      <Sleeve src={r.cover ?? null} title={r.name.replace(/^the\s+/i, "")} small />
    </span>
  );
}

export function ArtistRows({
  rows,
  wholeRows = true,
  single = false,
  twoLines = false,
  big = false,
}: {
  rows: ArtistRow[];
  wholeRows?: boolean;
  single?: boolean;
  twoLines?: boolean;
  big?: boolean;
}) {
  const in2 = wholeRows && !single ? fullRows(rows.length, 2) : rows.length;
  const in3 = wholeRows && !single ? fullRows(rows.length, 3) : rows.length;
  return (
    <ul className={[a.rows, single && a.single, big && a.big].filter(Boolean).join(" ")}>
      {rows.map((r, i) => (
        <li key={r.slug} data-past2={i >= in2 || undefined} data-past3={i >= in3 || undefined}>
          <Link className={a.link} href={artistHref(r.slug)}>
            <Face r={r} />
            <span className={a.text}>
              <span className={a.name}>{r.name}</span>
              {r.line ? <span className={a.line} data-two={twoLines || undefined}>{r.line}</span> : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The rows on their way (an artist's Artists like while the server works it out): the same grid, each row its
 *  face and name as the shared skeleton's bones, so the list lands where they stood. */
export function ArtistRowsSkeleton({ count = 12, big = false }: { count?: number; big?: boolean }) {
  const in2 = fullRows(count, 2);
  const in3 = fullRows(count, 3);
  return (
    <ul className={[a.rows, big && a.big].filter(Boolean).join(" ")} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} data-past2={i >= in2 || undefined} data-past3={i >= in3 || undefined}>
          <span className={a.link}>
            <span className={a.face} data-kind="photo" style={{ background: "transparent" }}>
              <Skeleton shape="circle" w="100%" />
            </span>
            <span className={a.text}>
              <span className={a.name}>
                <Skeleton shape="text" w={`${[62, 48, 70, 55, 66, 44][i % 6]}%`} />
              </span>
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
