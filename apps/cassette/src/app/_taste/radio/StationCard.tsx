/**
 * StationCard: one station on the dial, on the taste paper. Its square (art, or its colour as a tile with
 * its initials), the source and place over its name, the one-line description, and the two keys: Tune in
 * and Save, the kit's pills. The square and the name open the station's page (/radio/<slug>). No box
 * around it; the station's colour lives in its tile. Server-safe; the square and the keys are client
 * islands.
 *
 * Drawn from plain data (the dial's own shape, lib/radio/types DialStation): the desk has it from the cloud
 * with the rest of its window, and the website's pages hand theirs in through components/radio/StationCard,
 * so the card never needs the station list itself.
 *
 * `live` is an optional "what's on" for program stations: the line (after the live dot, the one orange,
 * because it is live), the show's picture (worn over the station's mark) and what comes next. The /radio
 * page fetches it; cards elsewhere leave it out.
 */

import Link from "next/link";
import { Children, type CSSProperties, type ReactNode } from "react";
import { fullRows } from "@/app/_taste/rows";
import type { DialStation } from "@/lib/radio/types";
import { SaveStationKey } from "./SaveStation";
import { StationArt } from "./StationArt";
import styles from "./station.module.css";
import { RadioTuneInKey } from "./TuneIn";

export interface StationLive {
  line: string;
  art?: string | null;
  next?: string | null;
}

/** What a card draws: a station on the dial, or any station with the line over its name worked out. */
export type StationCardData = Pick<DialStation, "slug" | "name" | "kicker" | "description" | "image" | "accent">;

export function StationCard({ station, live }: { station: StationCardData; live?: StationLive | null }) {
  const art = live?.art ?? station.image ?? null;
  const kicker = station.kicker;
  return (
    <article className={styles.card} style={{ ["--station" as string]: station.accent } as CSSProperties}>
      {/* no prefetch: a dial of 60 cards prefetched 60 live station pages, each read from its station (2026-11-15) */}
      <Link href={`/radio/${station.slug}`} className={styles.top} prefetch={false}>
        <StationArt src={art} name={station.name} size={64} className={styles.art} />
        <span className={styles.titles}>
          <span className={styles.kicker}>{kicker}</span>
          <span className={styles.name}>{station.name}</span>
        </span>
      </Link>
      <p className={styles.sub}>{station.description}</p>
      {live && (
        <p className={styles.live}>
          <span className={styles.liveDot} aria-hidden="true" />
          {live.line}
        </p>
      )}
      {live?.next && <p className={styles.liveNext}>{live.next}</p>}
      <div className={styles.keys}>
        <RadioTuneInKey slug={station.slug} />
        <SaveStationKey station={station} />
      </div>
    </article>
  );
}

/** The house grid for station cards: one column on a phone, two from 760, three from 1100. With
 *  `wholeRows` (a lane's preview) it never ends on a short row: at each column count it shows the most
 *  that fill whole rows, the CSS hiding the rest at the width that uses it. */
export function StationGrid({ children, wholeRows = false }: { children: ReactNode; wholeRows?: boolean }) {
  const items = Children.toArray(children);
  const in2 = wholeRows ? fullRows(items.length, 2) : items.length;
  const in3 = wholeRows ? fullRows(items.length, 3) : items.length;
  return (
    <div className={styles.grid}>
      {items.map((item, i) => (
        <div key={i} className={styles.cell} data-past2={i >= in2 || undefined} data-past3={i >= in3 || undefined}>
          {item}
        </div>
      ))}
    </div>
  );
}
