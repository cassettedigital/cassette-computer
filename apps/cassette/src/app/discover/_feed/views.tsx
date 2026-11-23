"use client";

/**
 * Discover's two views and the title that switches them (the founder, 2026-11-23): the two names sit in one row in a
 * fixed order, "DISCOVER" then "SAVED FOR LATER", like tab headers. The open one is the page's big title; the other is
 * small on the same baseline in the same face, on the house's underline (the founder's pick, 2026-11-23, over a filled
 * key and an outlined one). A press moves the emphasis, never the order: the small
 * one grows into a title where it stands while the title shrinks into a key where it stands. The way in and the way
 * back are the one control, so Saved for later reads as a place inside Discover, not another page.
 *
 *   discover   the day's page (DiscoverBody), which Discover opens on
 *   saved      Saved for later (SavedForLater.tsx SavedPane): what you saved and don't own yet
 *
 * The open view is in the address (?view=saved), pushed as a step of its own, so the browser's Back returns to the day's
 * page and a link can open straight onto the saved view. Both views stay mounted, so going back finds the day's page
 * as it was left (a shelf turned, a preview playing).
 *
 * The motion: each word is measured where it is, the emphasis moves, and each is drawn from where it was to where it
 * now is, as one move (no fade), 300ms on the curve that spreads a move evenly (the founder, 2026-11-17: "Motion, not
 * fades"). Nobody who asks for less motion sees it.
 */

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import x from "./views.module.css";

export type DiscoverView = "discover" | "saved";

const LABEL: Record<DiscoverView, string> = { discover: "Discover", saved: "Saved for later" };
const viewOf = (search: string): DiscoverView => (new URLSearchParams(search).get("view") === "saved" ? "saved" : "discover");

const Ctx = createContext<{ view: DiscoverView; go: (v: DiscoverView) => void } | null>(null);

/** Where each word stood before a swap, by its view. */
type Rects = Partial<Record<DiscoverView, DOMRect>>;

function measure(): Rects {
  const out: Rects = {};
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-view-word]"))) {
    out[el.dataset.viewWord as DiscoverView] = el.getBoundingClientRect();
  }
  return out;
}

/** Draws each word from where it stood (`was`) to where it stands now: one move, from its baseline corner. */
function play(was: Rects) {
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-view-word]"))) {
    const from = was[el.dataset.viewWord as DiscoverView];
    if (!from || typeof el.animate !== "function") continue;
    const to = el.getBoundingClientRect();
    if (!to.height) continue;
    const s = from.height / to.height;
    el.animate(
      [
        { transform: `translate(${from.left - to.left}px, ${from.bottom - to.bottom}px) scale(${s})` },
        { transform: "none" },
      ],
      { duration: 300, easing: "cubic-bezier(0.4, 0, 0.2, 1)" },
    );
  }
}

export function DiscoverViewProvider({ initial, children }: { initial: DiscoverView; children: ReactNode }) {
  const [view, setView] = useState<DiscoverView>(initial);
  const was = useRef<Rects | null>(null);

  const go = useCallback((v: DiscoverView) => {
    was.current = measure();
    setView(v);
    const url = new URL(window.location.href);
    if (v === "saved") url.searchParams.set("view", "saved");
    else url.searchParams.delete("view");
    window.history.pushState(null, "", url.pathname + url.search + url.hash);
  }, []);

  // Back and Forward move between the two views as steps
  useEffect(() => {
    const onPop = () => {
      was.current = measure();
      setView(viewOf(window.location.search));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // after the words have traded places (children commit first): the move
  useLayoutEffect(() => {
    if (!was.current) return;
    play(was.current);
    was.current = null;
  }, [view]);

  const value = useMemo(() => ({ view, go }), [view, go]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDiscoverView() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDiscoverView outside DiscoverViewProvider");
  return v;
}

/** The two names in their one order. */
const ORDER: DiscoverView[] = ["discover", "saved"];

/**
 * The two names in their one order: the open view's is the heading, drawn by the window (`big`: the website's title
 * face, the Mac app's kit heading), and the other is a key, small on its baseline, that opens its view.
 */
export function ViewWords({ big }: { big: (label: string) => ReactNode }) {
  const { view, go } = useDiscoverView();
  return (
    <>
      {ORDER.map((v) =>
        v === view ? (
          <span key={v} className={x.word} data-view-word={v}>
            {big(LABEL[v])}
          </span>
        ) : (
          <button key={v} type="button" className={x.switch} onClick={() => go(v)} aria-label={`Open ${LABEL[v]}`}>
            <span className={x.word} data-view-word={v}>
              {LABEL[v]}
            </span>
          </button>
        ),
      )}
    </>
  );
}

/** A window's own heading row (the Mac app's), the two names in their order on one baseline. */
export function ViewHeading({ heading }: { heading: (label: string) => ReactNode }) {
  return (
    <div className={x.row}>
      <ViewWords big={heading} />
    </div>
  );
}

/** The website's two names for its PageTitle (`words`): the open one its h1, in the title's own face, with its full stop. */
export function TitleWords() {
  return <ViewWords big={(label) => <h1 className={x.big}>{label}.</h1>} />;
}

/** The two views' content; both stay mounted, the closed one hidden. */
export function DiscoverViewPanes({ discover, saved }: { discover: ReactNode; saved: ReactNode }) {
  const { view } = useDiscoverView();
  return (
    <>
      <div hidden={view !== "discover"}>{discover}</div>
      <div hidden={view !== "saved"}>{saved}</div>
    </>
  );
}
