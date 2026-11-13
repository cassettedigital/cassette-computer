"use client";

/**
 * Press: what writers said about this record, in their words, linked, with the grade they printed.
 * The lead across the width a size up, the rest of the top set in two balanced columns (laid out on the
 * server, so nothing moves after load), the grade-only entries as one row of grades, and Read all
 * opening the remaining quotes as smaller cards. The row of grades sits under the top cards while Read
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

function Cols({ cols, solo, emphasis, order }: { cols: [PressEntry[], PressEntry[]]; solo: boolean; emphasis: "card" | "more"; order: Record<string, number> }) {
  const card = (e: PressEntry) => <PressCard key={e.order} e={e} emphasis={emphasis} o={order[String(e.order)] ?? 0} solo={solo} />;
  return (
    <div className={a.cols}>
      <div className={a.col}>{cols[0].map(card)}</div>
      {!solo && cols[1].length > 0 && <div className={a.col}>{cols[1].map(card)}</div>}
    </div>
  );
}

export function Press({ p }: { p: AlbumPage }) {
  const { open, setOpen } = useReadAll();
  const btnRef = useRef<HTMLButtonElement>(null);
  const L = p.press.layout;
  const hasMore = L.moreQuotes[0].length + L.moreQuotes[1].length > 0;

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
            {L.lead && <PressCard e={L.lead} emphasis="lead" o={0} />}
            {L.rest[0].length + L.rest[1].length > 0 && <Cols cols={L.rest} solo={L.restSolo} emphasis="card" order={L.phoneOrder} />}
            {/* the grades under the top cards: always when nothing is behind Read all, else while it is closed */}
            {L.grades.length > 0 && !(hasMore && open) && <GradeRow items={L.grades} />}
            {hasMore && (
              <>
                <div id="press-more" className={a.reveal} data-open={open || undefined}>
                  <div className={a.revealIn} inert={!open}>
                    <Cols cols={L.moreQuotes} solo={L.moreQuotesSolo} emphasis="more" order={L.phoneOrder} />
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
