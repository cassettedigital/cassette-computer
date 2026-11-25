"use client";

/**
 * The disc's states page (design wave 1c, board #1201; the "Holding still" rules' state plan, section 2): every state
 * in disc.states.ts drawn side by side from made-up discs, same crop, at one window width, a thin guide line through
 * each anchor and a tag under each state with how far each anchor sits from where the first state puts it. This is
 * the filmstrip the founder signs; the state-matrix test (scripts/ci/design-states.mjs) photographs and measures this
 * same component, so the picture and the measure are one page. Drawn at /proto/states/disc (dev-only) and on
 * Admin's kit. Every key here is inert; nothing reaches a drive, a hub or a library.
 */

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { tokens as kit } from "@discovery/cassette-kit";
import t from "@/app/_taste/taste.module.css";
import { DriveComponent } from "@/app/dashboard/devices/CdDrivePanel";
import { DISC_STATES, discLook, discSongs, type DiscState } from "./look";
import { ANCHOR_EDGE, ANCHORS, LABEL, NAMES, stand, type Anchor, type NameId } from "./disc.states";
import { DiscView, type DiscActs } from "./DiscView";
import d from "../desk.module.css";
import s from "./states.module.css";

/** The disc page's column in a window `w` wide, the side view docked (desk.module.css .app: the sidebar is
    clamp(204px, 17vw, 248px), the side view clamp(300px, 26vw, 380px)). */
export const paneWidth = (w: number) => Math.round(w - Math.min(248, Math.max(204, 0.17 * w)) - Math.min(380, Math.max(300, 0.26 * w)));

const NOTHING = () => {};
const NO_RESULTS = async () => [];
const NONE_NAMED = async () => 0;
const INERT: DiscActs = { rip: NOTHING, stop: NOTHING, eject: NOTHING, play: NOTHING, busy: false };
/** The stand-in sleeve's colour, as the page's tint would read it from a cover: the accent. */
const TINT = { "--pk-tint-text": "var(--cs-orange)", "--pk-tint-glow": "var(--cs-orange)" } as CSSProperties;

/** A made-up sleeve, drawn from the colour roles (no picture, nothing typed): lanterns in the record's colour. */
const Sleeve = () => <span className={s.sleeve} role="img" aria-label="A stand-in cover" />;

/** One state, drawn as the page draws it. */
export function DiscStatePanel({ state, name }: { state: DiscState; name: NameId }) {
  const album = NAMES.find((n) => n.id === name)?.name ?? NAMES[0].name;
  const st = stand(state, album);
  const look = discLook(st.status, st.window, st.held);
  return (
    <DiscView
      look={look}
      songs={discSongs(st.window.pressed && st.held ? st.held : st.status)}
      cover={<Sleeve />}
      acts={INERT}
      tint={TINT}
      steps={
        <DriveComponent
          reachability="online"
          connected
          status={st.status}
          under
          onBack={NOTHING}
          onDetect={NOTHING}
          onClear={NOTHING}
          onConfirm={NOTHING}
          onImportUnknown={NOTHING}
          onAcoustId={NOTHING}
          onRetryTrack={NOTHING}
          onSearch={NO_RESULTS}
          onSubmitNames={NONE_NAMED}
        />
      }
    />
  );
}

/** Where each anchor sits in a panel, from the panel's top (its left for the keys' seats). */
export function anchorsIn(panel: Element): Record<string, number> {
  const top = panel.getBoundingClientRect().top;
  const out: Record<string, number> = {};
  for (const a of ANCHORS) {
    const el = panel.querySelector(`[data-anchor="${a}"]`);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    out[a] = Math.round((ANCHOR_EDGE[a] === "bottom" ? r.bottom : r.top) - top);
  }
  return out;
}

/** The filmstrip: one row per name, one panel per state, at a window `w` wide. */
export function DiscStates({
  w = 1200,
  names = ["one"],
  states = DISC_STATES,
  paper,
  print = false,
}: {
  w?: number;
  names?: readonly NameId[];
  states?: readonly DiscState[];
  paper?: "light" | "dark";
  /** drawn whole for a picture, not in a strip that scrolls */
  print?: boolean;
}) {
  const pane = paneWidth(w);
  const stacked = pane - 64 < 620;
  const strip = useRef<HTMLDivElement>(null);
  const [guides, setGuides] = useState<{ row: number; y: number; a: Anchor }[]>([]);
  const [tags, setTags] = useState<Record<string, string>>({});

  // the guide lines: each anchor where the row's first state puts it, carried across the row; a tag per state
  useLayoutEffect(() => {
    const root = strip.current;
    if (!root) return;
    const draw = () => {
      const lines: { row: number; y: number; a: Anchor }[] = [];
      const next: Record<string, string> = {};
      root.querySelectorAll(`.${s.row}`).forEach((row, ri) => {
        const panels = [...row.querySelectorAll(`.${s.frame}`)];
        const ref = panels[0] ? anchorsIn(panels[0]) : {};
        const rowTop = row.getBoundingClientRect().top;
        const frameTop = panels[0] ? panels[0].getBoundingClientRect().top - rowTop : 0;
        for (const a of ANCHORS) if (ref[a] !== undefined) lines.push({ row: ri, y: ref[a] + frameTop, a });
        panels.forEach((p) => {
          const at = anchorsIn(p);
          const moved = ANCHORS.filter((a) => ref[a] !== undefined && Math.abs((at[a] ?? NaN) - ref[a]) > 1 || (ref[a] !== undefined && at[a] === undefined)).map((a) =>
            at[a] === undefined ? `${a} missing` : `${a} ${at[a] - ref[a] > 0 ? "+" : ""}${at[a] - ref[a]}`,
          );
          next[p.getAttribute("data-key") ?? ""] = moved.length ? moved.join(" · ") : "every anchor holds";
        });
      });
      setGuides(lines);
      setTags(next);
    };
    draw();
    void document.fonts?.ready.then(draw);
  }, [w, names, states]);

  return (
    <div className={`${t.root} ${kit.kit} ${kit.follow} ${d.deskBody} ${s.sheet}`} data-density="compact" data-paper={paper} data-states="disc" data-w={w} data-print={print || undefined}>
      <p className={s.head}>
        The disc&rsquo;s page, every state · window {w} wide, the page {pane} · {stacked ? "the cover on top" : "the words beside the cover"}
      </p>
      <div ref={strip} className={s.strip}>
        {names.map((n, ri) => (
          <div key={n} className={s.row} data-name={n}>
            {guides
              .filter((g) => g.row === ri)
              .map((g) => (
                <span key={g.a} className={s.guide} style={{ "--y": `${g.y}px` } as CSSProperties} data-guide={g.a} aria-hidden="true" />
              ))}
            {states.map((st) => (
              <figure key={st} className={s.panel}>
                <div className={`${t.body} ${d.pane} ${s.frame}`} style={{ "--pane": `${pane}px` } as CSSProperties} data-key={`${n}|${st}`} data-state={st} data-name={n} data-stacked={stacked || undefined}>
                  <DiscStatePanel state={st} name={n} />
                </div>
                <figcaption className={s.caption}>
                  <span className={s.label}>{LABEL[st]}</span>
                  <span className={s.tag} data-moved={tags[`${n}|${st}`] && tags[`${n}|${st}`] !== "every anchor holds" ? "" : undefined}>
                    {tags[`${n}|${st}`] ?? ""}
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
