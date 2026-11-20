"use client";

/**
 * Press: what writers said about this record, in their words, linked, with the grade they printed.
 * The lead across the width a size up, the rest of the top set in two columns that end level, an odd
 * card across their foot (laid out on the server, shape.ts arrange and settle, so nothing moves after
 * load), the grade-only entries as one row of grades, and Read all opening the remaining quotes as
 * smaller cards the same way. On a wide page the lead and the card across the foot each give a third of
 * their row to a tile in the record's colour, so the cards sit like a wall instead of stretching. The row of grades sits under the top cards while Read
 * all is closed; opened, it leaves that spot and shows once, after the last revealed card (the founder,
 * 2026-10-21, of the strip between the cards: "Shouldn't this disappear when opened?"). Nothing at
 * all: the one honest line.
 */

import { useEffect, useRef } from "react";
import { Button } from "@/app/_taste/Button";
import { SectionHead } from "@/app/_taste/SectionHead";
import k from "@/app/_taste/taste.module.css";
import { pressEmptyLine } from "@/app/(taste)/_kit/press";
import type { PressEntry } from "@/app/(taste)/_kit/types";
import { useReadAll } from "./AlbumBody";
import { GradeRow, PressCard } from "./PressCard";
import type { AlbumPage } from "./types";
import a from "./album.module.css";

/** Two columns of cards and, for an odd count, one across their foot (solo: one card, the full width). The
 *  columns stretch to one height (album.module.css .cols), so they start and end level. A card across the
 *  foot, odd or alone, shares its row with the record's colour tile on a wide page (.wide, .tile): on its
 *  left under the top cards, on its right behind Read all. */
function Cols({
  cols,
  wide,
  solo,
  emphasis,
  order,
  give,
}: {
  cols: [PressEntry[], PressEntry[]];
  wide: PressEntry | null;
  solo: boolean;
  emphasis: "card" | "more";
  order: Record<string, number>;
  give: Record<string, number>;
}) {
  const card = (e: PressEntry, alone = solo) => (
    <PressCard key={e.order} e={e} emphasis={emphasis} o={order[String(e.order)] ?? 0} solo={alone} give={give[String(e.order)] ?? 0} />
  );
  const two = !solo && cols[1].length > 0;
  // one card alone is laid as the one across the foot
  const foot = wide ?? (solo && cols[0].length === 1 ? cols[0][0] : null);
  const stack = foot && !wide ? [] : cols[0];
  const side = emphasis === "card" ? "start" : "end";
  const tile = <span className={a.tile} aria-hidden="true" />;
  return (
    <div className={a.cols} data-two={two || undefined}>
      {stack.length > 0 && <div className={a.col}>{stack.map((e) => card(e))}</div>}
      {two && <div className={a.col}>{cols[1].map((e) => card(e))}</div>}
      {foot && (
        <div className={a.wide} data-tile={side}>
          {side === "start" && tile}
          {card(foot, true)}
          {side === "end" && tile}
        </div>
      )}
    </div>
  );
}

export function Press({ p }: { p: AlbumPage }) {
  const { open, setOpen } = useReadAll();
  const btnRef = useRef<HTMLButtonElement>(null);
  const L = p.press.layout;
  const hasMore = L.moreQuotes[0].length + L.moreQuotes[1].length > 0 || !!L.moreWide;

  // the artist page's "Read all N reviews" lands here (#press-all) with the rest already open
  useEffect(() => {
    if (window.location.hash === "#press-all" && hasMore) setOpen(true);
  }, [hasMore, setOpen]);

  const toggle = () => {
    const closing = open;
    setOpen(!open);
    if (!closing) return;
    // closing never strands the reader below the section: once the cards have folded away, bring the button back
    window.setTimeout(() => {
      const b = btnRef.current;
      if (b && b.getBoundingClientRect().top < 0) b.scrollIntoView({ block: "center" });
    }, 760);
  };

  // a record the research found nothing on has no press and no write-up coming: no section, no promise (BUG-62)
  const emptyLine = pressEmptyLine(p.press.undocumented);
  if (p.press.total === 0 && emptyLine === null) return null;

  return (
    <section id="press" className={`${k.ed} ${a.section} ${a.press}`} aria-labelledby="press-head">
      <span id="press-all" className={a.anchor} aria-hidden="true" />
      <div className={k.wrap}>
        <SectionHead id="press-head">
          Press.
        </SectionHead>
        {p.press.total === 0 ? (
          <p className={a.writing}>{emptyLine}</p>
        ) : (
          <>
            {/* the lead and, on a wide page, the record's colour tile on its right (album.module.css .leadRow) */}
            {L.lead && (
              <div className={a.leadRow}>
                <PressCard e={L.lead} emphasis="lead" o={0} />
                <span className={a.tile} aria-hidden="true" />
              </div>
            )}
            {L.rest[0].length + L.rest[1].length > 0 && (
              <Cols cols={L.rest} wide={L.restWide} solo={L.restSolo} emphasis="card" order={L.phoneOrder} give={L.give} />
            )}
            {/* the grades under the top cards: always when nothing is behind Read all, else while it is closed */}
            {L.grades.length > 0 && !(hasMore && open) && <GradeRow items={L.grades} />}
            {hasMore && (
              <>
                <div id="press-more" className={a.reveal} data-open={open || undefined}>
                  <div className={a.revealIn} inert={!open}>
                    <Cols cols={L.moreQuotes} wide={L.moreWide} solo={L.moreQuotesSolo} emphasis="more" order={L.phoneOrder} give={L.give} />
                    {/* opened: the same row once, after the last revealed card (inert, so unread, while closed) */}
                    {L.grades.length > 0 && <GradeRow items={L.grades} />}
                  </div>
                </div>
                <div className={a.moreRow}>
                  <Button ref={btnRef} look="outlined" aria-expanded={open} aria-controls="press-more" onClick={toggle}>
                    {open ? "Show fewer" : p.press.readAll}
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
