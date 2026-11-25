"use client";

/**
 * The account card's frame (design wave 1a, the system's FocusFrame): every account card (sign in, the invite, the
 * email code, passwords, pairing a device, the seat form, a purchase, a download, a claim) is one AuthCard drawn
 * inside it, and only inside it. The frame alone decides the chrome around the card, once, by the founder's D3 B
 * (2026-11-22):
 *
 *   - on a computer, and in a phone's own browser, the card keeps the website's masthead, footer and Feedback key,
 *     as every website page does ("nav is important and shouldn't be conditional", 11-17);
 *   - inside a phone app's sign-in sheet (the iPhone app's, or the browser tab the Android app opens to sign in) it
 *     draws the card and the Cassette mark alone, because there the website's links only lead out of signing in. That
 *     is the one named exception to 11-17, the founder's to grant, and granted.
 *
 * A page never decides this. It hands the frame what opened it (`opener`, read from its own address by
 * lib/opened-by-app: the pairing page's `client`, or a step's onward address), and the frame does the rest. The
 * Feedback key, which the root layout draws beside every page, steps aside in a sheet by the sheet's own mark
 * (data-focus-sheet, FeedbackCorner.module.css), so it never shows for a frame.
 *
 * The frame also tells the card what device it is on (useFocus), for the words a phone needs: a page a phone opens
 * says tap (the copy rules, W6).
 */

import { createContext, useContext, useRef, type ReactNode } from "react";
import type { AppDevice } from "@/lib/opened-by-app";
import { LogoMark } from "./Brand";
import { PageFrame, useReviewPaper } from "./PageFrame";
import t from "./taste.module.css";
import f from "./focus.module.css";

type Focus = { opener: AppDevice | null; sheet: boolean };

const FocusContext = createContext<Focus | null>(null);

/** The frame the card is in: what opened it, and whether it is a phone's sign-in sheet. Null outside a frame. */
export function useFocus(): Focus | null {
  return useContext(FocusContext);
}

/** "tap" on a page a phone opened, "click" anywhere else (W6). */
export function usePress(): "tap" | "click" {
  return useFocus()?.opener === "phone" ? "tap" : "click";
}

/** The sign-in sheet: the paper, the Cassette mark, the card. No masthead, footer, Feedback key or radio. */
function Sheet({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useReviewPaper(rootRef);
  return (
    <div ref={rootRef} id="top" className={`${t.root} ${t.follows} ${f.sheet}`} data-follows="" data-focus-sheet="" data-density="page">
      <main className={t.body}>
        <p className={f.mark}>
          <LogoMark className={f.logo} />
          <span>Cassette</span>
        </p>
        {children}
      </main>
    </div>
  );
}

export function FocusFrame({
  opener = null,
  account = false,
  children,
}: {
  /** What opened this page: the computer app, a phone app, or nothing (someone on the website). */
  opener?: AppDevice | null;
  /** Keep the masthead's account end (a card that is not itself the way in, a claim). */
  account?: boolean;
  children: ReactNode;
}) {
  const sheet = opener === "phone";
  return (
    <FocusContext.Provider value={{ opener, sheet }}>
      {sheet ? <Sheet>{children}</Sheet> : <PageFrame account={account}>{children}</PageFrame>}
    </FocusContext.Provider>
  );
}
