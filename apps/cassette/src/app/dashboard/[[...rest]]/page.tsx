import { redirect } from "next/navigation";
import { getDashboardSession } from "@/lib/dashboard/session";
import { retiredLibraryTarget } from "@/lib/desk/access";

export const dynamic = "force-dynamic";

/**
 * The old library's addresses, in the public copy: the desk replaced it, so each goes to its place on the desk
 * (lib/desk/access, the same answer the website gives inside the app). An address not confirmed yet is
 * confirmed on the website.
 */
export default async function OldLibrary({ params }: { params: Promise<{ rest?: string[] }> }) {
  const s = await getDashboardSession();
  if (s.kind === "unauth") redirect("/desktop/connect");
  if (s.kind === "unverified") {
    return (
      <main style={{ padding: 48, maxWidth: 520, margin: "0 auto", lineHeight: 1.5 }}>
        <h1>Confirm your email address</h1>
        <p>Open the email Cassette sent to {s.email} and follow its link, then come back here.</p>
      </main>
    );
  }
  const { rest = [] } = await params;
  const asked = `/dashboard${rest.length ? `/${rest.join("/")}` : ""}`;
  redirect(retiredLibraryTarget(asked) ?? "/desk");
}
