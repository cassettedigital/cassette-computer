import { HiddenBody } from "@/app/settings/_bodies/HiddenBody";
import d from "../../desk.module.css";

/**
 * Hidden albums inside the desk's window: the way back from Hide (BUG-638). The same body the website's
 * Settings draw (settings/_bodies), laid in the desk's pane like Account, and opened from the account menu.
 * Unhide brings an album back to the library and the phones.
 */
export const metadata = { title: "Hidden albums" };

export default function DeskHidden() {
  return (
    <div className={d.settings}>
      <HiddenBody here="/desk/settings/hidden" fill />
    </div>
  );
}
