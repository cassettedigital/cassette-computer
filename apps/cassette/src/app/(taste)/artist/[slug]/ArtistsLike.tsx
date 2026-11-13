"use client";

/**
 * 5. Artists like them: worked out from the taste layers (lib/artist-taste-like.ts), closest first, only those
 * with a page here, up to 12. Each is their photo as a small circle (or, with no photo, their best-known cover,
 * square, as covers are) and their name, names only (founder, 2026-11-02). Every one is a door to their page in
 * the click-through. The rows, and the rule that the grid never ends on a short row (the founder, 2026-10-21),
 * are the kit's ArtistRows (promoted from here).
 */

import { useState } from "react";
import { ArtistRows } from "@/app/_taste/ArtistRows";
import { Menu, MenuRadio } from "@/app/_taste/Menu";
import { SectionHead } from "@/app/_taste/SectionHead";
import k from "@/app/_taste/taste.module.css";
import type { Neighbour } from "../_lib/types";
import s from "./artist.module.css";

/** `lead` names the shelf: the old "Artists like", or the new profile shelf's "Sounds like".
 *  `twoLines`: the Sounds like reasons wrap to a second line rather than cut off.
 *  `by`: the artist's sides, each with its own shelf. With it the head asks "If you like Hole for their
 *  SOUND", the word a menu in the head's own face and the record's colour, with a round chevron key, so the
 *  sentence reads as one: their sound (the shelf as made) or one side ("abrasive noise punk").
 *  `fans`: `by` holds the kinds of fan the band has instead (the taste mesh, lib/mesh/artist-like.ts), and the head reads
 *  "Artists like The Strokes, for THE DOWNTOWN MINIMALIST PURISTS". `lead` is the fan type `rows` belongs to; with none,
 *  `rows` blends them all and leads the menu as "all their fans". */
export function ArtistsLike({
  name,
  rows,
  lead = "Artists like",
  id = "like-title",
  twoLines = false,
  by = [],
  fans,
}: {
  name: string;
  rows: Neighbour[];
  lead?: string;
  id?: string;
  twoLines?: boolean;
  by?: { label: string; rows: Neighbour[] }[];
  fans?: { kind: "fans"; lead: string | null };
}) {
  const ALL = "all their fans";
  const [pick, setPick] = useState(fans ? (fans.lead ?? ALL) : "sound");
  const shown = by.find((b) => b.label === pick)?.rows ?? rows;
  const options = fans ? [...(fans.lead ? [] : [{ label: ALL }]), ...by] : [];
  return (
    <section className={s.ownSec} aria-labelledby={id}>
      <div className={k.wrap}>
        {fans && options.length > 1 ? (
          <SectionHead
            id={id}
            size="small"
            inline
            after={
              <span className={s.likeWord}>
                <Menu trigger="word" align="start" label={`Which of ${name}'s fans`} title={pick}>
                  {options.map((b) => (
                    <MenuRadio key={b.label} checked={b.label === pick} onPick={() => setPick(b.label)}>
                      {b.label}
                    </MenuRadio>
                  ))}
                </Menu>
              </span>
            }
          >
            {lead} {name}, for
          </SectionHead>
        ) : !fans && by.length > 0 ? (
          <SectionHead
            id={id}
            size="small"
            inline
            after={
              <span className={s.likeWord}>
                <Menu trigger="word" align="start" label={`What you like ${name} for`} title={pick}>
                  {[{ label: "sound" }, ...by].map((b) => (
                    <MenuRadio key={b.label} checked={b.label === pick} onPick={() => setPick(b.label)}>
                      {b.label === "sound" ? "their sound" : b.label}
                    </MenuRadio>
                  ))}
                </Menu>
              </span>
            }
          >
            If you like {name} for their
          </SectionHead>
        ) : (
          <SectionHead id={id} size="small">
            {lead} {name}
            {/[.!?]$/.test(name) ? "" : "."}
          </SectionHead>
        )}
        <ArtistRows rows={shown.map((n) => ({ slug: n.slug, name: n.name, photo: n.photo, cover: n.cover, line: n.shares.join(" · ") }))} twoLines={twoLines} big />
      </div>
    </section>
  );
}
