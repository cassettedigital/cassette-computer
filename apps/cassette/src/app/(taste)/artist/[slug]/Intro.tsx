"use client";

/**
 * 1. The header, the same for every artist whatever their photos are like. Their records carry it: the
 * three most central studio album covers, whole, in a small fanned stack lit softly from behind by the
 * front cover's glow (right on a wide page, on top on a phone); pointing at a cover names it and its year
 * in the line kept under the stack. Beside them the facts with the photo as a small circle when there is
 * one (its count of photos shows when it is pointed at), the name huge and fitted to its column, the
 * first sentence or two of their Wikipedia article credited under it the way a press quote is, then
 * Preview (their best-known songs, then every album, most popular first) and the artist's one key, Save or Following
 * (ArtistKey: the ladder, the same in every window; `surface` says where a press came from).
 * Where previews come from is the dock's to say. Nothing moves on load. Below 760 (phones included), with the
 * covers on top, everything under them is centred on their line, as the album page's top is (the founder,
 * 2026-11-17), the buttons a centred ActionRow.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { ActionRow } from "@/app/_taste/ActionRow";
import { ArtistGallery } from "@/app/_taste/ArtistGallery";
import { AlbumCover } from "@/app/components/AlbumCover";
import { ArtistPhoto } from "@/app/components/ArtistPhoto";
import { coverClass } from "@/app/_taste/Cover";
import { CoverGlow } from "@/app/_taste/CoverGlow";
import { Facts } from "@/app/_taste/Facts";
import { Icon } from "@/app/_taste/Icon";
import { PlayButton } from "@/app/_taste/PlayButton";
import { Byline } from "@/app/_taste/Quote";
import k from "@/app/_taste/taste.module.css";
import { albumHref } from "@/app/_taste/links";
import type { Playable } from "@/app/_taste/play";
import { usePlayer } from "@/app/_taste/player";
import type { Surface } from "@/lib/app-surface";
import { ArtistKey } from "./ArtistKey";
import { useFitName } from "./useFitName";
import { previewOf, type PreviewQueue } from "../_lib/rules";
import type { ArtistPayload, HeaderPhoto, StackCover } from "../_lib/types";
import s from "./artist.module.css";

/**
 * Preview: one queue from the top, on the shared play button, one line ("Preview Radiohead"; the song's
 * name means nothing to someone who doesn't know the band): their best-known songs, then every album, most
 * popular first, without a song twice (previewOf). An artist with no best-known songs yet starts on their
 * lead album. While any of those songs is docked it says Playing or Paused and pauses or resumes.
 */
function Preview({ name, hear }: { name: string; hear: PreviewQueue<Playable> }) {
  const { track, playList, status, toggle } = usePlayer();
  const mine = !!track && hear.queue.some((x) => x.trackId === track.trackId);
  const start = hear.first ?? "their best-known songs";
  // `records` counts the record it starts on when there are no best-known songs
  const more = hear.records > (hear.first ? 1 : 0);
  const what = more ? `${start}, then ${hear.first ? "their other albums" : "their albums"}` : start;
  return (
    <PlayButton
      state={mine ? status : "idle"}
      verb={`Preview ${name}`}
      short="Preview"
      aria-pressed={mine && status === "playing"}
      aria-label={!mine ? `Preview ${name}: ${what}, from YouTube` : status === "paused" ? `Resume ${name}` : `Pause ${name}`}
      onClick={() => (mine ? toggle() : playList(hear.queue, 0))}
    />
  );
}

/** The photo as a small circle; with 2 or more photos it opens the lightbox. A photo that fails is simply gone. */
function Photo({ photo, name, gallery, onGone }: { photo: HeaderPhoto; name: string; gallery: ArtistPayload["gallery"]; onGone: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  // a raw Commons file: its small thumbnail first, then the file itself
  const [src, setSrc] = useState(photo.thumb ?? photo.src);
  const failRaw = () => {
    if (src !== photo.src) setSrc(photo.src);
    else onGone();
  };
  // an image that failed before the page hydrated never fired onError: find it once mounted
  useEffect(() => {
    const img = ref.current?.querySelector("img");
    if (img && img.complete && img.naturalWidth === 0 && !photo.renderable) failRaw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <span ref={ref} className={s.photo}>
      <span className={s.photoClip}>
        {photo.renderable ? (
          <ArtistPhoto imageUrl={photo.src} name={name} bare sizes="80px" priority onError={onGone} />
        ) : (
          // a raw Commons file: not on next/image's allowlist, so a plain image, as the gallery's lightbox shows it
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={name} loading="eager" decoding="async" referrerPolicy="no-referrer" onError={failRaw} />
        )}
      </span>
      {gallery.length >= 2 && (
        <>
          <ArtistGallery images={gallery} artistName={name} />
          {/* the count, only when the photo is pointed at or focused (always on a touch screen) */}
          <span className={s.photoCount} aria-hidden="true">
            <Icon name="photos" size={12} />
            {gallery.length}
          </span>
        </>
      )}
    </span>
  );
}

/**
 * The covers, front first, fanned, lit by the front cover's glow; each a door into its record. Pointing
 * at one (or focusing it) names it and its year in the caption line under the stack, which is kept
 * whether or not anything is named, so nothing below it moves. A cover that fails leaves the stack. Each
 * is resized for the fan by the image optimizer, never the original upload.
 */
function Stack({ covers }: { covers: StackCover[] }) {
  const [gone, setGone] = useState<Set<string>>(() => new Set());
  // the cover named last, kept so its caption can fade out, and whether it is pointed at now
  const [named, setNamed] = useState<{ c: StackCover; on: boolean } | null>(null);
  const drop = (slug: string) => setGone((g) => (g.has(slug) ? g : new Set(g).add(slug)));
  const shown = covers.filter((c) => !gone.has(c.slug));
  if (shown.length === 0) return null;
  const front = shown[0];
  const name = (c: StackCover) => () => setNamed({ c, on: true });
  const unname = (c: StackCover) => () => setNamed((n) => (n && n.c.slug === c.slug ? { c, on: false } : n));
  return (
    <div className={s.stackBox}>
      <div className={s.stack} data-n={shown.length}>
        {front.small && <CoverGlow src={front.small} soft />}
        {/* front first, so the front cover is the first door in tab order; the CSS lays them back to front */}
        {shown.map((c, i) => (
          <Link
            key={c.slug}
            href={albumHref(c.slug)}
            className={`${coverClass} ${s.stackCover}`}
            data-at={i}
            aria-label={c.year ? `${c.title}, ${c.year}` : c.title}
            onPointerEnter={name(c)}
            onPointerLeave={unname(c)}
            onFocus={name(c)}
            onBlur={unname(c)}
          >
            <AlbumCover bare imageUrl={c.src} title="" sizes="(max-width: 760px) 45vw, 260px" priority={i === 0} loading="eager" onError={() => drop(c.slug)} />
          </Link>
        ))}
      </div>
      <p className={s.stackCap} data-on={named?.on || undefined} aria-hidden="true">
        {named && (
          <>
            <span className={`${k.caption} ${s.stackTitle}`}>{named.c.title}</span>
            {named.c.year && <span className={`${k.meta} ${s.stackYear}`}>{named.c.year}</span>}
          </>
        )}
      </p>
    </div>
  );
}

export function Intro({ p, onPhotoGone, surface }: { p: ArtistPayload; onPhotoGone: () => void; surface: Surface }) {
  const nameRef = useRef<HTMLHeadingElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const lines = useFitName(nameRef, measureRef, p.name);
  const [photoGone, setPhotoGone] = useState(false);
  const hear = previewOf(
    p.songs.map((x) => x.play),
    p.records,
    p.albums,
  );
  const photo = p.photo && !photoGone ? p.photo : null;
  const gone = () => {
    setPhotoGone(true);
    onPhotoGone();
  };
  return (
    <header className={`${k.ed} ${s.intro}`} data-art={p.stack.length > 0 || undefined}>
      <div className={k.wrap}>
        <div className={s.introGrid}>
          {p.stack.length > 0 && <Stack covers={p.stack} />}
          <div className={s.introText}>
            {(photo || p.facts.length > 0) && (
              <div className={s.factsRow}>
                {photo && <Photo photo={photo} name={p.name} gallery={p.gallery} onGone={gone} />}
                <Facts facts={p.facts} />
              </div>
            )}
            <h1 ref={nameRef} className={s.name} style={{ "--L": p.name.length } as CSSProperties}>
              {lines.map((l) => (
                <span key={l} className={s.nameLine}>
                  {l}
                </span>
              ))}
            </h1>
            <span ref={measureRef} className={s.measure} aria-hidden="true" />
            {p.lead && (
              <>
                <p className={s.lead}>{p.lead.text}</p>
                {/* credited the way a press quote is: the outlet's mark, its name, the way out; an artist's own
                    intro is credited to them */}
                <div className={s.leadBy}>
                  <Byline by={{ outlet: p.lead.by === "artist" ? p.name : "Wikipedia", url: p.lead.url, icon: null }} mark={20} />
                </div>
              </>
            )}
            <ActionRow className={s.acts} centred>
              {hear && <Preview name={p.name} hear={hear} />}
              <ArtistKey slug={p.slug} name={p.name} source={surface === "web" ? "artist_page" : surface === "desk" ? "desk" : "ios"} app={surface !== "web"} />
            </ActionRow>
            {/* a claimed artist's own places: their site, their socials */}
            {p.creator.links.length > 0 && (
              <ul className={s.links}>
                {p.creator.links.map((l) => (
                  <li key={l.key}>
                    <a className={`${k.label} ${s.linkOut}`} href={l.href} target="_blank" rel="noopener noreferrer">
                      {l.label}
                      <Icon name="out" size={12} />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
