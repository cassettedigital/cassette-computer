"use client";

/**
 * The artist page's body: the header and the records on the press paper, then our own sections (songs,
 * Known for, artists like them) on one unbroken run of the flat stock, then the photo's credit when one
 * is owed. Artists like may come as `like`, a promise the server is still working out: it streams in last, so
 * the page shows without waiting on it (the desk hands it in `p`, whole). The lead record's colour, read off its cover (the same accent its own page shows), is the
 * page's record colour: it fills the Known for bars and lights the View menu's current row. `surface` is
 * the window it is drawn in: the claim line is the website's alone, as an album's share key is (the founder's
 * Decision 6, lib/app-surface.ts); the artist's Save key is in every window (the founder, 2026-11-23, board #1162).
 */

import { Suspense, use, useCallback, useState } from "react";
import { InlineLink } from "@/app/_taste/Button";
import { BRASS, accentVars, useCoverColours } from "@/app/_taste/colour";
import { useRailAccent } from "@/app/_taste/player";
import type { Surface } from "@/lib/app-surface";
import k from "@/app/_taste/taste.module.css";
import { ArtistsLike } from "./ArtistsLike";
import { Intro } from "./Intro";
import { KnownFor } from "./KnownFor";
import { Records } from "./Records";
import { Songs } from "./Songs";
import type { ArtistPayload, PhotoCredit } from "../_lib/types";
import { cleanPhotoCredit } from "@/lib/photo-credit";
import s from "./artist.module.css";
import { ArtistRowsSkeleton } from "@/app/_taste/ArtistRows";
import { SectionHead } from "@/app/_taste/SectionHead";
import { Skeleton } from "@/app/_taste/Skeleton";

/** "Photo: Gruesome Gary · CC BY-SA 4.0 · Wikimedia Commons" (artist-taste/a/[slug]/Opener.tsx:135-159). */
function Credit({ c }: { c: PhotoCredit }) {
  // BUG-482: rows stored before the cleaner existed still carry Commons file names and "( talk )" links.
  const author = cleanPhotoCredit(c.author);
  return (
    <p className={s.credit}>
      Photo{author ? `: ${author}` : ""}
      {c.license && (
        <>
          {" · "}
          {c.licenseUrl ? (
            <InlineLink href={c.licenseUrl} target="_blank" rel="noopener noreferrer">
              {c.license}
            </InlineLink>
          ) : (
            c.license
          )}
        </>
      )}
      {c.sourceUrl && (
        <>
          {" · "}
          <InlineLink href={c.sourceUrl} target="_blank" rel="noopener noreferrer">
            Wikimedia Commons
          </InlineLink>
        </>
      )}
    </p>
  );
}

/**
 * The page's last line for an artist who hasn't claimed it: the way in, the old page's footer link, said
 * once (the founder's claim-as-request: a claim is a request we review). Pending says where it stands.
 */
function Claim({ slug, name, claim }: { slug: string; name: string; claim: ArtistPayload["creator"]["claim"] }) {
  if (claim === "verified") return null;
  return (
    <p className={s.credit}>
      {claim === "pending" ? (
        "A claim on this page is being reviewed."
      ) : (
        <>
          Are you {name}? <InlineLink href={`/claim/${slug}`}>Claim this page</InlineLink>
        </>
      )}
    </p>
  );
}

type Like = Pick<ArtistPayload, "similar" | "likeBy" | "likeFor">;

/** Artists like, once the server has it. `band`: no songs or Known for came before it, so it brings its own run of
 *  the flat stock (and nothing at all when the list is empty). */
function LikeShelf({ name, like, band }: { name: string; like: Promise<Like>; band: boolean }) {
  const { similar, likeBy, likeFor } = use(like);
  if (similar.length === 0) return null;
  const shelf = <ArtistsLike name={name} rows={similar} by={likeBy} fans={likeFor} />;
  return band ? <div className={`${k.own} ${s.ownRun}`}>{shelf}</div> : shelf;
}

/** Artists like while the server works it out: its head and its rows as the shared skeleton's bones, in the
 *  shelf's own section, so the shelf lands where they stood instead of appearing from nothing under the page. */
function LikeShelfWaiting({ band }: { band: boolean }) {
  const shelf = (
    <section className={s.ownSec} aria-busy="true" aria-label="Artists like them, on their way">
      <div className={k.wrap}>
        <SectionHead id="like-waiting" size="small">
          <Skeleton shape="text" w="min(15em, 70%)" />
        </SectionHead>
        <ArtistRowsSkeleton big />
      </div>
    </section>
  );
  return band ? <div className={`${k.own} ${s.ownRun}`}>{shelf}</div> : shelf;
}

export function ArtistBody({ p, like, surface = "web" }: { p: ArtistPayload; like?: Promise<Like>; surface?: Surface }) {
  // colours are read for the lead record, then for each record a person points at or opens
  const [wanted, setWanted] = useState<string[]>([]);
  const want = useCallback((slug: string) => setWanted((w) => (w.includes(slug) ? w : [...w, slug])), []);
  const colours = useCoverColours(
    p.records.map((r) => ({ key: r.slug, src: r.coverSmall ?? r.cover })),
    [p.leadSlug, ...wanted],
  );
  // the paper's brass is no colour at all (a grey or missing cover): the page keeps the brass
  const read = p.leadSlug ? colours[p.leadSlug] : undefined;
  const lead = read && read.toLowerCase() !== BRASS ? read : undefined;
  const style = lead ? accentVars(lead) : undefined;
  useRailAccent(lead);
  const [photoGone, setPhotoGone] = useState(false);
  const onPhotoGone = useCallback(() => setPhotoGone(true), []);
  const ours = p.songs.length + p.known.length + (like ? 0 : p.similar.length) > 0;
  const shelf = like ? (
    <Suspense fallback={<LikeShelfWaiting band={!ours} />}>
      <LikeShelf name={p.name} like={like} band={!ours} />
    </Suspense>
  ) : p.similar.length > 0 ? (
    <ArtistsLike name={p.name} rows={p.similar} by={p.likeBy} fans={p.likeFor} />
  ) : null;
  const credit = p.photo && !photoGone ? p.credit : null;
  return (
    <div className={s.page} style={style}>
      <Intro p={p} onPhotoGone={onPhotoGone} surface={surface} />
      {p.records.length > 0 && <Records p={p} colours={colours} onWant={want} surface={surface} />}
      {ours && (
        <div className={`${k.own} ${s.ownRun}`}>
          {p.songs.length > 0 && <Songs songs={p.songs} />}
          {p.known.length > 0 && <KnownFor rows={p.known} />}
          {shelf}
        </div>
      )}
      {!ours && shelf}
      <div className={`${k.ed} ${s.foot}`}>
        <div className={k.wrap}>
          {credit && <Credit c={credit} />}
          {surface === "web" && <Claim slug={p.slug} name={p.name} claim={p.creator.claim} />}
        </div>
      </div>
    </div>
  );
}
