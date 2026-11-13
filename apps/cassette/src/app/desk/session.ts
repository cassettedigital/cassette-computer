import "server-only";

/**
 * Who the desk is for: the signed-in person, on the beta (users.is_beta_tester, the same opt-in the
 * Mixtape feature reads). The layout and every page ask, since Next renders them side by side; the
 * session read is shared per request (getDashboardSession).
 *
 * Signed out goes to sign-in and comes back here (in the Mac app sign-in hands on to the app's own
 * pairing screen, BUG-606); anyone else (unverified, or not on the beta) goes to
 * the dashboard, which is the app they have. Who may enter is lib/desk/access (mayEnterDesk): on a local
 * dev server any signed-in person gets in, so the desk can be worked on without joining the beta.
 */

import { redirect } from "next/navigation";
import { getDashboardSession } from "@/lib/dashboard/session";
import { mayEnterDesk } from "@/lib/desk/access";
import { DESK } from "./types";

export async function deskUser() {
  const s = await getDashboardSession();
  if (s.kind === "unauth") redirect(`/sign-in?callbackUrl=${DESK}`);
  if (s.kind !== "ok") redirect("/dashboard");
  if (!mayEnterDesk(s.user)) redirect("/dashboard");
  return s.user;
}
