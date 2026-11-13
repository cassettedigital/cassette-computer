/**
 * A writer's words and their credit (P6, P7), the same family wherever a review line shows.
 *
 *   Quote, in three sizes:
 *     "feature" the homepage press room's one line set large, the room's big mark behind it (so no
 *       marks in the text), short lines a size up and long ones a size down, sized to the viewport;
 *     "inline" the artist page's records panel, curly quotes in the text, sized the same way to the
 *       page's container;
 *     "card" (QuoteCard) the album page's press card: the mark at the top in the record's colour (big on
 *       the lead), an optional headline in display caps, the words. `emphasis` lead / card / more is the
 *       press section's own order of prominence; `length` s / m / l sets short words big and long ones
 *       smaller, so a grid of cards has a rhythm; `stroke` lays the highlighter (the record's colour)
 *       behind the headline, for the strongest verdict only; `voice` marks a speaker's own words.
 *   Byline, the one byline under every one of them (and alone in the album's row of grades): the
 *     outlet's mark, the outlet's name in the label type (a link with its up-and-out arrow when there is
 *     a link), the meta (the year, or "Looking back · year") in the meta type at ink-3, and the grade
 *     chip. A speaker's own words name them first.
 *   OutletMark: the outlet's favicon on its light chip, or its first letter (drawn by the stylesheet, so it
 *     is never in the page's text), at 20, 24 or 32px with one corner. GradeChip: the grade the outlet printed, in one size, as plain mono type in full ink: no
 *     box and no line around it (the founder, 2026-10-21), wherever it shows (the album's critics strip,
 *     its press cards and row of grades, the artist page's records panel).
 */

import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from "react";
import { Icon } from "./Icon";
import { monogram } from "./outlet";
import q from "./quote.module.css";

export type MarkSize = 20 | 24 | 32;

export function OutletMark({ icon, name, size }: { icon: string | null; name: string; size: MarkSize }) {
  return icon ? (
    // the outlet's icon at its own address (/api/press-icon/<host>, kept by the browser for good), not inline data (BUG-535)
    // eslint-disable-next-line @next/next/no-img-element
    <img className={q.mark} data-size={size} src={icon} alt="" width={size} height={size} loading="lazy" decoding="async" />
  ) : (
    // The letter is drawn by the stylesheet (quote.module.css .mono::before reads data-letter), never put in
    // the page as text: a reader that takes only the text ran it into the outlet's name ("DThe Daily Vault")
    // and the source count ("T6 sources") (BUG-832).
    <span className={q.mono} data-size={size} data-letter={monogram(name)} aria-hidden="true" />
  );
}

/** The grade the outlet printed, plain, beside the outlet. */
export function GradeChip({ glyph, title }: { glyph: string; title: string }) {
  return (
    <span className={q.chip} title={title}>
      {glyph}
    </span>
  );
}

/** Who said it: what the one byline shows. */
export type By = {
  outlet: string;
  url: string | null;
  icon: string | null;
  /** The year, or "Looking back · 2012". */
  meta?: string | null;
  /** The grade as printed, and what its chip says when pointed at. */
  glyph?: string | null;
  gradeTitle?: string;
  /** A speaker's own words: they lead, the outlet is where it ran. */
  speaker?: string | null;
  /** The fan archive a link reprints the piece on. */
  carrier?: string | null;
};

const MARK: Record<"feature" | "inline" | "card", MarkSize> = { feature: 20, inline: 24, card: 32 };

/** The one byline: under every quote, and alone in the album's row of grades. */
export function Byline({ by, mark }: { by: By; mark: MarkSize }) {
  const outlet = by.url ? (
    <a className={q.byLink} href={by.url} target="_blank" rel="noopener noreferrer nofollow" title={by.carrier ? `${by.outlet}, reprinted at ${by.carrier}` : undefined}>
      {by.outlet}
      <Icon name="out" size={12} />
    </a>
  ) : (
    <span>{by.outlet}</span>
  );
  return (
    <span className={q.by}>
      <OutletMark icon={by.icon} name={by.outlet} size={mark} />
      <span className={q.byText}>
        <span className={q.byName}>
          {by.speaker ? (
            <>
              {by.speaker}, to {outlet}
            </>
          ) : (
            outlet
          )}
        </span>
        {by.meta && <span className={q.byMeta}>{by.meta}</span>}
      </span>
      {by.glyph && <GradeChip glyph={by.glyph} title={by.gradeTitle ?? `${by.outlet} gave it ${by.glyph}`} />}
    </span>
  );
}

/** A quote set in a figure: the homepage's feature line or the artist page's inline one. */
export function Quote({
  size,
  quote,
  length = "m",
  by,
  className,
  ...rest
}: {
  size: "feature" | "inline";
  quote: ReactNode;
  /** Short lines a size up, long ones a size down. */
  length?: "s" | "m" | "l";
  by: By;
  className?: string;
} & Omit<ComponentPropsWithoutRef<"figure">, "children" | "className">) {
  const cls = size === "feature" ? q.feature : q.inline;
  return (
    <figure className={className ? `${cls} ${className}` : cls} {...rest}>
      <blockquote data-length={length}>{size === "inline" ? <>“{quote}”</> : quote}</blockquote>
      <figcaption>
        <Byline by={by} mark={MARK[size]} />
      </figcaption>
    </figure>
  );
}

/** A phrase of a card's headline in the record's colour. */
export function Accent({ children }: { children: ReactNode }) {
  return <em className={q.accent}>{children}</em>;
}

/** The press card. Its words are passed already curled; the card adds only its mark. */
export function QuoteCard({
  emphasis,
  voice,
  length = "m",
  stroke,
  solo,
  headline,
  quote,
  by,
  style,
}: {
  emphasis: "lead" | "card" | "more";
  voice?: boolean;
  /** Short words set big, long ones smaller. */
  length?: "s" | "m" | "l";
  /** The highlighter behind the headline: the strongest verdict only. */
  stroke?: boolean;
  solo?: boolean;
  headline?: ReactNode;
  quote: ReactNode;
  by: By;
  style?: CSSProperties;
}) {
  return (
    <article
      className={q.card}
      data-emphasis={emphasis}
      data-length={length}
      data-voice={voice || undefined}
      data-head={headline ? "" : undefined}
      data-solo={solo || undefined}
      style={style}
    >
      <span className={q.cardMark} aria-hidden="true">
        {"“"}
      </span>
      {headline && <h3 className={q.cardHead}>{stroke ? <span className={q.stroke}>{headline}</span> : headline}</h3>}
      <blockquote className={q.cardQuote}>
        <p>{quote}</p>
      </blockquote>
      <footer className={q.cardBy}>
        <Byline by={by} mark={MARK.card} />
      </footer>
    </article>
  );
}
