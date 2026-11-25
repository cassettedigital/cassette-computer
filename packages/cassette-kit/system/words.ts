/**
 * The word list (design wave 2, board #1152; the copy rules W1 to W10 in the system proposal): the sentences a page
 * must say, by name; the words that change by surface; the names; the words never used. A part reads its words from
 * here, never from a copy of its own. words.test.ts pins them; the copy check (wave 5) reads this file.
 *
 * The required sentences moved here from wave 1a's _taste/disclosures.ts (2026-11-23). Each is one card's sentence,
 * named, so a card says `disclosure="writeBack"` and never types the words itself:
 *
 *   writeBack        the computer app writes into the person's files, so the pairing page says so before they sign it
 *                    in (docs/reference/CASSETTE_FILE_WRITEBACK.md, BUG-786; rule R-writeback-line): one plain line
 *                    naming all three writes, an ID in their songs' tags, and a cover and an artist photo in folders
 *                    added from now on. Its Tip carries what the doc adds: the ID is MusicBrainz's, and a picture never
 *                    replaces one they put there. The phones write nothing to anyone's folders, so a phone's sheet has no
 *                    such line.
 *   claimNext        what happens after a claim is approved (Your claim): Studio, then getting paid through Stripe.
 *   termsSeat        saving a seat on the waitlist agrees to the Terms and the Privacy Policy.
 *   termsNewAccount  making an account agrees to the Terms and the Privacy Policy. Signing in no longer says it (the
 *                    founder's sign-in sketch, wave 1a): the person agreed when they made the account.
 */

import type { Surface } from "./types";

// ---------------------------------------------------------------------------------------------------------------
// required sentences (W7)

export type DisclosurePart = string | { label: string; href: string };

/** `at: "foot"`: said under the keys, where the person commits (the terms); otherwise under the title (the write-back). */
export type Disclosure = { say: DisclosurePart[]; tip?: string; at?: "foot" };

export const DISCLOSURES = {
  writeBack: {
    say: ["Cassette adds an ID to your songs’ tags, and a cover and artist photo to folders you add from now on."],
    tip: "The ID is MusicBrainz’s, so every device knows the song, and no picture replaces yours.",
  },
  termsNewAccount: {
    at: "foot",
    say: ["Making an account agrees to the ", { label: "Terms", href: "/legal/terms" }, " and the ", { label: "Privacy Policy", href: "/legal/privacy" }, "."],
  },
  claimNext: {
    at: "foot",
    say: ["Studio opens when the claim is approved, and getting paid opens when you connect Stripe."],
  },
  termsSeat: {
    at: "foot",
    say: ["Saving a seat agrees to the ", { label: "Terms", href: "/legal/terms" }, " and the ", { label: "Privacy Policy", href: "/legal/privacy" }, "."],
  },
} as const satisfies Record<string, Disclosure>;

export type DisclosureId = keyof typeof DISCLOSURES;

/** A disclosure's words as plain text (for the word budget and the tests). */
export function disclosureText(id: DisclosureId): string {
  return (DISCLOSURES[id].say as readonly DisclosurePart[]).map((p) => (typeof p === "string" ? p : p.label)).join("");
}

// ---------------------------------------------------------------------------------------------------------------
// words that change by surface (W9)

/**
 * Record is the website's word on its keys, headings and search groups; album in the Mac and Windows windows and on
 * the phones (R-record-album, the founder 2026-10-28). Search-facing page titles are left alone.
 */
export const RECORD_WORD: Record<Surface, "record" | "album"> = {
  website: "record",
  panes: "record",
  email: "record",
  "desktop-mac": "album",
  "desktop-windows": "album",
  iphone: "album",
  android: "album",
};

/** A page a phone opens says tap, not click (W6); kinds.ts marks those pages. */
export const PRESS_WORD = { touch: "tap", pointer: "click" } as const;

// ---------------------------------------------------------------------------------------------------------------
// names (D38, delegated: the drafted defaults)

export const NAMES = {
  product: "Cassette",
  /** one name for the Mac and Windows apps in a sentence (D38) */
  desktopApp: "the desktop app",
  /** money an artist is paid (D38: Payouts, not Payments) */
  payouts: "Payouts",
} as const;

/**
 * Still to write down: the one date style (D38 took the audit's drafted default, but that draft lived in the audit's
 * scratchpad and was lost) and the emails' sign-off (unchanged until the founder says). Wave 5's copy sweep records
 * the date style the site already uses most; the sign-off stays the founder's.
 */
export const NOT_YET = ["dateStyle", "emailSignOff"] as const;

// ---------------------------------------------------------------------------------------------------------------
// words never used (W4, W10; the root CLAUDE.md)

/** Generic SaaS words, in any form (W4). */
export const BANNED = ["leverage", "leveraging", "seamless", "seamlessly", "streamline", "streamlining", "revolutionize", "revolutionizing"] as const;

/** Product lines say Cassette, stance lines say I; never "we", "us" or "our" (W4, 11-10). */
export const NOT_WE = ["we", "us", "our"] as const;

/** Lines that vouch for their own honesty or method (W10, R-no-self-vouching). */
export const SELF_VOUCHING = ["honest note", "nothing hidden", "in plain language", "not a bug"] as const;
