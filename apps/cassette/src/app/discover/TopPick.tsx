/**
 * The top pick on the taste paper, shared by the Discover feed and every Discover station: the cover, and
 * beside it (under it on a phone) why it is here in the label type, the title in the head role linking to
 * the record, the artist and the year, a verified critic's line (the kit's Quote) when there is one and
 * nothing in its place when there isn't (never words of ours, 2026-11-10), and the keys the page passes in
 * (the record's page, the Buy menu, a play key) on the shared one-line ActionRow. No card around it.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { ActionRow } from "@/app/_taste/ActionRow";
import { CoverArt } from "@/app/_taste/Cover";
import { Quote } from "@/app/_taste/Quote";
import { Sleeve } from "@/app/_taste/Sleeve";
import { albumHref } from "@/app/_taste/links";
import type { ReviewLine } from "@/lib/discovery/review-line-pick";
import p from "./toppick.module.css";

export function TopPick({
  id,
  slug,
  title,
  cover,
  kicker,
  artist,
  meta,
  line,
  actions,
}: {
  /** the title's id, for the section's label */
  id: string;
  slug: string;
  title: string;
  cover: string | null;
  /** why it is here ("Top of the rotation", the feed's reason) */
  kicker: string;
  artist: { name: string; href: string };
  /** what follows the artist: the year, the genre */
  meta?: string;
  /** a verified critic's line about the record, when we have one */
  line: ReviewLine | null;
  actions: ReactNode;
}) {
  return (
    <section className={p.pick} aria-labelledby={id}>
      <Link className={p.cover} href={albumHref(slug)} tabIndex={-1} aria-hidden="true">
        <CoverArt>
          <Sleeve src={cover} title={title} sizes="(max-width: 760px) 90vw, 400px" loading="eager" />
        </CoverArt>
      </Link>
      <div className={p.text}>
        <p className={p.why}>{kicker}</p>
        <h2 id={id} className={p.title}>
          <Link href={albumHref(slug)}>{title}</Link>
        </h2>
        <p className={p.by}>
          <Link href={artist.href}>{artist.name}</Link>
          {meta ? <span> · {meta}</span> : null}
        </p>
        {line ? <Quote size="inline" quote={line.quote} by={{ outlet: line.publication, url: line.url, icon: null }} /> : null}
        <ActionRow className={p.actions}>{actions}</ActionRow>
      </div>
    </section>
  );
}
