import { AppearanceBody } from "@/app/settings/_bodies/AppearanceBody";
import d from "../../desk.module.css";

/**
 * Appearance inside the desk's window: the same body the website's Settings draw (settings/_bodies), laid in
 * the desk's pane so the window, the rail and the deck stay put.
 */
export const metadata = { title: "Appearance" };

export default function DeskAppearance() {
  return (
    <div className={d.settings}>
      <AppearanceBody fill />
    </div>
  );
}
