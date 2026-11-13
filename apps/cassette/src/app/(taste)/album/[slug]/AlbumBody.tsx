"use client";

/**
 * The album page's body: the record's colour, read off its cover, carried into every section as
 * --accent-c (brass until it is read) with its text-safe version as --accent-ink, and the sections in
 * order. The shell (layout) owns the paper,
 * masthead, dock, footer and reveal observer. `surface` is the window it is drawn in: the songs' share
 * key and Want it are the website's alone, and in the desktop app Buy opens the browser (Q5,
 * lib/app-surface.ts).
 */

import { createContext, useContext, useMemo, useState } from "react";
import { accentVars, useCoverAccent } from "@/app/_taste/colour";
import { useRailAccent } from "@/app/_taste/player";
import type { Surface } from "@/lib/app-surface";
import k from "@/app/_taste/taste.module.css";
import { Opener } from "./Opener";
import { Tracklist } from "./Tracklist";
import { Press } from "./Press";
import { Meter } from "./Meter";
import { RecordWords } from "./RecordWords";
import { MoreBy } from "./MoreBy";
import { Further } from "./Further";
import { Sources } from "./Sources";
import { Listeners } from "./Listeners";
import { Arrival, type ArrivalShare } from "./Arrival";
import type { AlbumPage } from "./types";
import a from "./album.module.css";

/** Read all's open state, shared so the critics strip can open it before jumping to a grade behind it.
 *  (Not the scroll reveal: that is the shared set's useReveal.) */
const ReadAllCtx = createContext<{ open: boolean; setOpen: (v: boolean) => void } | null>(null);
export function useReadAll() {
  const v = useContext(ReadAllCtx);
  if (!v) throw new Error("useReadAll outside AlbumBody");
  return v;
}

export function AlbumBody({ p, arrival = null, surface = "web" }: { p: AlbumPage; arrival?: ArrivalShare | null; surface?: Surface }) {
  const accent = useCoverAccent(p.accentSrc);
  useRailAccent(accent);
  const [open, setOpen] = useState(false);
  const readAll = useMemo(() => ({ open, setOpen }), [open]);
  const others = p.moreBy.some((m) => !m.current);
  const band = !!p.words || p.meter.length > 0 || others || p.further.length > 0;
  return (
    <ReadAllCtx.Provider value={readAll}>
      <div className={a.page} style={accentVars(accent)}>
        {/* a shared song's visit: the song a friend sent takes the top of the page (Arrival.tsx). Keyed by the
            song, so a second song picked on the record already open draws its own header and still (BUG-716). */}
        {arrival && <Arrival key={arrival.trackId} p={p} share={arrival} />}
        <Opener p={p} surface={surface} />
        {p.tracks.length > 0 && <Tracklist p={p} share={surface === "web"} />}
        <Press p={p} />
        {(p.listeners?.length ?? 0) > 0 && <Listeners p={p} />}
        {band && (
          <div className={`${k.own} ${a.band}`}>
            {p.words && <RecordWords p={p} />}
            {p.meter.length > 0 && <Meter p={p} />}
            {others && <MoreBy p={p} />}
            {p.further.length > 0 && <Further p={p} />}
          </div>
        )}
        {p.sources.length > 0 && <Sources p={p} />}
      </div>
    </ReadAllCtx.Provider>
  );
}
