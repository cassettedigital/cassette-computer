import type { Metadata } from "next";
import { AllShelves } from "../Reach";

export const metadata: Metadata = { title: "All shelves" };

/** Every shelf the cloud made from your records today (lib/home); Home shows one at a time. */
export default function DeskShelves() {
  return <AllShelves />;
}
