"use client";

/**
 * A record or an artist on its way into the window (album/[id]/loading.tsx, artist/[id]/loading.tsx): the
 * page's head (the cover square, or the artist's circle, beside the kicker, the title, the facts and Play
 * and Shuffle) and its rows (a record's songs, an artist's records), as bones on the window's paper, laid
 * out by the desk's own record classes. The window, the library, the side view and the bar stay and keep
 * playing; only the page waits. It draws the page for something in your library, the one the desk opens
 * first; one you don't have opens as the website's page, which looks much the same at a glance.
 */

import { Grid, Pills } from "@discovery/cassette-kit";
import { Skeleton, SkeletonPage, SkeletonRows } from "@/app/_taste/Skeleton";
import d from "./desk.module.css";

export function RecordSkeleton({ kind }: { kind: "album" | "artist" }) {
  const album = kind === "album";
  return (
    <SkeletonPage label={album ? "Loading the album" : "Loading the artist"} className={d.record}>
      <div className={d.recordTop}>
        <Skeleton shape={album ? "cover" : "circle"} style={{ maxWidth: 280 }} />
        <div>
          <Skeleton w="8em" h={18} />
          <Skeleton w="72%" h={34} style={{ marginTop: 12 }} />
          {album && <Skeleton w="32%" h={20} style={{ marginTop: 10 }} />}
          <Skeleton w="44%" h={13} style={{ marginTop: 14 }} />
          <div className={d.heroKeys} style={{ marginTop: 18 }}>
            <Pills>
              <Skeleton shape="pill" />
              <Skeleton shape="pill" />
            </Pills>
          </div>
        </div>
      </div>
      <div className={d.recordSongs}>
        {album ? (
          <SkeletonRows count={10} />
        ) : (
          <>
            <Skeleton w="7em" h={22} style={{ marginBottom: 16 }} />
            <Grid min={150}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <li key={i}>
                  <Skeleton shape="cover" />
                  <Skeleton w="70%" h={14} style={{ marginTop: 10 }} />
                </li>
              ))}
            </Grid>
          </>
        )}
      </div>
    </SkeletonPage>
  );
}
