"use client";

/**
 * FeedbackCorner: a small "Feedback" key that stays in a corner of every page, so a note to the founder is one
 * click away at any moment (founder, 2026-11-19, after Wonderlit's). It opens the note box that is already
 * mounted beside it in the root layout (ReportProblem), so the box, where the note goes, the sorting and the
 * email to the founder are all the existing ones. Its word, glyph and action are the one Feedback door every
 * account menu shares (feedback-door), so changing them there changes this key too.
 *
 * WHO SEES IT: signed-in people only (founder, 2026-11-19). A note from an account is the one that reaches the
 * founder's inbox and can be answered; a signed-out visitor still has no key here.
 *
 * WHERE IT SITS: the bottom left, because the bottom right belongs to the players (the radio dock, the song
 * video, the preview rail). On the dashboard it sits beside the help dock's "?" instead, since the dashboard's
 * bottom left is the account menu (html[data-transport] marks the dashboard shell). It lifts clear of the radio
 * dock on a phone, where that dock spans the width. Not drawn:
 *   - in the desktop app's window (the root layout doesn't mount it there: the desk's bottom left is its account
 *     menu and the player bar runs under it),
 *   - inside the iPhone app's web view or the account window's panel (html[data-surface="app"], CSS: the app is
 *     the frame),
 *   - in Admin and on the desk's pages opened in a browser.
 */

import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { tokens as kit } from "@discovery/cassette-kit";
import { Icon } from "@/app/_taste/Icon";
import { FEEDBACK, openFeedback } from "./feedback-door";
import styles from "./FeedbackCorner.module.css";

/**
 * Pages that keep their own corners: the founder's back office, the desk's pages in a browser, and the radio night's
 * event page (full screen art, the show's name pasted in this very corner).
 */
const NOT_HERE = ["/admin", "/desk", "/radio/tonight"];

export function FeedbackCorner() {
  const { status } = useSession();
  const pathname = usePathname() ?? "";
  if (status !== "authenticated") return null;
  if (NOT_HERE.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;

  return (
    <div className={`${kit.kit} ${styles.tokens}`}>
      <button type="button" className={styles.corner} onClick={openFeedback}>
        <Icon name={FEEDBACK.icon} size={15} />
        <span className={styles.word}>{FEEDBACK.label}</span>
      </button>
    </div>
  );
}
