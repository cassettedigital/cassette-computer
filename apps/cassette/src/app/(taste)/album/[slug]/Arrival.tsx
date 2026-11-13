"use client";

/**
 * A shared song's arrival (CASSETTE_SHARING.md): the friend opened a link to one song, and the top of the
 * album page belongs to it. Who it's from, their note when they wrote one (any length, kept as they wrote
 * it), the song's own still with one Play key, and what the song is. The album is right underneath, never
 * a page of its own and never a card over the page.
 *
 * On a window wide enough for the player's rail it lives there from the start (the founder, 2026-11-06:
 * "make it a right rail, just like our player"): the rail opens on arrival with who sent it and their note
 * at its top and the song's still with Play where the video goes (the player's Cue), the album page
 * beside it, so the press turns the still into the video in place and Up next follows in the same rail.
 * The block here then stays hidden (CSS, so it never flashes before the rail comes). Narrower, it is the
 * block at the top of the page, as the player is along the top there.
 *
 * A song on an edition's bonus disc, which the page's list leaves off, opens the same way (`bonus`): its own
 * header and still, one Play key that plays just that song, and a line saying it is from a disc the list
 * leaves off (BUG-715).
 *
 * Play takes one tap, because a browser will not start sound for someone who just arrived. It starts the
 * song in the page's one player as a shared visit (playList with `{ shared: true }`) and, when the sender
 * chose a moment, from that moment, with the rest of the record after it. The video plays in the player
 * (the panel down the right of a wide window, pinned along the top of a narrower one), so the friend can
 * explore while it plays; the still here keeps the playing bars. When the song ends the player says
 * what's next beside the video, with a countdown and Stop (DockUpNext), so nothing here says it ahead of
 * time.
 *
 * A link from the web's share key carries no sender ("Shared with you"); one sent from the phone carries
 * the sender and their note. A song found in search (`via=search`, the masthead's or the dashboard's
 * Everywhere else) has no sender line at all and plays once: the song alone, not a shared visit and never
 * the rest of the record after it, so it ends instead of carrying on into songs nobody asked for. Never
 * inside the iPhone app, which carries no previews.
 */

import { useEffect, useRef, useState } from "react";
import { Bars } from "@/app/_taste/Bars";
import { Icon } from "@/app/_taste/Icon";
import { usePlayer, useCue } from "@/app/_taste/player";
import { useRailWide } from "@/app/_taste/PlayerDock";
import { fmtTime } from "@/app/(taste)/_kit/format";
import type { Playable } from "@/app/_taste/play";
import type { AlbumPage } from "./types";
import r from "./arrival.module.css";
import { Picture } from "@discovery/cassette-kit/picture";
import { picture } from "@/lib/images/picture";

export type ArrivalShare = {
  trackId: number;
  /** The sender's first name, or null for a link that carries no sender. */
  from: string | null;
  fromImage: string | null;
  note: string | null;
  startSeconds: number | null;
  /** Found in search: no sender line, and it plays once. */
  once?: boolean;
  /** The song is on an edition's bonus disc that the page's list leaves off: what the arrival draws of it
   *  (the list has no row for it), and it plays on its own, never with the record after it. */
  bonus?: { title: string; featured: string[]; playable: Playable | null };
};

/** Said under a bonus disc song's title, and in the rail above its video. */
export const BONUS_LINE = "From an edition's bonus disc, which the song list below leaves off.";

function Still({ videoId, cover, title }: { videoId: string | null; cover: string | null; title: string }) {
  const [fail, setFail] = useState(!videoId);
  if (!fail) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={r.still} src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`} alt="" aria-hidden="true" onError={() => setFail(true)} data-title={title} />;
  }
  // no still from YouTube: the record's cover, at the image ladder's size for the stage
  return cover ? <Picture {...picture(cover, "cover")} sizes="(max-width: 900px) 100vw, 60vw" className={r.still} alt="" aria-hidden="true" data-title={title} /> : null;
}

/** Who sent it, their note and the moment it starts at: the rail's top while the song waits and plays. */
function Lead({ share }: { share: ArrivalShare }) {
  const initial = share.from?.trim().charAt(0).toUpperCase() ?? null;
  return (
    <>
      {!share.once && (
        <p className={`${r.from} ${r.railFrom}`}>
          {share.from ? (
            <>
              <span className={r.face} aria-hidden="true">
                {share.fromImage ? <Picture {...picture(share.fromImage, "avatar")} frame={24} alt="" width={24} height={24} /> : initial}
              </span>
              From {share.from}
            </>
          ) : (
            "Shared with you"
          )}
        </p>
      )}
      {share.note && <p className={r.railNote}>{share.note}</p>}
      {share.bonus && <p className={`${r.start} ${r.railStart}`}>{BONUS_LINE}</p>}
      {share.startSeconds ? <p className={`${r.start} ${r.railStart}`}>Starts at {fmtTime(share.startSeconds)}</p> : null}
    </>
  );
}

export function Arrival({ p, share }: { p: AlbumPage; share: ArrivalShare }) {
  const { playList, isCurrent, status, track } = usePlayer();
  const { setCue } = useCue();
  const wide = useRailWide();
  const bonus = share.bonus ?? null;
  // a bonus disc song has no row on the page's list: the arrival draws it from what it was handed
  const song = bonus ? { id: share.trackId, title: bonus.title, featured: bonus.featured } : p.tracks.find((t) => t.id === share.trackId);
  const index = bonus ? -1 : p.playables.findIndex((x) => x.trackId === share.trackId);
  const playable = bonus ? bonus.playable : index >= 0 ? p.playables[index] : null;
  // over once anything plays, whatever played it; Close on the rail sets it aside
  const [started, setStarted] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (track) setStarted(true);
  }, [track]);

  const play = () => {
    if (!playable) return;
    if (share.once || bonus) return playList([playable]);
    const list = p.playables.map((x) => (x.trackId === share.trackId ? { ...x, startSeconds: share.startSeconds } : x));
    playList(list, index, { wrap: true, shared: true });
  };
  const playRef = useRef(play);
  playRef.current = play;

  // wide: the song goes to the rail (the player's Cue) for as long as this page shows it
  const inRail = wide && !!song && !!playable && !dismissed;
  useEffect(() => {
    if (!inRail || !playable) return;
    setCue({
      track: { ...playable, startSeconds: share.startSeconds },
      lead: <Lead share={share} />,
      started,
      start: () => {
        setStarted(true);
        playRef.current();
      },
      dismiss: () => setDismissed(true),
    });
    return () => setCue(null);
  }, [inRail, playable, share, started, setCue]);

  if (!song) return null;
  const current = isCurrent(song.id);
  const year = p.facts.find((x) => x.k === "Released")?.v.match(/\d{4}/)?.[0] ?? null;
  const initial = share.from?.trim().charAt(0).toUpperCase() ?? null;

  return (
    // a song with a video goes to the rail on a wide window, so the block here hides there (data-rail)
    <section className={r.arrival} aria-labelledby="arrival-title" data-rail={playable ? "" : undefined}>
      <div className={r.wrap}>
        {!share.once && (
          <p className={r.from}>
            {share.from ? (
              <>
                <span className={r.face} aria-hidden="true">
                  {share.fromImage ? (
                    <Picture {...picture(share.fromImage, "avatar")} frame={24} alt="" width={24} height={24} />
                  ) : (
                    initial
                  )}
                </span>
                From {share.from}
              </>
            ) : (
              "Shared with you"
            )}
          </p>
        )}
        {share.note && <p className={r.note}>{share.note}</p>}
        <div className={r.stage}>
          <Still videoId={playable?.videoId ?? null} cover={p.cover ?? p.coverSmall} title={song.title} />
          {playable && !current && (
            <button type="button" className={r.play} onClick={play} aria-label={`Play ${song.title}`}>
              <Icon name="play" size={28} />
            </button>
          )}
          {current && (
            <span className={r.loading} aria-hidden="true">
              <Bars live={status === "playing"} />
            </span>
          )}
          {!playable && <p className={r.none}>No video for this one yet.</p>}
        </div>
        <div className={r.song}>
          <h2 id="arrival-title" className={r.title}>
            {song.title}
          </h2>
          <p className={r.meta}>
            {p.artist}
            {song.featured.length > 0 && <> feat. {song.featured.join(", ")}</>}
            {" · "}
            from <em>{p.title}</em>
            {year ? ` (${year})` : ""}
          </p>
          {bonus && <p className={r.start}>{BONUS_LINE}</p>}
          {share.startSeconds ? <p className={r.start}>Starts at {fmtTime(share.startSeconds)}</p> : null}
        </div>
      </div>
    </section>
  );
}
