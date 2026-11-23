"use client";

/**
 * The Radio band at the foot of Discover: real stations to discover, on the page's own paper under the page's
 * own section head, the same size as every shelf's (the founder, 2026-11-18, the last sweep: the darker band and
 * the smaller lane head read as a different page). It is the same shelf as those lanes (the kit's
 * ShelfSection), so a station sits in the same column as the records over it, a whole tile at a time, with
 * the same arrows; each tile is the station's mark (the kit's app shape) and its disc tunes straight in
 * (the site's radio lane, which stops any song preview). The name opens the Radio page; a station opens its
 * own. The heading says "live now", so no tile says Live.
 *
 * The founder, 2026-11-17: the old row of fixed 124px squares "looks kinda bad" (it lined up with nothing
 * above it and cut its last station in half).
 *
 * The desktop app's Discover draws this same band with its own station tiles (`tile`: a click looks into the station
 * in the window's side view, its disc tunes in) and its own Radio page behind the name (`radioHref`).
 */

import Link from "next/link";
import { forwardRef, type AnchorHTMLAttributes, type ReactNode } from "react";
import { KitProvider, ShelfSection, Tile, tokens as kit, type KitLinkProps } from "@discovery/cassette-kit";
import { StationArt } from "@/app/components/radio/StationArt";
import { useRadio } from "@/app/components/radio/RadioProvider";
import { SectionHead } from "@/app/_taste/SectionHead";
import type { DiscoverStation } from "./view";
import l from "./lanes.module.css";

// no prefetch: each is a live station page
const KitLink = forwardRef<HTMLAnchorElement, KitLinkProps>(function KitLink({ href, ...rest }, ref) {
  return <Link ref={ref} href={href} prefetch={false} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)} />;
});

export function RadioBand({
  stations,
  radioHref = "/radio",
  tile,
}: {
  stations: DiscoverStation[];
  radioHref?: string;
  /** a window's own tile for a station (the desktop app's); null leaves the station out */
  tile?: (s: DiscoverStation) => ReactNode;
}) {
  const radio = useRadio();
  if (stations.length === 0) return null;
  return (
    <KitProvider link={KitLink}>
      <div className={`${kit.kit} ${kit.follow} ${l.band}`}>
        <ShelfSection
          shout="Radio"
          answer="live now"
          head={
            <SectionHead size="small">
              <Link href={radioHref} className={l.bandLink}>
                Radio, <em>live now</em>
              </Link>
            </SectionHead>
          }
        >
          {stations.map((s) => {
            if (tile) return tile(s);
            const on = radio.isCurrent(s.slug) && radio.status !== "idle";
            return (
              <Tile
                key={s.slug}
                shape="app"
                art={<StationArt src={s.image} name={s.name} size={200} className={l.stationArt} />}
                title={s.name}
                line={s.kicker}
                href={`/radio/${s.slug}`}
                playing={on}
                play={{
                  state: on ? "stop" : "play",
                  label: on ? `Stop ${s.name}` : `Tune in to ${s.name}`,
                  busy: on && radio.status === "connecting",
                  onClick: () => radio.toggle(s.slug),
                }}
              />
            );
          })}
        </ShelfSection>
      </div>
    </KitProvider>
  );
}
