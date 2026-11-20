import { RadioDialSkeleton } from "@/app/components/radio/RadioDialSkeleton";
import { PageHead } from "../Shelves";
import d from "../desk.module.css";

/**
 * Radio in the window while its page comes back from the cloud (the founder, 2026-11-16: "a smidge slow ... clicks
 * feeling instant and offering a loading state"): the page's title at once, and the dial as bones where it will
 * stand. The window, the library, the side view and the player bar stay and keep playing; only the page waits.
 */
export default function DeskRadioLoading() {
  return (
    <div className={d.page}>
      <PageHead title="Radio" />
      <RadioDialSkeleton />
    </div>
  );
}
