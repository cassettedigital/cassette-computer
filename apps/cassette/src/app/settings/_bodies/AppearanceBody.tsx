/**
 * Appearance: light or dark (kept per device) and a skin (live, and it follows the account:
 * lib/appearance.ts). Nothing to load, so a thin frame around the client picker. Drawn in the website's
 * Settings window and in the desk's window (`fill`), which leaves the skins out (`skins={false}`).
 */

import { AppearancePicker } from "@/app/dashboard/appearance/AppearancePicker";
import { SettingsPage } from "../_parts/parts";

export function AppearanceBody({ fill, skins = true }: { fill?: boolean; skins?: boolean }) {
  return (
    <SettingsPage title="Appearance" fill={fill}>
      <AppearancePicker skins={skins} />
    </SettingsPage>
  );
}
