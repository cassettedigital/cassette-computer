"use client";

/**
 * The opener: the record as the one object on the first screen. Its cover lit in its own colour on the
 * dark paper (the shared cover glow, the one the artist header uses), and beside it the lockup: the
 * title, the artist (into the prototype's artist page), the facts as the shared labelled boxes, the
 * critics strip when a studio record has earned it (each outlet's mark and its grade, plain type), then
 * the buttons, one height: Preview album (one line, the words the artist page's records panel uses;
 * the kit's HearIt, drawn by the shared play button), Buy, one word (BuyMenu.tsx), and on the website
 * Want it, a square key (WantIt.tsx). The apps have no wishlist to show it in, so there it stays off
 * (Q5). Nothing moves on load but the cover, which fades in over its plain sleeve as it lands (founder, 2026-11-11). Inside the iPhone app the top reads like the app's own album screen (album.module.css,
 * the app block): the cover centred, the title a size down, the artist in the record's colour, the facts as one line,
 * and Preview and Buy as two equal halves, as its Play and Shuffle are.
 */

import type { CSSProperties, MouseEvent } from "react";
import Link from "next/link";
import { AlbumCover } from "@/app/components/AlbumCover";
import { CoverGlow } from "@/app/_taste/CoverGlow";
import { Facts } from "@/app/_taste/Facts";
import { GradeChip, OutletMark } from "@/app/_taste/Quote";
import k from "@/app/_taste/taste.module.css";
import { HearIt } from "@/app/_taste/HearIt";
import { artistHref } from "@/app/_taste/links";
import type { StripItem } from "@/app/(taste)/_kit/types";
import type { Surface } from "@/lib/app-surface";
import { useReadAll } from "./AlbumBody";
import { BuyMenu } from "./BuyMenu";
import { WantIt } from "./WantIt";
import { factLine } from "./shape";
import type { AlbumPage } from "./types";
import a from "./album.module.css";

function Strip({ items, opens }: { items: StripItem[]; opens: boolean }) {
  const { setOpen } = useReadAll();
  const jump = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (opens) setOpen(true);
    document.getElementById("press")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <button type="button" className={a.strip} onClick={jump} aria-label="What the critics gave it: jump to the press">
      {items.map((x) => (
        <span key={x.outlet} className={a.stripItem} title={x.outlet}>
          {x.icon ? <OutletMark icon={x.icon} name={x.outlet} size={20} /> : <span className={a.stripName}>{x.outlet}</span>}
          <GradeChip glyph={x.glyph} title={`${x.outlet} gave it ${x.glyph}`} />
        </span>
      ))}
    </button>
  );
}

export function Opener({ p, surface }: { p: AlbumPage; surface: Surface }) {
  // the start song, then the rest of the record in running order, wrapping round to the first song
  const startAt = p.playables.findIndex((x) => x.trackId === p.startTrackId);
  const hasHear = startAt >= 0;
  const hasBuy = p.buy.options.length > 0;
  return (
    <section className={a.opener} data-nocover={!p.cover || undefined} aria-labelledby="album-title">
      <div className={`${k.wrap} ${a.openGrid}`}>
        {p.cover && (
          <div className={a.coverCol}>
            <CoverGlow src={p.coverSmall ?? p.cover} />
            <div className={a.coverFrame}>
              <AlbumCover
                bare
                imageUrl={p.cover}
                title={`${p.title} by ${p.artist}, the cover`}
                size={470}
                sizes="(max-width: 760px) 300px, 470px"
                priority
                loading="eager"
                decoding="sync"
              />
            </div>
          </div>
        )}
        <div className={a.lockup}>
          <h1 id="album-title" className={a.title} style={{ "--word": p.titleWord, "--len": p.title.length, "--max": `${p.titleMax}px` } as CSSProperties}>
            {p.title}
          </h1>
          <p className={a.artist}>
            <Link href={artistHref(p.artistSlug)}>{p.artist}</Link>
          </p>
          {/* in the iPhone app, its own album screen's one line (the founder, 2026-10-31: the record page
              opened from the radio shouldn't feel like another app) */}
          {surface === "app" ? (
            p.facts.length > 0 && <p className={a.factLine}>{factLine(p.facts)}</p>
          ) : (
            <Facts facts={p.facts} className={a.facts} />
          )}
          {p.strip.length > 0 && <Strip items={p.strip} opens={p.stripOpens} />}
          <div className={a.actions} data-single={!hasHear || !hasBuy || undefined}>
            <HearIt playables={p.playables} startIndex={startAt} verb={surface === "app" ? "Preview" : undefined} />
            {hasBuy && <BuyMenu slug={p.slug} options={p.buy.options} pick={p.buy.pick} apple={p.buy.apple} signedIn={p.signedIn} surface={surface} />}
            {surface === "web" && <WantIt albumId={p.albumId} slug={p.slug} signedIn={p.signedIn} initial={p.wishlisted} />}
          </div>
        </div>
      </div>
    </section>
  );
}
