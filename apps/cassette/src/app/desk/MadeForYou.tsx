"use client";

/**
 * The made-for-you playlists in the desk (mixes.ts): a tile for the Home row and the Playlists
 * page, a cover, a menu, and a page. A mood mix wears its drawn cover for the day, moving under
 * the pointer as on the phone's row; Lately, the time-of-day playlist and Been a While show four
 * of their records, as the phone's tiles do.
 */

import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { Glyph, Hero, Pills, PlayPill, ShufflePill, SongTable, Tile, useContextMenu, type MenuItem } from "@discovery/cassette-kit";
import { LiveCover } from "@/app/components/LiveCover";
import { mixCoverUrl } from "@/lib/covers/mix";
import { useShell } from "@/app/dashboard/_shell/shell-context";
import { Art, trackCovers } from "./Art";
import { useAside } from "./DeskShell";
import { useOwned } from "./owned";
import { createPlaylist } from "./playlists";
import { dragSongs } from "./drag";
import { useQueueLines, useSongsMenu } from "./Shelves";
import { deskMix, useMix, type DeskMix } from "./mixes";
import { deskAlbum, deskArtist, deskPlaylist, type OwnedTrack } from "./types";
import { PageBar, usePageBar } from "./PageBar";
import d from "./desk.module.css";

const songWord = (n: number) => `${n} ${n === 1 ? "song" : "songs"}`;
const len = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : null);

/** "30 songs · 1 hr 52 min" */
export function mixFacts(m: DeskMix): string {
  const minutes = Math.round(m.songs.reduce((n, x) => n + (x.seconds ?? 0), 0) / 60);
  const time = minutes >= 60 ? `${Math.floor(minutes / 60)} hr ${minutes % 60} min` : minutes ? `${minutes} min` : null;
  return [songWord(m.songs.length), time].filter(Boolean).join(" · ");
}

/** Four of the mix's records, in its order, each once. */
function leadRecords(songs: OwnedTrack[]): OwnedTrack[] {
  const seen = new Set<string>();
  const out: OwnedTrack[] = [];
  for (const s of songs) {
    const k = s.albumKey ?? s.album;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length === 4) break;
  }
  return out;
}

/** A mix's cover: its drawn cover for the day (a mood mix), else four of its records. */
export function MixArt({ m, sizes, mode }: { m: DeskMix; sizes: string; mode: "visible" | "hover" }) {
  if (m.cover) {
    return (
      <LiveCover mix={m.cover} mode={mode} minLiveSize={96}>
        <Art src={mixCoverUrl(m.cover, { size: 600 })} sizes={sizes} />
      </LiveCover>
    );
  }
  const four = leadRecords(m.songs);
  if (four.length < 4) return <Art src={four[0] ? trackCovers(four[0], 600) : null} sizes={sizes} />;
  return (
    <span className={d.mixQuad}>
      {four.map((s) => (
        <Art key={s.key} src={trackCovers(s, 300)} sizes="120px" />
      ))}
    </span>
  );
}

/** Play, shuffle, keep it as a playlist of your own: the same in a tile's menu, the side view and the page. */
export function useMixMenu() {
  const router = useRouter();
  const owned = useOwned();
  const queue = useQueueLines();
  const { showToast } = useShell();
  const keep = async (m: DeskMix) => {
    try {
      const id = await createPlaylist(m.title);
      await owned.addToPlaylist({ id, name: m.title }, { songs: m.songs });
      router.push(deskPlaylist(id));
      router.refresh();
    } catch (e) {
      showToast((e as Error).message || "Couldn't keep that playlist", { variant: "error" });
    }
  };
  return (m: DeskMix, opts: { onPage?: boolean } = {}): MenuItem[] => [
    { label: "Play", onSelect: () => owned.playList(m.songs, 0) },
    { label: "Shuffle", onSelect: () => owned.shuffleList(m.songs) },
    ...queue(m.songs),
    "separator",
    ...(opts.onPage ? [] : ([{ label: "Open the playlist", onSelect: () => router.push(deskMix(m.id)) }] as MenuItem[])),
    { label: "Keep as a playlist", onSelect: () => void keep(m) },
  ];
}

export function MixTile({ m }: { m: DeskMix }) {
  const aside = useAside();
  const owned = useOwned();
  const cm = useContextMenu();
  const menu = useMixMenu();
  const look = { kind: "mix" as const, id: m.id };
  return (
    <>
      <Tile
        disc="corner"
        art={<MixArt m={m} sizes="200px" mode="hover" />}
        title={m.title}
        line={m.subtitle ?? songWord(m.songs.length)}
        href={deskMix(m.id)}
        play={{ state: "play", label: `Play ${m.title}`, onClick: () => owned.playList(m.songs, 0) }}
        selected={aside.showing(look)}
        onSelect={(e: MouseEvent) => {
          e.preventDefault();
          aside.select(look);
        }}
        onContextMenu={(e: MouseEvent) => cm.open(e, menu(m))}
        onMore={(e: MouseEvent) => cm.open(e, menu(m))}
      />
      {cm.menu}
    </>
  );
}

/** A made-for-you playlist as a page: the side view, comfortable. */
export function MixPage({ m }: { m: DeskMix }) {
  const owned = useOwned();
  const pm = useContextMenu();
  const menu = useMixMenu();
  const songsMenu = useSongsMenu();
  const mine = !!owned.track?.subsonicTrackId && m.songs.some((x) => x.subsonicTrackId === owned.track!.subsonicTrackId);
  const moving = mine && owned.status === "playing";
  const bar = usePageBar<HTMLDivElement>();
  const keys = (
    <>
      <Pills>
        <PlayPill state={moving ? "pause" : "play"} onClick={() => (mine ? owned.toggle() : owned.playList(m.songs, 0))} />
        <ShufflePill disabled={m.songs.length < 2} onClick={() => owned.shuffleList(m.songs)} />
      </Pills>
      <button type="button" className={d.moreKey} aria-label={`More for ${m.title}`} onClick={(e) => pm.open(e, menu(m, { onPage: true }))}>
        <Glyph name="more" size={15} />
      </button>
    </>
  );
  return (
    <div className={d.page}>
      <PageBar shown={bar.shown} art={<MixArt m={m} sizes="44px" mode="hover" />} title={m.title} by={m.subtitle ?? "made for you"}>
        {keys}
      </PageBar>
      <Hero kind="playlist" art={<MixArt m={m} sizes="240px" mode="visible" />} title={m.title} answer={m.subtitle ?? "made for you"} meta={mixFacts(m)}>
        <div className={d.heroKeys} ref={bar.ref}>
          {keys}
        </div>
      </Hero>
      <SongTable
        label={m.title}
        rows={m.songs.map((x) => {
          const on = !!x.subsonicTrackId && owned.track?.subsonicTrackId === x.subsonicTrackId;
          return {
            key: x.key,
            title: x.title,
            art: <Art src={trackCovers(x, 36)} sizes="36px" size={36} />,
            artist: x.artist,
            artistHref: x.artistSlug ? deskArtist(x.artistSlug) : undefined,
            album: x.album,
            albumHref: x.albumSlug ? deskAlbum(x.albumSlug) : undefined,
            length: len(x.seconds),
            playable: !!x.subsonicTrackId,
            playing: on,
            live: on && owned.status === "playing",
          };
        })}
        onPlay={(i) => owned.playList(m.songs, i)}
        menu={(i, picked) => songsMenu(picked.map((x) => m.songs[x]), { play: [{ label: "Play", onSelect: () => owned.playList(m.songs, i) }] })}
        dragOut={(_, picked, e) => dragSongs(e, () => picked.map((x) => m.songs[x]).filter((x) => !!x), { now: true })}
      />
      {pm.menu}
    </div>
  );
}

/** The page's route: the playlist once the day's have loaded. */
export function MixRoute({ id }: { id: string }) {
  const m = useMix(id);
  if (m === undefined) return null;
  if (!m) return <p className={`${d.page} ${d.quiet}`}>That playlist isn't in today's. They're made fresh each day.</p>;
  return <MixPage key={m.id} m={m} />;
}
