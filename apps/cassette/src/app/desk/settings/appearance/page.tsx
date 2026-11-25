import { AppearanceBody } from "@/app/settings/_bodies/AppearanceBody";
import d from "../../desk.module.css";

/**
 * Appearance inside the desk's window: the same body the website's Settings draw (settings/_bodies), laid in
 * the desk's pane so the window, the rail and the deck stay put. Light or dark only: the skins are off in the
 * app (the founder, 2026-11-21).
 */
export const metadata = { title: "Appearance" };

export default function DeskAppearance() {
  return (
    <div className={d.settings}>
      <AppearanceBody fill />
    </div>
  );
}
