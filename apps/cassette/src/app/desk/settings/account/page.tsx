import { AccountBody } from "@/app/settings/_bodies/AccountBody";
import d from "../../desk.module.css";

/**
 * Account inside the desk's window: the same body the website's Settings draw (settings/_bodies), laid in
 * the desk's pane so the window, the rail and the deck stay put. (The desk's session gate runs in its
 * layout; the body also checks the session itself.)
 */
export const metadata = { title: "Account" };

export default function DeskAccount() {
  return (
    <div className={d.settings}>
      <AccountBody here="/desk/settings/account" fill />
    </div>
  );
}
