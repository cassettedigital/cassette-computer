/**
 * What to call the computer the person's music lives on (BUG-243).
 *
 * The Devices screens said "This Mac" for every hub, so a Windows owner read their own PC as a Mac. The
 * computer the page is open on is known from the browser (the app's window runs on the hub's own computer;
 * on the website it is the same computer far more often than not), read the same way the get-the-app strip
 * reads it (account/get-the-app systemOf). A Mac says "Mac", Windows says "PC", anything else, and a phone
 * looking at a computer's screen, says "computer". Platform names stay on download keys otherwise.
 *
 * Pure, so the words are tested (computer-words.test.ts). The server side, which reads the request's
 * user agent, is lib/this-computer.ts.
 */

import { systemOf, type System } from "./account/get-the-app";

export type ComputerWords = {
  /** "This Mac", "This PC", "This computer": the hub's name on the Devices screens */
  thisOne: string;
  /** "this Mac", "this PC", "this computer", mid-sentence */
  thisInline: string;
  /** "your Mac", "your PC", "your computer", mid-sentence */
  yours: string;
  /** the button that shows the music folder in the computer's own file window */
  reveal: string;
  /** the same, as a menu item */
  openFolder: string;
};

export function computerWords(system: System): ComputerWords {
  switch (system) {
    case "macos":
      return { thisOne: "This Mac", thisInline: "this Mac", yours: "your Mac", reveal: "Show in Finder", openFolder: "Open in Finder" };
    case "windows":
      return { thisOne: "This PC", thisInline: "this PC", yours: "your PC", reveal: "Show in File Explorer", openFolder: "Open in File Explorer" };
    default:
      return { thisOne: "This computer", thisInline: "this computer", yours: "your computer", reveal: "Show folder", openFolder: "Open folder" };
  }
}

/** The words for the computer a request came from, by its user agent (absent reads as a plain computer). */
export function computerWordsForUserAgent(userAgent: string | null | undefined): ComputerWords {
  return computerWords(systemOf({ userAgent: userAgent ?? "" }));
}

/** What the screens said before this, and what an unknown caller still gets. */
export const MAC_WORDS: ComputerWords = computerWords("macos");
