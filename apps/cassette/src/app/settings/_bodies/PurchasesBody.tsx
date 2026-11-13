/**
 * Purchases, in the public copy: the list lives on www.cassette.digital, so the app says so and opens it there
 * (the website's own body does the same inside the app, and reads the database on the website).
 */

import { DesktopNotice } from "@/app/dashboard/components/DesktopNotice";

export async function PurchasesBody(_: { here: string; fill?: boolean }) {
  return (
    <DesktopNotice
      pageTitle="Purchases"
      cardTitle="Available on the web"
      body="Your purchase history lives on cassette.digital in your browser."
      web="/settings/purchases"
    />
  );
}
