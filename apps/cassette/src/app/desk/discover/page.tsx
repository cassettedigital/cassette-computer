import { DeskDiscover } from "../Discover";
import { deskUser } from "../session";
import { NotKeptOffline, deskDiscover } from "../source";

/**
 * Discover inside the app: the website's Discover page for the person (Discover.tsx says what the window does
 * differently). With no internet it shows the copy kept from the last time it loaded on this computer, or says it
 * needs the internet when there is none yet.
 */

export const metadata = { title: "Discover" };

export default async function DeskDiscoverPage() {
  const user = await deskUser();
  let got: Awaited<ReturnType<typeof deskDiscover>> = null;
  try {
    got = await deskDiscover(user.id);
  } catch (e) {
    if (!(e instanceof NotKeptOffline)) throw e;
  }
  return <DeskDiscover view={got?.view ?? null} offline={got?.offline ?? true} />;
}
