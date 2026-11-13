/**
 * Account: who you are on Cassette and how you sign in, then how the apps behave, the computers and phones
 * signed in, and the quiet way to leave (DeleteAccount: deleting is self-serve, BUG-884). Read-first and calm:
 * each setting shows what it is now and opens its form on a key, rather than every field in edit mode at once.
 *
 * Drawn in two places from this one body: the website's Settings window (/settings) and the desktop app's
 * desk window (/desk/settings/account, `fill`). In the app (token mode, no database) the account comes from
 * the cloud over the device token; the email, the password and deleting the account happen on the website,
 * where the person has a session (BUG-783), so their keys open it in the browser. The iPhone app opens this
 * page in its own web view for Delete Account, with a session made from the phone's sign-in.
 */

import { redirect } from "next/navigation";
import { getDashboardSession } from "@/lib/dashboard/session";
import { isTokenMode, fetchPlayer, CLOUD_BASE } from "@/lib/player-client";
import { loadAccountPlayerData } from "@/lib/account-player-data";
import type { AccountPlayerData } from "@/lib/player-answers";
import { StudioSection } from "@/app/studio/_kit/parts";
import { DesktopNotice } from "@/app/dashboard/components/DesktopNotice";
import { PasswordForm } from "@/app/dashboard/account/PasswordForm";
import { ChangeEmailForm } from "@/app/dashboard/account/ChangeEmailForm";
import { DisplayNameForm } from "@/app/dashboard/account/DisplayNameForm";
import { ProfileAvatarPicker } from "@/app/dashboard/account/ProfileAvatarPicker";
import { AddMusicToggle } from "@/app/dashboard/account/AddMusicToggle";
import { SignIns } from "@/app/dashboard/account/SignIns";
import { DiagnosticsToggle } from "@/app/dashboard/account/DiagnosticsToggle";
import { BetaToggle } from "@/app/dashboard/account/BetaToggle";
import { CollapsibleField } from "@/app/dashboard/account/CollapsibleField";
import { DeleteAccount } from "@/app/dashboard/account/DeleteAccount";
import { SettingList, SettingsPage } from "../_parts/parts";

export async function AccountBody({ here, fill }: { here: string; fill?: boolean }) {
  const session = await getDashboardSession();
  if (session.kind === "unauth") redirect(`/sign-in?callbackUrl=${encodeURIComponent(here)}`);

  let data: AccountPlayerData | null;
  if (isTokenMode()) {
    try {
      data = await fetchPlayer<AccountPlayerData>("/api/player/account");
    } catch {
      return <DesktopNotice pageTitle="Account" cardTitle="You're offline" body="Reconnect to manage your account." />;
    }
  } else {
    data = await loadAccountPlayerData(session.user.id);
  }
  if (!data) redirect(`/sign-in?callbackUrl=${encodeURIComponent(here)}`);

  const hasPassword = data.hasPassword;
  const onWebsite = isTokenMode() ? `${CLOUD_BASE}/settings` : undefined;

  return (
    <SettingsPage title="Account" fill={fill}>
      <StudioSection title="You">
        <ProfileAvatarPicker currentImage={data.image ?? null} currentPreset={data.avatarPreset} name={data.name} email={data.email} />
        <SettingList label="You">
          <CollapsibleField label="Display name" value={data.name?.trim() || "Not set"} action="Edit">
            <DisplayNameForm currentName={data.name ?? ""} />
          </CollapsibleField>
          <CollapsibleField label="Email" value={data.email} action="Change" href={onWebsite}>
            <ChangeEmailForm currentEmail={data.email} />
          </CollapsibleField>
          <CollapsibleField
            label="Password"
            value={hasPassword ? "••••••••" : "Not set. You sign in with Google."}
            action={hasPassword ? "Change" : "Add"}
            href={onWebsite}
          >
            <PasswordForm hasPassword={hasPassword} />
          </CollapsibleField>
        </SettingList>
      </StudioSection>

      {/* Server Mode is off for everyone until it comes back (the founder, 2026-11-09: "disabled universally. We'll
          add it back in gradually"; both phone apps ship with streaming off). ServerModeToggle is kept for then. Move
          music you add is the desktop app's alone, so the section is too. */}
      {isTokenMode() && (
        <StudioSection title="Listening">
          <SettingList label="Listening">
            <AddMusicToggle />
          </SettingList>
        </StudioSection>
      )}

      <StudioSection title="Signed in">
        <SignIns />
      </StudioSection>

      <StudioSection title="Diagnostics and early features">
        <SettingList label="Diagnostics and early features">
          <DiagnosticsToggle initial={data.diagnosticsConsent ?? true} />
          <BetaToggle initial={data.isBetaTester} />
        </SettingList>
      </StudioSection>

      {/* deleting happens here, on the website (BUG-884); the desktop app opens it there */}
      <DeleteAccount onWebsite={onWebsite} />
    </SettingsPage>
  );
}
