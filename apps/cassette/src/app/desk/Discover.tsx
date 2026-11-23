"use client";

/**
 * Discover in the app's window: the website's Discover page, the same shelves in the same order from the same day's
 * page (the cloud makes it, /api/player/desk/discover), drawn by the website's own body (discover/_feed/DiscoverBody),
 * as the album page and the Radio dial are shared. Only what the window does differently is here:
 *
 *   a record you own   is your copy: its key plays it from your computer on the player bar, its picture looks into it
 *                      in the side view, its name opens your copy, and a right click is the record's own menu
 *   any other record   opens its page in the catalog (the window keeps the website's links inside itself, DeskShell),
 *                      and its keys preview it in the booth, the window's preview player
 *   Saved for later    Discover's second view, switched from the title (discover/_feed/views.tsx, the website's too): what
 *                      you saved and don't own, asked of the cloud as the radio's saves are (/api/saves), so it is never
 *                      part of the copy kept for no internet
 *   the Radio band     the window's station tiles: a click looks into the station in the side view, its disc tunes in
 *   Buy                opens in the browser (BuyMenu's desk surface)
 *
 * With no internet the page is the copy kept from the last time it loaded on this computer, saying so in a line under
 * the title (covers seen before still show; previews and Buy need the internet). Never loaded here, it says Discover
 * needs the internet, in the window's own words for a page that couldn't load (error.tsx), and the library, the side
 * view and the player carry on. Either way it loads again by itself once the internet is back.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useContextMenu } from "@discovery/cassette-kit";
import { DiscoverBody } from "@/app/discover/_feed/DiscoverBody";
import { DiscoverOwnedProvider, type OwnedHere } from "@/app/discover/_feed/own";
import { RadioBand } from "@/app/discover/_feed/RadioBand";
import { SavedPane } from "@/app/discover/_feed/SavedForLater";
import { DiscoverViewPanes, DiscoverViewProvider, ViewHeading, type DiscoverView as OpenView } from "@/app/discover/_feed/views";
import { NOTHING_SAVED, type SavedForLater as Saved } from "@/lib/saves-types";
import { Heading } from "@discovery/cassette-kit";
import type { DiscoverView } from "@/app/discover/_feed/view";
import { useDesk } from "./DeskShell";
import { useOnline } from "./network";
import { useOwned } from "./owned";
import { useRecordDisc, useStartRecord } from "./Player";
import { StationTile, useLook, useRecordMenu } from "./Shelves";
import { DESK } from "./types";
import d from "./desk.module.css";

export function DeskDiscover({ view, offline, initial = "discover" }: { view: DiscoverView | null; offline: boolean; initial?: OpenView }) {
  const { shelf, stations } = useDesk();
  const owned = useOwned();
  const st = useStartRecord();
  const disc = useRecordDisc();
  const look = useLook();
  const recordMenu = useRecordMenu();
  const cm = useContextMenu();
  const router = useRouter();
  const online = useOnline();
  // Saved for later: asked of the cloud each time the page shows, and again when the internet comes back
  const [saved, setSaved] = useState<Saved>(NOTHING_SAVED);
  useEffect(() => {
    if (!online) return;
    let alive = true;
    fetch("/api/saves", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Saved>) : null))
      .then((d) => {
        if (alive && d && Array.isArray(d.artists) && Array.isArray(d.records) && Array.isArray(d.songs)) setSaved(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [online]);
  // the internet back after it was gone: today's page in place of the kept copy (or of no page at all)
  const was = useRef(online);
  useEffect(() => {
    if (online && !was.current && (!view || offline)) router.refresh();
    was.current = online;
  }, [online, view, offline, router]);
  // your records by their catalog page, the way Discover names them
  const yours = useMemo(() => new Map(shelf.flatMap((a) => (a.slug ? [[a.slug, a] as const] : []))), [shelf]);
  const ownedHere = useCallback(
    (slug: string): OwnedHere | null => {
      const a = yours.get(slug);
      if (!a) return null;
      const on = owned.track?.albumKey === a.key;
      return {
        play: disc(a),
        playing: on && owned.status === "playing",
        status: on ? owned.status : st.pending === a.key ? "loading" : "idle",
        ...look({ kind: "record", key: a.key }),
        onMenu: (e: MouseEvent) => cm.open(e, recordMenu(a)),
      };
    },
    [yours, owned.track, owned.status, st.pending, disc, look, cm, recordMenu],
  );
  const band = useMemo(() => {
    const bySlug = new Map(stations.map((s) => [s.slug, s]));
    return (view?.radio ?? []).filter((s) => bySlug.has(s.slug)).map((s) => ({ band: s, desk: bySlug.get(s.slug)! }));
  }, [view, stations]);

  // never loaded on this computer and no answer now: the window's own words for a page that couldn't load
  if (!view)
    return (
      <div className={d.lost}>
        <p className={d.lostHead}>{online ? "Discover didn't load." : "Discover needs the internet."}</p>
        <p className={d.quiet}>Everything in your library still plays.</p>
        <p className={d.lostKeys}>
          <button type="button" className={d.lostLink} onClick={() => router.refresh()}>
            Try again
          </button>
          <Link href={DESK} className={d.lostLink}>
            Home
          </Link>
        </p>
      </div>
    );

  return (
    <DiscoverViewProvider initial={initial}>
      <div className={d.page}>
        {/* the title names the open view; the other, small beside it, switches to it */}
        <ViewHeading heading={(label) => <Heading as="h1" shout={label} tone="quiet" />} />
        {/* the kept copy: "No internet" only when it is the internet that's gone, not the cloud slow to answer */}
        {offline && <p className={d.quiet}>{online ? "" : "No internet. "}This is Discover as it was the last time it loaded here.</p>}
        <DiscoverViewPanes
          saved={<SavedPane saved={saved} />}
          discover={
            <DiscoverOwnedProvider value={ownedHere}>
              <DiscoverBody
                view={view}
                signedIn
                surface="desk"
                radio={
                  <RadioBand
                    stations={band.map((x) => x.band)}
                    radioHref={`${DESK}/radio`}
                    tile={(s) => {
                      const x = band.find((b) => b.band.slug === s.slug);
                      return x ? <StationTile key={s.slug} s={x.desk} /> : null;
                    }}
                  />
                }
              />
            </DiscoverOwnedProvider>
          }
        />
        {cm.menu}
      </div>
    </DiscoverViewProvider>
  );
}
