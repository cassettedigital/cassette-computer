import { PurchasesBody } from "@/app/settings/_bodies/PurchasesBody";
import d from "../../desk.module.css";

/**
 * Purchases inside the desk's window: the same body the website's Settings draw (settings/_bodies), laid in
 * the desk's pane. Inside the app it says the list lives on the website and opens it there.
 */
export const metadata = { title: "Purchases" };

export default function DeskPurchases() {
  return (
    <div className={d.settings}>
      <PurchasesBody here="/desk/settings/purchases" fill />
    </div>
  );
}
