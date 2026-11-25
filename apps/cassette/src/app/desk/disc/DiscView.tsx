"use client";

/**
 * The disc's page as drawn (design wave 1c, board #1201): one head for a disc in every state, and a body under it.
 * Presentational only: the page (disc.tsx) wires it to the drive, the states page (/proto/states/disc), Admin's kit
 * and the state-matrix test draw it from the stand-ins in disc.states.ts. Same part, same page, every state.
 *
 *   head   the kit's Hero: the cover (the bare disc until it's known, then the sleeve with the CD tucked in it), the
 *          coming line on the cover's top edge (the founder's top line, 2026-11-24), the name growing up from the
 *          artist, the facts, and two key seats on the cover's foot: Rip, Stop or Play, then Eject, each dimmed
 *          where it sits when it can't be used
 *   body   the songs (their bones while the disc is read), or the drive panel's steps where a person chooses,
 *          names or recovers; its first line never moves
 */

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Glyph, Hero, ICON, Pill, Pills, PlayPill } from "@discovery/cassette-kit";
import type { TrackState, TrackStatus } from "@/lib/rip-status";
import type { ComingLine, DiscLook } from "./look";
import d from "../desk.module.css";

/** The ring around the disc: one segment per song, lit as each is copied, in the record's colour. */
export function ringOf(states: TrackState[]): string {
  const on = "var(--pk-tint-glow, var(--pk-tint-neutral-glow))";
  const n = Math.max(1, states.length);
  const step = 360 / n;
  const gap = Math.min(4, step * 0.25);
  const parts = states.flatMap((st, i) => {
    const a = i * step;
    const b = a + step - gap;
    const c = st === "done" ? on : st === "ripping" || st === "encoding" ? `color-mix(in srgb, ${on} 55%, transparent)` : `color-mix(in srgb, ${on} 18%, transparent)`;
    return [`${c} ${a}deg ${b}deg`, `transparent ${b}deg ${a + step}deg`];
  });
  return `conic-gradient(${parts.join(", ")})`;
}

const TRACK_WORD: Partial<Record<TrackState, string>> = { ripping: "Copying", encoding: "Copying", done: "", error: "Couldn't read" };

/** What the head's keys and links do; on a drawing of the page (the states page, the kit) they do nothing. */
export type DiscActs = {
  rip: () => void;
  stop: () => void;
  eject: () => void;
  play: () => void;
  busy: boolean;
  /** where "Not this album?" goes and where the landed record is; absent, the words are drawn without a link */
  chooseHref?: string;
  recordHref?: string;
};

function Line({ line, acts }: { line: ComingLine; acts: DiscActs }) {
  const href = line.link?.to === "choose" ? acts.chooseHref : acts.recordHref;
  const link = line.link ? href ? <Link href={href}>{line.link.word}</Link> : <span data-link="">{line.link.word}</span> : null;
  return (
    <>
      {line.words}
      {line.words && link ? " · " : null}
      {link}
    </>
  );
}

export function DiscView({
  look,
  songs,
  cover,
  peek = true,
  acts,
  steps,
  tint,
}: {
  look: DiscLook;
  songs: TrackStatus[];
  /** the sleeve's picture (the bare disc is drawn here when `look.bare`) */
  cover: ReactNode;
  /** the CD tucked in its sleeve */
  peek?: boolean;
  acts: DiscActs;
  /** the drive panel's steps, for a state whose body is them */
  steps?: ReactNode;
  tint?: CSSProperties;
}) {
  const k = look.key1;
  const key1 =
    k.act === "play" ? (
      <PlayPill onClick={acts.play} disabled={!k.on || acts.busy} />
    ) : (
      <Pill fill={k.fill} word={k.word} glyph={<Glyph name={k.act === "stop" ? "close" : "album"} size={ICON.small} />} onClick={k.act === "stop" ? acts.stop : acts.rip} disabled={!k.on || acts.busy} />
    );
  const art = look.bare ? <span className={d.discBare} data-spin={look.spin || undefined} aria-hidden="true" /> : cover;
  const ghost = (w: string) => <span className={`${d.discGhostBar} ${d.discBone}`} style={{ "--w": w } as CSSProperties} aria-hidden="true" />;
  const rows = songs.length ? songs : Array.from({ length: 12 }, (_, i) => ({ position: i + 1, title: "", state: "pending" as TrackState }));
  const list =
    look.body === "bones" ? (
      <ol className={d.discTracks} aria-hidden="true">
        {rows.slice(0, Math.max(6, Math.min(12, rows.length))).map((_, i) => (
          <li key={i} className={d.discTrack} data-ghost="">
            <span className={d.discNum}>{i + 1}</span>
            <span className={d.discGhostBar} style={{ "--w": `${38 + ((i * 23) % 37)}%` } as CSSProperties} />
            <span />
          </li>
        ))}
      </ol>
    ) : (
      <ol className={d.discTracks} aria-label={`${look.name}'s songs`}>
        {songs.map((t) => (
          <li key={t.position} className={d.discTrack} data-state={t.state} data-owned={t.inLibrary || undefined}>
            <span className={d.discNum}>{t.position}</span>
            <span className={d.discTitle}>{t.title || `Track ${t.position}`}</span>
            <span className={d.discMark}>{t.state === "done" ? <Glyph name="check" size={ICON.small} /> : t.state === "pending" && t.inLibrary && look.key1.act !== "stop" ? "In your library" : TRACK_WORD[t.state]}</span>
          </li>
        ))}
      </ol>
    );
  // the sleeve in the cover's frame, and the CD tucked in it with one segment per song lit as it's copied
  const sleeve = (
    <span className={d.discSleeve} data-dim={look.dim || undefined}>
      {art}
    </span>
  );
  const tucked =
    look.bare || !peek ? undefined : (
      <span className={d.discPeek} data-spin={look.spin || undefined} aria-hidden="true">
        <span className={d.discSegs} style={{ "--ring": ringOf(songs.map((t) => t.state)) } as CSSProperties} />
        <span className={d.discCd} />
      </span>
    );
  const eject = <Glyph name="eject" size={ICON.small} />;
  return (
    <div className={`${d.page} ${d.albumPage}`} style={tint} data-disc={look.state}>
      <Hero
        art={sleeve}
        peek={tucked}
        title={look.state === "done" && acts.recordHref ? <Link href={acts.recordHref}>{look.name}</Link> : look.name}
        name={look.name}
        answer={look.bones ? ghost("7em") : (look.artist ?? <span aria-hidden="true">{" "}</span>)}
        meta={look.bones ? ghost("11em") : (look.facts ?? <span aria-hidden="true">{" "}</span>)}
        line={look.line ? <Line line={look.line} acts={acts} /> : null}
      >
        <div className={d.heroKeys}>
          <Pills>
            {key1}
            <Pill word="Eject" glyph={eject} onClick={acts.eject} disabled={!look.eject || acts.busy} />
          </Pills>
        </div>
      </Hero>
      <div data-anchor="body">
        {(look.body === "steps" || look.body === "steps+songs") && <div className={d.discPanel}>{steps}</div>}
        {look.body !== "steps" && list}
      </div>
    </div>
  );
}
