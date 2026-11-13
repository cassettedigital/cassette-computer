/**
 * The record in words (the new profile words, lib/profile-words.ts): what sets it apart from the artist's
 * other work, then, quieter, the artist's own words that hold on it. Only when the model knew the record;
 * otherwise the section is not drawn at all. Sits above the meter while the two run side by side.
 */

import { SectionHead } from "@/app/_taste/SectionHead";
import k from "@/app/_taste/taste.module.css";
import type { AlbumPage } from "./types";
import a from "./album.module.css";

export function RecordWords({ p }: { p: AlbumPage }) {
  if (!p.words) return null;
  return (
    <section className={a.section} aria-labelledby="words-head">
      <div className={k.wrap}>
        <SectionHead id="words-head" size="small">
          <em>{p.title}</em>
          {p.words.usual ? ", much like their usual." : ", in a few words."}
        </SectionHead>
        <ul className={a.wordList}>
          {p.words.own.map((w) => (
            <li key={w} className={a.word}>
              {w}
            </li>
          ))}
        </ul>
        {p.words.kept.length > 0 && <p className={a.wordsKept}>Like the rest of {p.artist}: {p.words.kept.join(", ")}</p>}
      </div>
    </section>
  );
}
