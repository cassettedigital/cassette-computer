"use client";

/**
 * A record on Discover that the person already owns, as the window drawing the page says it (the desktop app's
 * Discover, desk/Discover.tsx). Nothing provides it on the website, so there every record is the catalog's.
 *
 * In the app a record of yours plays your own copy from your computer (the window's player, never a preview),
 * its picture looks into it in the side view, its name opens your copy, and a right click is the record's own
 * menu, as on every other shelf of the window. A record you don't own stays as the website draws it: its name
 * and picture open its page, and its key plays the preview.
 */

import Link from "next/link";
import { createContext, useContext, type MouseEvent } from "react";
import type { TilePlay } from "@discovery/cassette-kit";
import { buttonClass } from "@/app/_taste/Button";
import { HearIt } from "@/app/_taste/HearIt";
import { albumHref } from "@/app/_taste/links";
import { PlayButton, type PlayState } from "@/app/_taste/PlayButton";
import { BuyMenu } from "@/app/(taste)/album/[slug]/BuyMenu";
import type { Surface } from "@/lib/app-surface";
import type { DiscoverHero } from "./view";

export type OwnedHere = {
  /** your copy's play key: play it, or pause and resume while it is the one on */
  play: TilePlay;
  /** a song of your copy is playing */
  playing: boolean;
  /** the same, for the shared play button: idle, starting, playing or paused */
  status: PlayState;
  /** the picture looks into it in the side view */
  selected?: boolean;
  onSelect?: (e: MouseEvent) => void;
  /** the record's own menu */
  onMenu?: (e: MouseEvent) => void;
};

const OwnedCtx = createContext<((slug: string) => OwnedHere | null) | null>(null);

export const DiscoverOwnedProvider = OwnedCtx.Provider;

/** Your copy of a record on this page, or null (not yours, or the website). */
export function useOwnedHere(): (slug: string) => OwnedHere | null {
  return useContext(OwnedCtx) ?? none;
}
const none = () => null;

/**
 * A top pick's keys, the album page's own on the shared one-line row: Preview album (the record from its first song we
 * can play), then See the record, then Buy, drawn with the person's own store when they have one. A record the person
 * owns, in the app, plays their own copy instead ("Play"), and its page is their copy.
 */
export function PickKeys({ p, signedIn, surface }: { p: DiscoverHero; signedIn: boolean; surface: Surface }) {
  const yours = useOwnedHere()(p.slug);
  const play = yours ? (
    <PlayButton state={yours.status} verb="Play" aria-pressed={yours.status === "playing"} aria-label={yours.play.label} onClick={yours.play.onClick} />
  ) : p.playables.length > 0 ? (
    <HearIt playables={p.playables} startIndex={0} record={p.title} />
  ) : null;
  return (
    <>
      {play}
      <Link className={buttonClass(play ? "outlined" : "filled")} href={albumHref(p.slug)}>
        See the record
      </Link>
      {p.buy.options.length > 0 && <BuyMenu slug={p.slug} options={p.buy.options} pick={p.buy.pick} apple={p.buy.apple} signedIn={signedIn} surface={surface} />}
    </>
  );
}
