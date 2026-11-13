/**
 * Deleting an account (BUG-884, BUG-709): what a deletion does, in what order, and the word that confirms it.
 * Kept free of the database so it can be tested on its own (account-delete.test.ts); the route
 * (app/api/user/route.ts) hands in the real steps, and the Delete key (dashboard/account/DeleteAccount.tsx)
 * reads the word from here.
 *
 * A deletion, in this order:
 *   1. Every computer's and phone's sign-in ends, the same mark Sign out leaves on one. The next call any of
 *      them makes is refused, and the app says it was signed out.
 *   2. The person comes off any sale they bought; the sale itself stays for the artist's accounts and tax.
 *   3. The account is erased to a tombstone: name, email, photo and username gone, deletedAt set,
 *      sessionVersion moved on. The email becomes one nobody can sign in with.
 *   4. The website's own ways in go: the password, and the link to their Google account (which holds what
 *      Google sent about them, and would otherwise sign a later Google sign-in straight back into the
 *      tombstone).
 * Device sign-ins end first, so a failure part way never leaves an erased account a phone can still use. The
 * password and the Google link go last, so a failure before the erase leaves the person able to come back and
 * try again. Every step can run twice safely.
 *
 * Not here, on purpose: removing what the account still holds (library, playlists, history, devices). That is
 * the retention job's step 30 days later, one person at a time (account-erase.ts, BUG-709).
 */

export const CONFIRM_WORD = "DELETE";

/** What the person typed in the box confirms it: the word, in any case, spaces around it ignored. */
export function typedConfirms(typed: string): boolean {
  return typed.trim().toUpperCase() === CONFIRM_WORD;
}

/** The request must carry the word: a stray or forged DELETE with no body deletes nothing. */
export function confirmsDeletion(body: unknown): boolean {
  return typeof body === "object" && body !== null && (body as { confirm?: unknown }).confirm === CONFIRM_WORD;
}

/** The erased account's email: unique (the column is), never deliverable, nobody's sign-in. */
export function tombstoneEmail(userId: string): string {
  return `deleted-${userId}@cassette.invalid`;
}

export type DeleteAccountSteps = {
  /** End every live computer and phone sign-in; how many there were. */
  endDeviceSignIns: (userId: string) => Promise<number>;
  /** Take the person off the sales they bought. */
  anonymiseSales: (userId: string) => Promise<void>;
  /** Erase name, email, photo and username; set deletedAt; move sessionVersion on. */
  tombstone: (userId: string) => Promise<void>;
  /** Remove the password and the Google link. */
  endWebSignIns: (userId: string) => Promise<void>;
};

export async function deleteAccount(userId: string, steps: DeleteAccountSteps): Promise<{ signInsEnded: number }> {
  const signInsEnded = await steps.endDeviceSignIns(userId);
  await steps.anonymiseSales(userId);
  await steps.tombstone(userId);
  await steps.endWebSignIns(userId);
  return { signInsEnded };
}
