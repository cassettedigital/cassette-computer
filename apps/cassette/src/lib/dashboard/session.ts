/**
 * Request-scoped dashboard session.
 *
 * The dashboard auth gate (layout), the sidebar data loader, and the home page
 * all need the verified user. Wrapping getVerifiedSessionUser in React's `cache`
 * means they share ONE execution (one session + user-row read) per RSC request
 * instead of each re-verifying independently (spec §6.3).
 */

import { cache } from "react";
import {
  getVerifiedSessionUser,
  type VerifiedSessionResult,
} from "@/lib/auth-helpers";

export const getDashboardSession = cache(
  async (): Promise<VerifiedSessionResult> => getVerifiedSessionUser()
);
