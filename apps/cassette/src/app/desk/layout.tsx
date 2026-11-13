import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { ShellProvider } from "@/app/dashboard/_shell/shell-context";
import { AppearanceSync } from "@/app/dashboard/_shell/AppearanceSync";
import { loadDashboardShell } from "@/lib/desktop-session";
import { isTokenMode } from "@/lib/player-client";
import { HUB_IN_REACH } from "@/lib/hub-origin";
import { DeskShell } from "./DeskShell";
import { deskWindow } from "./source";
import { webFlags } from "./web";
import { deskUser } from "./session";

/**
 * /desk: the desktop app's window on the taste set, for the signed-in person's own library, played by
 * their Mac. Beta only (session.ts) and noindexed; the dashboard is untouched beside it. The window stays
 * mounted while you move between pages, so the music keeps playing.
 *
 * The player is the dashboard's own (ShellProvider): the same remote control for the Mac's hub, the
 * same reading back of what the hub is really playing, without the dashboard's warm library store, which
 * nothing here reads (library={false}, BUG-608). The data comes through source.ts: the database
 * on the web, the cloud's desk routes inside the paired app.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

// One person's own window, every time: never made ahead at build (the website's session read already made it
// so; inside the app, and in the open-source copy, the account comes from the cloud and says nothing to Next).
export const dynamic = "force-dynamic";

/**
 * Studio and admin, for the account menu's jumps. On the web Studio is offered to anyone with a room and every
 * site admin, called "Studio" for everyone. The paired app reads the same rule from the cloud's shell read
 * (`studio`), falling back to the artist and admin flags when an older cloud doesn't send it.
 */
async function flags(userId: string): Promise<[{ show: boolean; label: "Studio" }, boolean]> {
  if (isTokenMode()) {
    const shell = await loadDashboardShell();
    return [{ show: shell?.studio ?? (!!shell?.isCreator || !!shell?.isAdmin), label: "Studio" }, !!shell?.isAdmin];
  }
  return webFlags(userId);
}

export default async function DeskLayout({ children }: { children: ReactNode }) {
  // The website in a regular browser can't reach anyone's computer (lib/hub-origin), so it has no library to
  // show: every desk address there opens the account window instead (the founder, 2026-11-08). The desktop app
  // keeps its library window, and so does a local dev server that reaches its own hub.
  if (!isTokenMode() && !HUB_IN_REACH) redirect("/account");
  const user = await deskUser();
  const [data, [studio, isAdmin]] = await Promise.all([deskWindow(user.id, user.name), flags(user.id)]);
  // studioLabel rides on the account to the rail's menu (desk/Sidebar.tsx reads it; DeskAccount stays as it is)
  const account = {
    user: { name: user.name, email: user.email, image: user.image, avatarPreset: user.avatarPreset },
    isCreator: studio.show,
    studioLabel: studio.label,
    isAdmin,
  };
  return (
    <ShellProvider isBetaTester library={false}>
      {/* the account's skin, as the dashboard applies it: the kit's chassis and orange turn with it */}
      <AppearanceSync theme={user.themeId} icon={user.iconId} />
      <DeskShell data={data} account={account} desktop={isTokenMode()}>
        {children}
      </DeskShell>
    </ShellProvider>
  );
}
