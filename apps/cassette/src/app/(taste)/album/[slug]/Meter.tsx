/**
 * The record against the artist's other studio albums, as numbers only: up to five tags, each on the
 * shared measured bar (the one Known for uses), the tick for their usual and the dot in the record's
 * colour for this one; MORE or LESS past the threshold, else IN STEP (the bar unlit). No sentence. The
 * baseline is the artist's visible, enriched studio albums (the kit's rule M1). The bars fill once when
 * the rows scroll in: the page's focal motion.
 */

import { Measure } from "@/app/_taste/Measure";
import { SectionHead } from "@/app/_taste/SectionHead";
import k from "@/app/_taste/taste.module.css";
import type { AlbumPage } from "./types";
import a from "./album.module.css";

const pct = (v: number) => `${Math.round(v * 100)}%`;

export function Meter({ p }: { p: AlbumPage }) {
  return (
    <section className={a.section} aria-labelledby="meter-head">
      <div className={k.wrap}>
        <SectionHead id="meter-head" size="small">
          <em>{p.title}</em> next to {p.artist}
          {"’"}s other albums.
        </SectionHead>
        <ol className={a.meterRows} data-reveal>
          {p.meter.map((r, i) => (
            <li key={`${r.dim}-${r.tag}`} className={a.meterRow} data-word={r.word === "IN STEP" ? "step" : "off"}>
              <span className={a.mDim}>{r.dim}</span>
              <span className={a.mTag}>{r.tag}</span>
              <span className={a.mScale}>
                <Measure
                  from={r.artist}
                  to={r.album}
                  dot
                  tick={r.artist}
                  tickLabel={i === 0 ? "their usual" : undefined}
                  lit={r.word !== "IN STEP"}
                  i={i}
                  label={`${r.tag}: this record ${pct(r.album)}, their usual ${pct(r.artist)}`}
                />
              </span>
              <span className={a.mWord}>{r.word}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
