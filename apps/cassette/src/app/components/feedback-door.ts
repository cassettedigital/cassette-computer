/**
 * The Feedback door, written once (the founder, 2026-11-20: "one broadly used component, so a change to it in
 * one place results in a change in all places"). What it is called, its glyph and what it opens live here and
 * nowhere else, so every way into the note box says and does the same thing:
 *
 *   - the corner key on every website page (FeedbackCorner),
 *   - the shared site menu (_taste/site-menu: the masthead's menu, and the account menu in the account window,
 *     Settings, Studio and Admin),
 *   - the desk's account menu, which is the Mac app's (desk/Sidebar),
 *   - the old library's account menu (RailAccountMenu),
 *   - and the doors that open the same box in their own words (the help dock's "Send a note", Invite friends).
 *
 * It opens the one note box (ReportProblem, mounted once in the root layout) by an event on the window, so a
 * door needs nothing passed down to it. Plain module, no React: the site menu's tests import it.
 */

import type { MenuItem } from "@discovery/cassette-kit";
import type { IconName } from "@/app/_taste/Icon";

/** The note box listens for this on `window` (ReportProblem). */
export const OPEN_FEEDBACK_EVENT = "cassette:report-problem";

/** What the door says, and its glyph in the website's icon set (_taste/Icon). */
export const FEEDBACK: { label: string; icon: IconName } = { label: "Feedback", icon: "note" };

/** Open the note box, wherever you are. */
export function openFeedback(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_FEEDBACK_EVENT));
}

/** The door as a row in the kit's menus (the desk's account menu, and every rail's through the site menu). */
export function feedbackMenuItem(): MenuItem {
  return { label: FEEDBACK.label, onSelect: openFeedback };
}
