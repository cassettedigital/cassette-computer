import "server-only";

/**
 * The public copy's session read: the account this computer's sign-in key belongs to, from the cloud
 * (lib/token-session). The website's own version also reads its database for a browser's session; the
 * computer app never has one.
 */

export { getTokenModeSessionUser as getVerifiedSessionUser } from "./token-session";
export type { AuthedUser, VerifiedSessionResult } from "./token-session";
