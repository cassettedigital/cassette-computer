/**
 * The Discover page's body, in the founder's order (feed-order.ts says what each part is and why), drawn from the
 * day's page as plain data (view.ts, made by feed-view.ts). One drawing for both windows: the website's /discover
 * (DiscoverFeed, under its title) and the desktop app's Discover (desk/Discover.tsx), so a change here is a change in
 * both.
 *
 *   Today's record → the listener's own shelves → genres as versions → This month's find → New & notable → New from
 *   artists you love, and ones you might (signed in) or If you can't get enough of the new record from … (signed
 *   out) → the Radio band
 *
 * Every shelf is Shelf.tsx, the shared section head and the player kit's shelf; the two top picks are TopPick with the
 * album page's own buttons on the shared one-line row (own.tsx PickKeys). Each block sits at the page's one section
 * gap, and the shelves in a run closer, at a shelf's gap (order.module.css). The window passes its Radio band in
 * (`radio`): the website's tunes in and opens the station's page, the app's looks into a station in its side view.
 *
 * Reads nothing itself, so the desktop app's open-source copy carries it without the feed's reads.
 */

import type { ReactNode } from "react";
import { Skeleton, SkeletonPage } from "@/app/_taste/Skeleton";
import { TopPick } from "@/app/discover/TopPick";
import pick from "@/app/discover/toppick.module.css";
import { tokens as kit } from "@discovery/cassette-kit";
import type { Surface } from "@/lib/app-surface";
import { Accent } from "./Accent";
import { PickKeys } from "./own";
import { Shelves } from "./Shelf";
import type { DiscoverHero, DiscoverView } from "./view";
import styles from "./feed.module.css";
import lanesStyles from "./lanes.module.css";

export function DiscoverBody({ view, signedIn, surface, radio }: { view: DiscoverView; signedIn: boolean; surface: Surface; radio: ReactNode }) {
  const { top, upper, find, lower } = view;
  // two runs of shelves either side of This month's find, or one run when the find is up top; the Radio band ends the
  // last run, at a shelf's gap like the shelves before it
  return (
    <div className={styles.feed}>
      {top && <Hero p={top} signedIn={signedIn} surface={surface} />}
      {find && upper.length > 0 && <Shelves shelves={upper} />}
      {find && <Hero p={find} signedIn={signedIn} surface={surface} />}
      <Shelves shelves={lower} after={radio} />
    </div>
  );
}

/** A top pick (Today's record, This month's find): the cover and its words, the title in the record's colour, and the
 *  album page's own buttons on the shared row. */
function Hero({ p, signedIn, surface }: { p: DiscoverHero; signedIn: boolean; surface: Surface }) {
  return (
    <Accent cover={p.tint}>
      <TopPick
        id={p.id}
        slug={p.slug}
        title={p.title}
        cover={p.cover}
        kicker={p.kicker}
        artist={{ name: p.artist.name, href: `/artist/${p.artist.slug}` }}
        meta={p.meta ?? undefined}
        line={p.line}
        actions={<PickKeys p={p} signedIn={signedIn} surface={surface} />}
      />
    </Accent>
  );
}

/** Loading state while the page comes: the feed's own shape as bones (the shared skeleton, _taste/Skeleton, the
 *  album and artist pages' too). The top pick's cover with its words beside it (TopPick's own grid), then two shelves
 *  as the kit's shelf lays them out (a name, then as many whole tiles as the width holds, each a cover, a title and a
 *  line). */
export function FeedSkeleton() {
  return (
    <SkeletonPage label="Loading your feed">
      <div className={styles.feed}>
        <section className={pick.pick}>
          <div className={pick.cover}>
            <Skeleton shape="cover" w="100%" />
          </div>
          <div className={pick.text}>
            <Skeleton w="9em" h={11} />
            <Skeleton w="min(80%, 9em)" h={34} />
            <Skeleton w="11em" h={12} />
            <Skeleton w="min(100%, 26em)" h={18} style={{ marginTop: 4 }} />
            <Skeleton w="min(70%, 17em)" h={18} />
            <div className={styles.skelKeys}>
              <Skeleton shape="pill" w={128} />
              <Skeleton shape="pill" w={128} />
            </div>
          </div>
        </section>
        <div className={`${kit.kit} ${kit.follow} ${lanesStyles.lanes}`}>
          {[0, 1].map((n) => (
            <div key={n} className={styles.skelLane}>
              <Skeleton w="13em" h={22} className={styles.skelHead} />
              <div className={styles.skelShelf}>
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i}>
                    <Skeleton shape="cover" w="100%" />
                    <Skeleton w="78%" h={14} style={{ marginTop: "var(--pk-tile-title-gap)" }} />
                    <Skeleton w="52%" h={11} style={{ marginTop: 6 }} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </SkeletonPage>
  );
}
