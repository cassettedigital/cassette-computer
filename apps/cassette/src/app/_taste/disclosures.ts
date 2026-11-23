/**
 * The sentences an account card must say, by name (the copy rules, W7): a card names one (AuthCard `disclosure`), and
 * the words live here once, pinned by disclosures.test.ts. They move into the system's words.ts when wave 2 makes it.
 *
 *   writeBack  the computer app writes into the person's files, so the pairing page says so before they sign it in
 *              (docs/reference/CASSETTE_FILE_WRITEBACK.md, BUG-786): one plain line naming all three writes, an ID in
 *              their songs' tags, and a cover and an artist photo in folders added from now on. Its Tip carries what
 *              the doc adds: the ID is MusicBrainz's, and a picture never replaces one they put there. The phones
 *              write nothing to anyone's folders, so a phone's sheet has no such line.
 *   claimNext  what happens after a claim is approved (Your claim): Studio, then getting paid through Stripe.
 *   termsSeat  saving a seat on the waitlist agrees to the Terms and the Privacy Policy.
 *   termsNewAccount  making an account agrees to the Terms and the Privacy Policy. Signing in no longer says it (the
 *              founder's sign-in sketch, wave 1a): the person agreed when they made the account.
 */

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
