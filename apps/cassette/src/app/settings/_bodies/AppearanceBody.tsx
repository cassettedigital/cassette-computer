/**
 * Appearance: light or dark (kept per device). No skins (the founder's D14). Nothing to load, so a thin frame around
 * the client picker. Drawn in the website's Settings window and in the desk's window (`fill`).
 */

import { AppearancePicker } from "@/app/dashboard/appearance/AppearancePicker";
import { SettingsPage } from "../_parts/parts";

export function AppearanceBody({ fill }: { fill?: boolean }) {
  return (
    <SettingsPage title="Appearance" fill={fill}>
      <AppearancePicker />
    </SettingsPage>
  );
}
