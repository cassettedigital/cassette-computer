/**
 * One press card, the September family on dark paper: the mark at the top in the record's colour, a
 * headline in display caps whenever the outlet printed one or the editor took one from the article, the
 * writer's words, and the one byline (the outlet's mark, the outlet as the link, the meta, the grade).
 * The words are set by their length (short lines big, long ones smaller) so the grid has a rhythm, a
 * size down under a headline; the lead is a size up from the rest and keeps its words big under its
 * headline. The card, the byline, the outlet's mark and the grade are the shared
 * Quote family (src/app/_taste/Quote.tsx); this file decides what goes on them.
 *
 * Emphasis (the founder, 2026-10-21: "The review formatting lost quite a bit of its character and
 * emphasis"; the highlighter is to be reserved "only for the strongest of sentiments"): a headline the
 * editor stored as "stroke" on a rave takes the highlighter (shape.ts strokeOf); "accent" colours its
 * phrase; every other headline prints plain.
 */

import type { CSSProperties } from "react";
import { Accent, Byline, QuoteCard } from "@/app/_taste/Quote";
import type { PressEntry } from "@/app/(taste)/_kit/types";
import { headParts, headlineOf, quoteLength, strokeOf } from "./shape";
import a from "./album.module.css";

function Headline({ text, e }: { text: string; e: PressEntry }) {
  const parts = e.treatment === "accent" ? headParts(text, e.accent) : null;
  return parts ? (
    <>
      {parts[0]}
      <Accent>{parts[1]}</Accent>
      {parts[2]}
    </>
  ) : (
    text
  );
}

export function PressCard({ e, emphasis, o, solo }: { e: PressEntry; emphasis: "lead" | "card" | "more"; o: number; solo?: boolean }) {
  if (!e.quote) return null;
  const headline = headlineOf(e);
  return (
    <QuoteCard
      emphasis={emphasis}
      voice={e.voice}
      length={quoteLength(e.quote, !!headline && emphasis !== "lead")}
      solo={solo}
      stroke={strokeOf(e)}
      style={{ "--o": o } as CSSProperties}
      headline={headline ? <Headline text={headline} e={e} /> : undefined}
      quote={e.quote}
      by={{
        outlet: e.outlet,
        url: e.url,
        carrier: e.carrier,
        icon: e.icon,
        meta: e.meta,
        glyph: e.glyph,
        gradeTitle: `${e.outlet} gave it ${e.grade ?? e.glyph}`,
        speaker: e.voice ? e.speaker : null,
      }}
    />
  );
}

/** The grade-only entries: one row of the one byline (the outlet's mark, its name, the grade). Press.tsx
 *  places it: under the top cards while Read all is closed, after the last revealed card once it is open. */
export function GradeRow({ items }: { items: PressEntry[] }) {
  return (
    <ul className={a.grades} aria-label="Grades">
      {items.map((e) => (
        <li key={e.order}>
          <Byline
            mark={24}
            by={{ outlet: e.outlet, url: e.url, carrier: e.carrier, icon: e.icon, glyph: e.glyph, gradeTitle: `${e.outlet} gave it ${e.grade ?? e.glyph}` }}
          />
        </li>
      ))}
    </ul>
  );
}
